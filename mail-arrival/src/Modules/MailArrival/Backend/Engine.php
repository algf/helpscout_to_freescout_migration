<?php
namespace Modules\MailArrival;
/** Checkpoint policy is portable; provider, transactional store and native sink are injected. */
final class Engine
{
    private $provider;
    private $store;
    private $sink;
    private $options;
    public function __construct($provider, $store, $sink, array $options)
    {
        $this->provider = $provider;
        $this->store = $store;
        $this->sink = $sink;
        $this->options = $options;
    }
    public static function identity(array $row, $raw = null)
    {
        if (!empty($row['X-GM-MSGID'])) {
            if (!ctype_digit((string) $row['X-GM-MSGID'])) {
                throw new \RuntimeException('Invalid Gmail message identity');
            }
            return 'gmail:' . $row['X-GM-MSGID'];
        }
        $header = $row['BODY[HEADER]'] ?? $row['RFC822.HEADER'] ?? '';
        if (preg_match('/^Message-ID:\s*(.+)$/mi', $header, $match)) {
            return 'header:' . hash('sha256', trim($match[1]) . "\0" . $header);
        }
        if ($raw !== null) {
            return 'mime:' . hash('sha256', $raw);
        }
        return null;
    }
    private function ingest($mailbox, array $row, $raw = null)
    {
        $identity = self::identity($row);
        if ($identity === null) {
            $raw = $raw ?? $this->provider->raw(
                $row['folder'],
                $row['UID'],
                $row['uidvalidity']
            );
            $identity = self::identity($row, $raw);
        }
        if ($this->store->message($mailbox, $identity)) {
            return ['outcome' => 'replayed', 'changed' => false];
        }
        $result = $this->sink->known($row);
        if (!$result) {
            $raw =
                $raw ??
                $this->provider->raw(
                    $row['folder'],
                    $row['UID'],
                    $row['uidvalidity']
                );
            $result = $this->sink->import($row, $raw);
            $result['sha256'] = hash('sha256', $raw);
        }
        if (empty($result['outcome'])) {
            throw new \RuntimeException(
                'Importer did not confirm persisted message or an explicit accepted skip'
            );
        }
        $this->store->remember($mailbox, $identity, $result);
        return $result;
    }
    private function reserveRow(array $row, &$raw)
    {
        if (!method_exists($this->sink, 'reserve')) {
            return null;
        }
        return $this->sink->reserve($row, function () use ($row, &$raw) {
            if ($raw === null) {
                $raw = $this->provider->raw(
                    $row['folder'],
                    $row['UID'],
                    $row['uidvalidity']
                );
            }
            return $raw;
        });
    }

    public function run($mailbox)
    {
        $limit = (int) ($this->options['batch_size'] ?? 25);
        $cap = (int) ($this->options['initial_max_messages'] ?? 0);
        $since = $this->options['initial_since'] ?? null;
        if (
            $limit < 1 ||
            $limit > 500 ||
            $cap < 1 ||
            !is_string($since) ||
            strtotime($since) === false
        ) {
            throw new \RuntimeException(
                'Explicit initial_since, initial_max_messages and bounded batch_size required'
            );
        }
        if (!$this->store->lock($mailbox)) {
            return ['status' => 'busy', 'processed' => 0, 'changed' => 0];
        }
        $summary = ['status' => 'success', 'processed' => 0, 'changed' => 0];
        try {
            $this->provider->connect();
            foreach ($this->store->deferred($mailbox) as $prior) {
                if ($summary['processed'] >= $limit) {
                    break;
                }
                $state = $this->provider->state($prior['folder']);
                if (
                    (string) $state['uidvalidity'] !==
                        (string) $prior['uidvalidity'] ||
                    !$this->provider->uids(
                        $prior['folder'],
                        (int) $prior['UID'] - 1,
                        (int) $prior['UID'],
                        null
                    )
                ) {
                    $this->store->transaction(function () use (
                        $mailbox,
                        $prior
                    ) {
                        $this->store->undefer($mailbox, $prior);
                    });
                    continue;
                }
                $row = $this->provider->metadata(
                    $prior['folder'],
                    $prior['UID']
                );
                if ($this->sink->deferred($row)) {
                    continue;
                }
                $prefetchedRaw = null;
                $reserved = $this->reserveRow($row, $prefetchedRaw);
                if ($reserved === false) {
                    $summary['status'] = 'busy';
                    return $summary;
                }
                try {
                    $result = $this->store->transaction(function () use (
                        $mailbox,
                        $row,
                        $prefetchedRaw
                    ) {
                        $result = $this->ingest($mailbox, $row, $prefetchedRaw);
                        $this->store->undefer($mailbox, $row);
                        if (isset($this->options['before_commit'])) {
                            ($this->options['before_commit'])(
                                $mailbox, self::identity($row), microtime(true)
                            );
                        }
                        return $result;
                    });
                    $summary['processed']++;
                    $summary['changed'] += (int) !empty($result['changed']);
                    if (isset($this->options['after_commit'])) {
                        ($this->options['after_commit'])(
                            $mailbox, self::identity($row), microtime(true)
                        );
                    }
                } finally {
                    if ($reserved) {
                        $this->sink->releaseMessage();
                    }
                }
            }
            $folderBudget = max(
                1,
                (int) floor(
                    ($limit - $summary['processed']) /
                        max(1, count($this->options['folders']))
                )
            );
            foreach ($this->options['folders'] as $folder) {
                $folderProcessed = 0;
                if ($summary['processed'] >= $limit) {
                    break;
                }
                $remote = $this->provider->state($folder);
                $high = (int) $remote['uidnext'] - 1;
                $state = $this->store->source($mailbox, $folder);
                if (
                    !$state ||
                    (string) $state['uidvalidity'] !==
                        (string) $remote['uidvalidity']
                ) {
                    // Never slide recovery forward to today's window: retain the original explicit floor.
                    $floor = $state['seed_since'] ?? $since;
                    $uids = $this->provider->uids($folder, 0, $high, $floor);
                    if (count($uids) > $cap) {
                        throw new \RuntimeException(
                            'Initial/recovery inventory exceeds explicit bound; widen approved cap or reconcile before advancing'
                        );
                    }
                    $state = [
                        'uidvalidity' => (string) $remote['uidvalidity'],
                        'last_uid' => 0,
                        'seed_since' => $floor,
                        'seed_high_uid' => $high,
                        'seeding' => true
                    ];
                }
                if (!$state['seeding'] && (int) $state['last_uid'] > $high) {
                    throw new \RuntimeException(
                        'UIDNEXT regressed without UIDVALIDITY change'
                    );
                }
                $through = $state['seeding']
                    ? (int) $state['seed_high_uid']
                    : $high;
                $uids = $this->provider->uids(
                    $folder,
                    (int) $state['last_uid'],
                    $through,
                    $state['seeding'] ? $state['seed_since'] : null
                );
                foreach ($uids as $uid) {
                    if (
                        $summary['processed'] >= $limit ||
                        $folderProcessed >= $folderBudget
                    ) {
                        break;
                    }
                    $row = $this->provider->metadata($folder, $uid);
                    if (
                        (string) $row['uidvalidity'] !==
                        (string) $state['uidvalidity']
                    ) {
                        throw new \RuntimeException(
                            'UIDVALIDITY changed during batch; retry with bounded recovery'
                        );
                    }
                    $prefetchedRaw = null;
                    $reserved = $this->reserveRow($row, $prefetchedRaw);
                    if ($reserved === false) {
                        $summary['status'] = 'busy';
                        break 2;
                    }
                    try {
                        $next = $state;
                        $next['last_uid'] = (int) $uid;
                        $result = $this->store->transaction(function () use (
                            $mailbox,
                            $folder,
                            $row,
                            $next,
                            $prefetchedRaw
                        ) {
                            if ($this->sink->deferred($row)) {
                                $this->store->defer($mailbox, $row);
                                $result = ['changed' => false];
                            } else {
                                $result = $this->ingest($mailbox, $row, $prefetchedRaw);
                            }
                            $this->store->checkpoint($mailbox, $folder, $next);
                            if (isset($this->options['before_commit'])) {
                                ($this->options['before_commit'])(
                                    $mailbox,
                                    self::identity($row),
                                    microtime(true)
                                );
                            }
                            return $result;
                        });
                        $summary['processed']++;
                        $summary['changed'] += (int) !empty($result['changed']);
                        $state = $next;
                        $folderProcessed++;
                        if (isset($this->options['after_commit'])) {
                            ($this->options['after_commit'])(
                                $mailbox,
                                self::identity($row),
                                microtime(true)
                            );
                        }
                    } finally {
                        if ($reserved) {
                            $this->sink->releaseMessage();
                        }
                    }
                }
                if (!$uids || (int) $state['last_uid'] >= (int) end($uids)) {
                    $state['last_uid'] = $through;
                    $state['seeding'] = false;
                    $this->store->transaction(function () use (
                        $mailbox,
                        $folder,
                        $state
                    ) {
                        $this->store->checkpoint($mailbox, $folder, $state);
                    });
                }
            }
            return $summary;
        } finally {
            try {
                $this->provider->disconnect();
            } finally {
                $this->store->unlock($mailbox);
            }
        }
    }
}

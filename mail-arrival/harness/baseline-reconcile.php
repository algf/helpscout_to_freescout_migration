<?php
namespace MailArrivalEvidence;

/** Capture the existing seed validator's output without writing seed records. */
final class BaselinePlanCapture
{
    public $matches = [];
    public $sources = [];
    public function lock($id) { return true; }
    public function unlock($id) {}
    public function empty() { return true; }
    public function verifyTargets($matches, $lock = false) {}
    public function transaction($callback) { $callback(); }
    public function insertMatch($match) { $this->matches[] = $match; }
    public function insertSource($source) { $this->sources[] = $source; }
}

/** Release-only reconciliation. The caller must first fence every fetch owner. */
final class BaselineReconcile
{
    public static function apply(array $plan, array $folders, $store, callable $remoteState): array
    {
        $held = [];
        try {
            foreach ([1, 2, 3] as $id) {
                if (!$store->lock($id)) {
                    throw new \RuntimeException('IMPORTER_LOCK_UNAVAILABLE');
                }
                $held[] = $id;
            }
            $capture = new BaselinePlanCapture();
            CutoverSeed::apply($plan, $folders, $capture, $remoteState);
            $pending = [];
            foreach ($plan['mailboxes'] as $mailbox) {
                foreach ($mailbox['folders'] as $folder) {
                    $pending[$mailbox['mailbox_id'] . "\0" . $folder['folder']] =
                        array_merge($folder['unknown_uids'], $folder['draft_uids']);
                }
            }
            // Fetch the final provider snapshot before taking row locks. All fetch
            // owners remain fenced and all three advisory locks remain held.
            $remoteStates = [];
            foreach ($capture->sources as $source) {
                $remoteStates[$source['mailbox_id'] . "\0" . $source['folder']] =
                    $remoteState($source['mailbox_id'], $source['folder']);
            }
            $counts = ['matched_identities' => count($capture->matches), 'advanced_sources' => 0,
                'completed_sources_unchanged' => 0, 'deferred_inserted' => 0, 'deferred_retained' => 0];
            $store->transaction(function () use ($store, $capture, $pending, $remoteStates, &$counts) {
                $store->verifyMatches($capture->matches);
                foreach ($capture->sources as $source) {
                    $id = $source['mailbox_id'];
                    $folder = $source['folder'];
                    $state = $store->source($id, $folder);
                    if (!is_array($state) ||
                        (string) ($state['uidvalidity'] ?? '') !== $source['uidvalidity'] ||
                        ($state['seed_since'] ?? null) !== $source['floor'] ||
                        !is_int($state['last_uid'] ?? null) || $state['last_uid'] < 0 ||
                        !is_bool($state['seeding'] ?? null)) {
                        throw new \RuntimeException('CHECKPOINT_SCOPE_MISMATCH');
                    }
                    $remote = $remoteStates[$id . "\0" . $folder];
                    if (!is_array($remote) ||
                        (string) ($remote['uidvalidity'] ?? '') !== $source['uidvalidity'] ||
                        !isset($remote['uidnext']) ||
                        (int) $remote['uidnext'] < max($source['high_uid'], $state['last_uid']) + 1) {
                        throw new \RuntimeException('SOURCE_EPOCH_CHANGED');
                    }
                    if (!$state['seeding']) {
                        if ($state['last_uid'] < $source['high_uid']) {
                            throw new \RuntimeException('COMPLETED_CHECKPOINT_BELOW_FENCE');
                        }
                        $counts['completed_sources_unchanged']++;
                        continue;
                    }
                    if ($state['last_uid'] > $source['high_uid'] ||
                        ($state['seed_high_uid'] ?? null) !== $source['high_uid']) {
                        throw new \RuntimeException('SEED_FENCE_MISMATCH');
                    }
                    // Include even previously passed UIDs: replay is safe and avoids
                    // assuming that an earlier scan imported every unknown identity.
                    foreach ($pending[$id . "\0" . $folder] as $uid) {
                        $inserted = $store->defer($id, [
                            'folder' => $folder,
                            'uidvalidity' => $source['uidvalidity'],
                            'UID' => $uid
                        ]);
                        $counts[$inserted ? 'deferred_inserted' : 'deferred_retained']++;
                    }
                    $state['last_uid'] = $source['high_uid'];
                    $state['seeding'] = false;
                    $store->checkpoint($id, $folder, $state);
                    $counts['advanced_sources']++;
                }
            });
            return $counts;
        } finally {
            foreach (array_reverse($held) as $id) {
                $store->unlock($id);
            }
        }
    }
}

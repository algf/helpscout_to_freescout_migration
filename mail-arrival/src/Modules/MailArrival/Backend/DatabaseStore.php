<?php
namespace Modules\MailArrival;
final class DatabaseStore
{
    public function lock($mailbox)
    {
        return (int) \DB::selectOne('SELECT GET_LOCK(?,0) acquired', [
            'mail-arrival-' . $mailbox
        ])->acquired === 1;
    }
    public function unlock($mailbox)
    {
        \DB::select('SELECT RELEASE_LOCK(?)', ['mail-arrival-' . $mailbox]);
    }
    private function key($mailbox, $value)
    {
        return hash('sha256', $mailbox . "\0" . $value);
    }
    public function source($mailbox, $folder)
    {
        $row = \DB::table('mail_arrival_sources')
            ->where('source_key', $this->key($mailbox, $folder))
            ->first();
        return $row ? json_decode($row->state, true) : null;
    }
    public function checkpoint($mailbox, $folder, array $state)
    {
        \DB::table('mail_arrival_sources')->updateOrInsert(
            ['source_key' => $this->key($mailbox, $folder)],
            ['mailbox_id' => $mailbox, 'state' => json_encode($state)]
        );
    }
    public function message($mailbox, $identity)
    {
        $row = \DB::table('mail_arrival_messages')
            ->where('message_key', $this->key($mailbox, $identity))
            ->first();
        return $row ? (array) $row : null;
    }
    public function remember($mailbox, $identity, array $result)
    {
        \DB::table('mail_arrival_messages')->insert([
            'message_key' => $this->key($mailbox, $identity),
            'mailbox_id' => $mailbox,
            'identity' => $identity,
            'target_thread_id' => $result['thread_id'] ?? null,
            'sha256' => $result['sha256'] ?? null,
            'outcome' => $result['outcome'],
            'committed_at' => gmdate('Y-m-d H:i:s')
        ]);
        if (!empty($result['changed'])) {
            Version::bump($mailbox);
        }
    }
    private $recoveredTransactionConflicts = 0;

    public function recoveredConflicts()
    {
        return $this->recoveredTransactionConflicts;
    }

    private function retryableConflict($error)
    {
        for ($depth = 0; $error && $depth < 8; $depth++, $error = $error->getPrevious()) {
            if (in_array((string) $error->getCode(), ['1020', '1213', '40001'], true)) {
                return true;
            }
            if (isset($error->driverCodes) && array_intersect(['1020', '1213'], $error->driverCodes)) {
                return true;
            }
            if (isset($error->sqlStates) && in_array('40001', $error->sqlStates, true)) {
                return true;
            }
            if (isset($error->errorInfo) && is_array($error->errorInfo) &&
                (in_array((string) ($error->errorInfo[1] ?? ''), ['1020', '1213'], true) ||
                    (string) ($error->errorInfo[0] ?? '') === '40001')) {
                return true;
            }
        }
        return false;
    }

    public function transaction($callback)
    {
        $before = \App\Subscription::$occurred_events;
        for ($attempt = 1; $attempt <= 3; $attempt++) {
            $original = null;
            try {
                return \DB::transaction(function () use ($callback, $before, &$original) {
                    try {
                        $result = $callback();
                        $added = array_slice(
                            \App\Subscription::$occurred_events,
                            count($before)
                        );
                        foreach ($added as $event) {
                            $payload = base64_encode(serialize([$event]));
                            $mailbox = (int) $event['conversation']->mailbox_id;
                            \DB::table('mail_arrival_event_outbox')->updateOrInsert(
                                ['event_key' => hash('sha256', 'subscription:' . $payload)],
                                [
                                    'mailbox_id' => $mailbox,
                                    'kind' => 'subscription',
                                    'payload' => $payload,
                                    'attempts' => 0,
                                    'last_error' => null
                                ]
                            );
                        }
                        return $result;
                    } catch (\Throwable $error) {
                        // Preserve the cause before old Laravel attempts a second
                        // rollback of a transaction already aborted by InnoDB.
                        $original = $error;
                        throw $error;
                    }
                });
            } catch (\Throwable $frameworkError) {
                $connection = \DB::connection();
                $pdo = $connection->getPdo();
                if (!$pdo->inTransaction() && $connection->transactionLevel() > 0) {
                    // Same socket, same advisory reservations. Never reconnect.
                    $connection->setPdo($pdo);
                }
                $failure = $original ?? $frameworkError;
                if ($attempt === 3 || !$this->retryableConflict($failure)) {
                    throw $failure;
                }
                $this->recoveredTransactionConflicts++;
                usleep(random_int(1000, 10000));
            } finally {
                // Failed native attempts cannot retain notifications in memory.
                \App\Subscription::$occurred_events = $before;
            }
        }
    }
    public function defer($mailbox, array $row)
    {
        \DB::table('mail_arrival_deferred')->updateOrInsert(
            [
                'message_key' => $this->key(
                    $mailbox,
                    $row['folder'] .
                        ':' .
                        $row['uidvalidity'] .
                        ':' .
                        $row['UID']
                )
            ],
            ['mailbox_id' => $mailbox, 'source' => json_encode($row)]
        );
    }
    public function deferred($mailbox)
    {
        return array_map(function ($row) {
            return json_decode($row->source, true);
        }, \DB::table('mail_arrival_deferred')
            ->where('mailbox_id', $mailbox)
            ->get()
            ->all());
    }
    public function undefer($mailbox, array $row)
    {
        \DB::table('mail_arrival_deferred')
            ->where(
                'message_key',
                $this->key(
                    $mailbox,
                    $row['folder'] .
                        ':' .
                        $row['uidvalidity'] .
                        ':' .
                        $row['UID']
                )
            )
            ->delete();
    }
}

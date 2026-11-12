<?php
namespace Modules\MailArrival;
/** Preserve safe database diagnostics without exposing native SQL values or email text. */
class NativeProcessingFailure extends \RuntimeException
{
    public $sqlStates;
    public $driverCodes;
    public $safeReasons;

    public function __construct(array $errors)
    {
        $states = [];
        $codes = [];
        foreach ($errors as $error) {
            if (preg_match_all('/SQLSTATE\[([A-Z0-9]{5})\]/', $error, $matches)) {
                $states = array_merge($states, $matches[1]);
            }
            if (preg_match_all(
                '/SQLSTATE\[[A-Z0-9]{5}\](?:\s*\[(\d{3,5})\]|\s*:\s*(?:(?:General error|Serialization failure|Connection failure|Driver error):\s*)?(\d{3,5})\b)/i',
                $error,
                $matches,
                PREG_SET_ORDER
            )) {
                foreach ($matches as $match) {
                    $codes[] = (string) ($match[1] ?: $match[2]);
                }
            }
        }
        $this->sqlStates = array_values(array_unique($states));
        $this->driverCodes = array_values(array_unique($codes));
        // Static reason labels cannot reveal SQL parameters, recipients or bodies.
        $reasons = [
            '1020' => 'Record changed outside transaction read view',
            '1062' => 'Duplicate key',
            '1205' => 'Lock wait timeout',
            '1213' => 'Deadlock',
            '1305' => 'Savepoint or routine missing',
            '2002' => 'Connection unavailable',
            '2006' => 'MySQL server has gone away',
            '2013' => 'Connection lost during query',
            '2014' => 'Commands out of sync or unbuffered query'
        ];
        $this->safeReasons = array_map(function ($code) use ($reasons) {
            return $reasons[$code] ?? 'Database driver rejected statement';
        }, $this->driverCodes);
        parent::__construct(
            'Native processor rejected message; checkpoint retained' .
                ($this->sqlStates ? '; SQLSTATE=' . implode(',', $this->sqlStates) : '') .
                ($this->driverCodes ? '; DRIVER=' . implode(',', $this->driverCodes) : '') .
                ($this->safeReasons ? '; REASON=' . implode(',', $this->safeReasons) : '')
        );
    }
}

/** Calls the native processor, but treats its normally swallowed errors as failed imports. */
class NativeFetch extends \App\Console\Commands\FetchEmails
{
    public $saved = [];
    public $errors = [];
    public $policySkip = false;
    public $acknowledged = false;
    public function logError($message)
    {
        if ($message === 'Skipping an auto-reply to the email notification') {
            $this->policySkip = true;
        } else {
            $this->errors[] = $message;
        }
    }
    public function line($string, $style = null, $verbosity = null)
    {
        if (
            strpos(
                $string,
                'Hook fetch_emails.should_save_thread returned false. Skipping message.'
            ) !== false
        ) {
            $this->policySkip = true;
        }
    }
    // MIME is already fetched with PEEK. No unread filter and no provider flag mutation.
    public function setSeen($message, $mailbox)
    {
        $this->acknowledged = true;
    }
    public function saveCustomerThread(
        $mailbox,
        $message_id,
        $prev_thread,
        $from,
        $to,
        $cc,
        $bcc,
        $subject,
        $body,
        $attachments,
        $headers,
        $date
    ) {
        $thread = parent::saveCustomerThread(...func_get_args());
        $this->saved[] = $thread;
        return $thread;
    }
    public function saveUserThread(
        $mailbox,
        $message_id,
        $prev_thread,
        $user,
        $from,
        $to,
        $cc,
        $bcc,
        $body,
        $attachments,
        $headers,
        $date
    ) {
        $thread = parent::saveUserThread(...func_get_args());
        $this->saved[] = $thread;
        return $thread;
    }
}
final class NativeSink
{
    use ReservesMessageId;

    protected function fallbackMessageId(array $row, callable $loadRaw)
    {
        return 'mail-arrival-' . hash('sha256', $loadRaw()) . '@import.invalid';
    }

    private $mailbox;
    private $transactions;
    public function __construct($mailbox, $transactions = null)
    {
        $this->mailbox = $mailbox;
        $this->transactions = $transactions;
    }
    public function deferred(array $row)
    {
        return false;
    }
    public function known(array $row)
    {
        return null;
    }
    private function existing($messageId)
    {
        $candidates = [
            $messageId,
            \MailHelper::generateMessageId(
                $messageId,
                $this->mailbox->id . $messageId
            )
        ];
        return \App\Thread::whereIn('message_id', $candidates)
            ->whereIn(
                'conversation_id',
                \App\Conversation::where(
                    'mailbox_id',
                    $this->mailbox->id
                )->select('id')
            )
            ->first();
    }
    public function import(array $row, $raw)
    {
        // A rolled-back attempt must not retain Eloquent folder dirty-state caches.
        $this->mailbox = \App\Mailbox::findOrFail($this->mailbox->id);
        $message = \Webklex\PHPIMAP\Message::fromString($raw);
        $mid = trim((string) $message->getMessageId(), '<>');
        // Stable fallback replaces native's body-only ID, which can collide for empty identical bodies.
        if (!$mid) {
            $mid = 'mail-arrival-' . hash('sha256', $raw) . '@import.invalid';
        }
        $fetch = new NativeFetch();
        $fetch->mailbox = $this->mailbox;
        // Fiveways remains on its Gmail grouping path, never native extra-import.
        $fetch->mailboxes = \App\Mailbox::whereIn('id', [1, 2])
            ->get()
            ->filter(function ($candidate) {
                return (int) $candidate->id === (int) $this->mailbox->id ||
                    self::extraImportEligible(
                        $candidate,
                        config('mail_arrival.pause_dir', '/data')
                    );
            });
        // A paused target may not have received the native extra-import yet.
        // Its own provider delivery must create/match the native mailbox-scoped ID,
        // rather than acknowledge another mailbox's global Message-ID as its copy.
        $existing = \App\Thread::where('message_id', $mid)->first();
        $mailboxCopy = self::requiresMailboxCopy($existing, $this->mailbox->id);
        $fetch->processMessage(
            $message,
            $mid,
            $this->mailbox,
            $fetch->mailboxes,
            $mailboxCopy
        );
        if ($fetch->errors) {
            throw new NativeProcessingFailure($fetch->errors);
        }
        $saved = $fetch->saved;
        $acknowledged = $fetch->acknowledged;
        $policySkip = $fetch->policySkip;
        $extra = $fetch->extra_import;
        $fetch->extra_import = [];
        foreach ($extra as $entry) {
            $fetch->saved = [];
            $fetch->errors = [];
            $fetch->policySkip = false;
            $fetch->acknowledged = false;
            $fetch->processMessage(
                $entry['message'],
                $entry['message_id'],
                $entry['mailbox'],
                [],
                true
            );
            if (
                $fetch->errors ||
                (!$fetch->saved &&
                    !$fetch->acknowledged &&
                    !$this->existingExtra($entry))
            ) {
                if ($fetch->errors) {
                    throw new NativeProcessingFailure($fetch->errors);
                }
                throw new \RuntimeException(
                    'Native cross-mailbox import did not persist; checkpoint retained'
                );
            }
            foreach ($fetch->saved as $thread) {
                Version::bump((int) $thread->conversation->mailbox_id);
            }
        }
        if ($saved) {
            $thread = $saved[0];
            if (
                (int) $thread->conversation->mailbox_id !==
                (int) $this->mailbox->id
            ) {
                throw new \RuntimeException('Native target mailbox mismatch');
            }
            return [
                'outcome' => 'imported',
                'thread_id' => $thread->id,
                'changed' => true
            ];
        }
        $thread = $this->existing($mid);
        if ($thread) {
            return [
                'outcome' => 'matched',
                'thread_id' => $thread->id,
                'changed' => false
            ];
        }
        if ($acknowledged || $policySkip) {
            return ['outcome' => 'native_ack_skip', 'changed' => false];
        }
        throw new \RuntimeException(
            'Native processor returned without confirmed thread or policy skip'
        );
    }
    public function afterCommit()
    {
        if ($this->transactions === null) {
            $this->transactions = new DatabaseStore();
        }
        $events = app('events');
        $inner =
            $events instanceof ArrivalEvents ? $events->original() : $events;
        foreach (
            \DB::table('mail_arrival_event_outbox')
                ->where('mailbox_id', $this->mailbox->id)
                ->limit(100)
                ->get()
            as $pending
        ) {
            $before = \App\Subscription::$occurred_events;
            try {
                $this->transactions->transaction(function () use ($pending, $inner) {
                    $claimed = \DB::table('mail_arrival_event_outbox')
                        ->where('event_key', $pending->event_key)
                        ->lockForUpdate()
                        ->first();
                    if (!$claimed) {
                        return;
                    }
                    $payload = unserialize(base64_decode($claimed->payload));
                    if ($pending->kind === 'event') {
                        $inner->dispatch($payload);
                    } else {
                        \App\Subscription::$occurred_events = array_merge(
                            \App\Subscription::$occurred_events,
                            $payload
                        );
                    }
                    \App\Subscription::processEvents();
                    \DB::table('mail_arrival_event_outbox')
                        ->where('event_key', $pending->event_key)
                        ->delete();
                });
            } catch (\Throwable $e) {
                \DB::table('mail_arrival_event_outbox')
                    ->where('event_key', $pending->event_key)
                    ->update([
                        'attempts' => $pending->attempts + 1,
                        'last_error' => get_class($e)
                    ]);
            } finally {
                \App\Subscription::$occurred_events = $before;
            }
        }
        return \DB::table('mail_arrival_event_outbox')
            ->where('mailbox_id', $this->mailbox->id)
            ->count();
    }
    public static function requiresMailboxCopy($existing, $mailboxId)
    {
        return $existing && $existing->conversation &&
            (int) $existing->conversation->mailbox_id !== (int) $mailboxId;
    }

    /** Extra targets retain their own identity pin, active state and owner pause. */
    public static function extraImportEligible($mailbox, $pauseDirectory)
    {
        return in_array((int) $mailbox->id, [1, 2], true) &&
            (DeploymentGuard::local() || DeploymentGuard::matches($mailbox)) &&
            $mailbox->isInActive() &&
            !is_file(
                rtrim($pauseDirectory, '/') .
                    '/mailbox-' .
                    (int) $mailbox->id .
                    '-sync.paused'
            );
    }

    private function existingExtra(array $entry)
    {
        $mid = \MailHelper::generateMessageId(
            $entry['message_id'],
            $entry['mailbox']->id . $entry['message_id']
        );
        return \App\Thread::where('message_id', $mid)
            ->whereIn(
                'conversation_id',
                \App\Conversation::where(
                    'mailbox_id',
                    $entry['mailbox']->id
                )->select('id')
            )
            ->exists();
    }
}

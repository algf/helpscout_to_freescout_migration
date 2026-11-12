<?php
namespace Modules\MailArrival;
final class FivewaysPolicy
{
    public static function labels(array $row)
    {
        return array_map(function ($v) {
            return ltrim($v, '\\');
        }, $row['X-GM-LABELS'] ?? []);
    }
    public static function status(array $rows)
    {
        $labels = [];
        foreach ($rows as $row) {
            $labels = array_merge($labels, self::labels($row));
            if (($row['folder'] ?? '') === '[Gmail]/Spam') {
                $labels[] = 'Spam';
            }
            if (
                in_array(
                    $row['folder'] ?? '',
                    ['[Gmail]/Bin', '[Gmail]/Trash'],
                    true
                )
            ) {
                $labels[] = 'Trash';
            }
        }
        foreach (
            [
                'Trash' => 'deleted',
                'Spam' => 'spam',
                'Active' => 'active',
                'Closed' => 'closed',
                'Inbox' => 'active'
            ]
            as $label => $status
        ) {
            if (in_array($label, $labels, true)) {
                return $status;
            }
        }
        return 'closed';
    }
    public static function assertScope(
        $mailbox,
        array $access,
        array $scope = []
    ) {
        $email = $scope['email'] ?? '';
        $owner = $scope['owner_email'] ?? '';
        $allowed = $scope['allowed_users'] ?? [];
        if (
            !$email || !$owner || !is_array($allowed) || !$allowed ||
            (int) $mailbox->id !== 3 ||
            $mailbox->email !== $email ||
            !in_array($owner, $access, true) ||
            array_diff($access, $allowed)
        ) {
            throw new \RuntimeException(
                'Fiveways mailbox scope or team policy mismatch'
            );
        }
    }

    public static function personMatches(array $addresses, array $labels, array $policy, $deliveryHeaders = '')
    {
        $domain = $policy['team_domain'] ?? '';
        $people = $policy['people'] ?? [];
        $labelMap = $policy['label_people'] ?? [];
        if (!is_string($domain) || !$domain || !is_array($people) || !$people ||
            !is_array($labelMap) || !$labelMap) {
            throw new \RuntimeException('Explicit person-folder identity policy required');
        }
        preg_match_all(
            '/[a-z0-9.!#$%&\x27*+\/=?^_`{|}~-]+@' . preg_quote($domain, '/') . '(?![a-z0-9.-])/i',
            $deliveryHeaders,
            $found
        );
        $addresses = array_map('strtolower', array_merge($addresses, $found[0]));
        $matches = [];
        foreach ($people as $person => $aliases) {
            if (!is_array($aliases) || !$aliases) {
                throw new \RuntimeException('Invalid person-folder alias policy');
            }
            if (array_intersect($addresses, $aliases)) {
                $matches[$person] = true;
            }
        }
        foreach ($labels as $label) {
            if (isset($labelMap[$label])) {
                if (!isset($people[$labelMap[$label]])) {
                    throw new \RuntimeException('Invalid person-folder label policy');
                }
                $matches[$labelMap[$label]] = true;
            }
        }
        return array_keys($matches);
    }
}
/** Incremental equivalent of FivewaysGmailHistory import.php: legacy ledger remains authoritative. */
final class FivewaysSink
{
    use ReservesMessageId;

    protected function fallbackMessageId(array $row, callable $loadRaw)
    {
        list($id, $group) = $this->ids($row);
        return 'fiveways-gmail-' . $id . '@import.invalid';
    }

    private $mailbox;
    private $provider;
    private $folders;
    public function __construct($mailbox, $provider, array $folders)
    {
        $this->mailbox = $mailbox;
        $this->provider = $provider;
        $this->folders = $folders;
        $fixtureScope = DeploymentGuard::fixtureScope(3);
        FivewaysPolicy::assertScope(
            $mailbox,
            $mailbox->usersHavingAccess()->pluck('email')->all(),
            $fixtureScope ?: config('mail_arrival.fiveways.scope', [])
        );
    }
    public function deferred(array $row)
    {
        return in_array('Draft', FivewaysPolicy::labels($row), true);
    }
    private function ids(array $row)
    {
        foreach (['X-GM-MSGID', 'X-GM-THRID'] as $key) {
            if (empty($row[$key]) || !ctype_digit((string) $row[$key])) {
                throw new \RuntimeException(
                    'Fiveways requires stable Gmail message and thread identities'
                );
            }
        }
        return [(string) $row['X-GM-MSGID'], (string) $row['X-GM-THRID']];
    }
    public function known(array $row)
    {
        list($id, $gid) = $this->ids($row);
        $record = \DB::table('fiveways_gmail_history')
            ->where('gmail_id', $id)
            ->first();
        if (!$record) {
            return null;
        }
        $thread = \App\Thread::findOrFail($record->target_thread_id);
        if (
            (int) $thread->conversation->mailbox_id !== 3 ||
            (string) $record->gmail_thread_id !== $gid
        ) {
            throw new \RuntimeException('Legacy Gmail ledger target mismatch');
        }
        return [
            'outcome' => 'matched',
            'thread_id' => $thread->id,
            'sha256' => $record->sha256,
            'changed' => false
        ];
    }
    public function import(array $row, $raw)
    {
        $this->mailbox = \App\Mailbox::findOrFail($this->mailbox->id);
        list($id, $gid) = $this->ids($row);
        $message = \Webklex\PHPIMAP\Message::fromString($raw);
        $fetch = new NativeFetch();
        $mid =
            trim((string) $message->getMessageId(), '<>') ?:
            'fiveways-gmail-' . $id . '@import.invalid';
        $from = $fetch->formatEmailList($message->getFrom());
        $to = $fetch->formatEmailList($message->getTo());
        $cc = $fetch->formatEmailList($message->getCc());
        $bcc = $fetch->formatEmailList($message->getBcc());
        if (!$from) {
            throw new \RuntimeException('Fiveways message has no sender');
        }
        $out =
            in_array('Sent', FivewaysPolicy::labels($row), true) ||
            strtolower($from[0]) === $this->mailbox->email;
        $replyTo = $fetch->formatEmailList($message->getReplyTo());
        if (
            !$out &&
            !empty($replyTo[0]) &&
            !preg_match('/@unknown$/', $replyTo[0])
        ) {
            $from = $replyTo;
        }
        $customerEmail = $out
            ? (array_values(
                    array_diff(
                        array_merge($to, $cc, $bcc),
                        $this->mailbox->getEmails()
                    )
                )[0] ?? $from[0])
            : $from[0];
        $date =
            $fetch->attrToDate($message->getDate()) ?:
            \Carbon\Carbon::parse($row['INTERNALDATE']);
        $date->setTimezone(config('app.timezone'));
        $html = $message->getHTMLBody(false);
        $body = $fetch->separateReply(
            $html ?:
            htmlspecialchars(
                $message->getTextBody() ?? '',
                ENT_QUOTES,
                'UTF-8'
            ),
            (bool) $html,
            false
        );
        $cids = [];
        foreach (
            \DB::table('fiveways_gmail_history')
                ->where('gmail_thread_id', $gid)
                ->get()
            as $record
        ) {
            $target = \App\Thread::findOrFail($record->target_thread_id);
            if ((int) $target->conversation->mailbox_id !== 3) {
                throw new \RuntimeException('Legacy group mailbox mismatch');
            }
            $cids[$target->conversation_id] = true;
        }
        $duplicate = \App\Thread::whereIn('message_id', [
            $mid,
            \MailHelper::generateMessageId($mid, 3 . $mid)
        ])
            ->whereIn(
                'conversation_id',
                \App\Conversation::where('mailbox_id', 3)->select('id')
            )
            ->first();
        if ($duplicate) {
            $cids[$duplicate->conversation_id] = true;
        }
        if (count($cids) > 1) {
            $path =
                config(
                    'mail_arrival.fiveways_history_dir',
                    '/data/fiveways-history'
                ) . '/target-before.json';
            $original = is_file($path)
                ? json_decode(file_get_contents($path), true)
                : [];
            $originalIds = array_column($original['conversations'] ?? [], 'id');
            if (array_diff(array_keys($cids), $originalIds)) {
                throw new \RuntimeException(
                    'Unrecognised split Gmail group; preserve URLs and reconcile manually'
                );
            }
            krsort($cids);
        }
        if ($duplicate) {
            \DB::table('fiveways_gmail_history')->insert([
                'gmail_id' => $id,
                'gmail_thread_id' => $gid,
                'target_thread_id' => $duplicate->id,
                'sha256' => hash('sha256', $raw)
            ]);
            return [
                'outcome' => 'matched',
                'thread_id' => $duplicate->id,
                'changed' => false
            ];
        }
        $conversation = $cids
            ? \App\Conversation::where('id', array_key_first($cids))
                ->lockForUpdate()
                ->firstOrFail()
            : null;
        $before = $conversation ? $conversation->getAttributes() : null;
        $newestBefore = $conversation
            ? strtotime(
                $conversation->last_reply_at ?? $conversation->created_at
            )
            : 0;
        $groupRows = $cids
            ? [$row]
            : $this->provider->groupRows($this->folders, $gid);
        $statusName = FivewaysPolicy::status($groupRows ?: [$row]);
        $status = ['active' => 1, 'closed' => 3, 'spam' => 4, 'deleted' => 3][
            $statusName
        ];
        $fetch->createCustomers(
            array_merge(
                $fetch->attrToArray($message->getFrom()),
                $fetch->attrToArray($message->getTo()),
                $fetch->attrToArray($message->getCc())
            ),
            []
        );
        $customer = \App\Customer::create($customerEmail);
        if (!$conversation) {
            $conversation = new \App\Conversation();
            $conversation->mailbox_id = 3;
            $conversation->type = \App\Conversation::TYPE_EMAIL;
            $conversation->state =
                $statusName === 'deleted'
                    ? \App\Conversation::STATE_DELETED
                    : \App\Conversation::STATE_PUBLISHED;
            $conversation->status = $status;
            $conversation->subject = (string) $message->getSubject();
            $conversation->customer_id = $customer->id;
            $conversation->customer_email = $customerEmail;
            $conversation->created_by_customer_id = $out ? null : $customer->id;
            $conversation->created_by_user_id = $out ? 1 : null;
            $conversation->source_via = $out
                ? \App\Conversation::PERSON_USER
                : \App\Conversation::PERSON_CUSTOMER;
            $conversation->source_type = \App\Conversation::SOURCE_TYPE_EMAIL;
            $conversation->imported = true;
            $conversation->created_at = $date;
            $conversation->updateFolder($this->mailbox);
            $conversation->save();
        }
        $thread = new \App\Thread();
        $thread->conversation_id = $conversation->id;
        $thread->type = $out
            ? \App\Thread::TYPE_MESSAGE
            : \App\Thread::TYPE_CUSTOMER;
        $thread->state = \App\Thread::STATE_PUBLISHED;
        $thread->status = $conversation->status;
        $thread->message_id = \App\Thread::where('message_id', $mid)->exists()
            ? \MailHelper::generateMessageId($mid, 3 . $mid)
            : $mid;
        $thread->headers = $fetch->headerToStr($message->getHeader());
        $thread->body = $body;
        $thread->from = $from[0];
        $thread->setTo($to);
        $thread->setCc($cc);
        $thread->setBcc($bcc);
        $thread->customer_id = $customer->id;
        $thread->created_by_customer_id = $out ? null : $customer->id;
        $thread->created_by_user_id = $out ? 1 : null;
        $thread->source_via = $out
            ? \App\Thread::PERSON_USER
            : \App\Thread::PERSON_CUSTOMER;
        $thread->source_type = \App\Thread::SOURCE_TYPE_EMAIL;
        $thread->imported = true;
        $thread->created_at = $date;
        $thread->updated_at = $date;
        $thread->send_status = $out ? \App\SendLog::STATUS_ACCEPTED : null;
        $thread->save();
        $attachments = $message->getAttachments();
        $saved = $fetch->saveAttachments($attachments, $thread->id);
        if (count($saved) !== count($attachments)) {
            throw new \RuntimeException(
                'Fiveways attachment coverage mismatch'
            );
        }
        foreach ($saved as $attachment) {
            if (
                hash_file(
                    'sha256',
                    $attachment['attachment']->getLocalFilePath()
                ) !==
                hash('sha256', $attachment['imap_attachment']->getContent())
            ) {
                throw new \RuntimeException(
                    'Fiveways attachment hash mismatch'
                );
            }
        }
        $thread->body = $fetch->replaceCidsWithAttachmentUrls(
            $thread->body,
            $saved,
            $conversation,
            false
        );
        $thread->has_attachments =
            count(
                array_filter($saved, function ($a) {
                    return !$a['attachment']->embedded;
                })
            ) > 0;
        $thread->save();
        \DB::table('fiveways_gmail_history')->insert([
            'gmail_id' => $id,
            'gmail_thread_id' => $gid,
            'target_thread_id' => $thread->id,
            'sha256' => hash('sha256', $raw)
        ]);
        $first = $conversation
            ->threads()
            ->whereIn('type', [1, 2])
            ->where('state', 2)
            ->orderBy('created_at')
            ->orderBy('id')
            ->first();
        $last = $conversation
            ->threads()
            ->whereIn('type', [1, 2])
            ->where('state', 2)
            ->orderBy('created_at', 'desc')
            ->orderBy('id', 'desc')
            ->first();
        $conversation
            ->threads()
            ->whereIn('type', [1, 2])
            ->update(['first' => false]);
        $first->first = true;
        $first->save();
        $conversation->created_at = $first->created_at;
        $conversation->last_reply_at = $last->created_at;
        $conversation->last_reply_from = $last->source_via;
        $conversation->threads_count = $conversation
            ->threads()
            ->whereIn('type', [1, 2])
            ->where('state', 2)
            ->count();
        $conversation->setPreview($last->body);
        $conversation->has_attachments = $conversation
            ->threads()
            ->where('has_attachments', true)
            ->exists();
        if ($before) {
            foreach (
                [
                    'status',
                    'state',
                    'user_id',
                    'read_by_user',
                    'customer_id',
                    'customer_email'
                ]
                as $field
            ) {
                $conversation->$field = $before[$field];
            }
            if (
                $last->created_at->timestamp > $newestBefore &&
                $last->type === \App\Thread::TYPE_CUSTOMER &&
                (int) $before['status'] !== \App\Conversation::STATUS_SPAM
            ) {
                $conversation->status = \App\Conversation::STATUS_ACTIVE;
                $conversation->state = \App\Conversation::STATE_PUBLISHED;
                $conversation->read_by_user = false;
            }
        } else {
            $conversation->read_by_user = in_array(
                '\\Seen',
                $row['FLAGS'] ?? [],
                true
            );
            if ($statusName === 'closed') {
                $conversation->closed_at = $last->created_at;
            }
        }
        $conversation->updateFolder($this->mailbox);
        $conversation->save();
        $this->personTags($conversation, $thread, $row);
        $this->mailbox->updateFoldersCounters();
        \DB::table('mail_arrival_index_outbox')->updateOrInsert(
            ['thread_id' => $thread->id],
            ['attempts' => 0, 'last_error' => null]
        );
        return [
            'outcome' => 'imported',
            'thread_id' => $thread->id,
            'changed' => true
        ];
    }
    public function afterCommit()
    {
        if (!\App\Module::isActive('fastersearch')) {
            return \DB::table('mail_arrival_index_outbox')->count();
        }
        foreach (
            \DB::table('mail_arrival_index_outbox')
                ->orderBy('thread_id')
                ->limit(25)
                ->get()
            as $pending
        ) {
            try {
                $threads = \App\Thread::where('id', $pending->thread_id)->get();
                $docs = \Modules\FasterSearch\Providers\FasterSearchServiceProvider::getThreadsDocuments(
                    $threads
                );
                \Modules\FasterSearch\Providers\FasterSearchServiceProvider::indexDocuments(
                    $docs
                );
                \DB::table('mail_arrival_index_outbox')
                    ->where('thread_id', $pending->thread_id)
                    ->delete();
            } catch (\Throwable $e) {
                \DB::table('mail_arrival_index_outbox')
                    ->where('thread_id', $pending->thread_id)
                    ->update([
                        'attempts' => $pending->attempts + 1,
                        'last_error' => get_class($e)
                    ]);
            }
        }
        return \DB::table('mail_arrival_index_outbox')->count();
    }
    private function personTags($conversation, $thread, array $row)
    {
        $base = config(
            'mail_arrival.fiveways_history_dir',
            '/data/fiveways-history'
        );
        $path = $base . '/person-folders.json';
        if (!is_file($path)) {
            return;
        }
        $config = json_decode(file_get_contents($path), true);
        if (($config['mailbox_id'] ?? null) !== 3) {
            throw new \RuntimeException(
                'Fiveways person-folder scope mismatch'
            );
        }
        $addresses = [$thread->from];
        foreach (['to', 'cc', 'bcc'] as $field) {
            $addresses = array_merge(
                $addresses,
                json_decode($thread->$field ?: '[]', true) ?: []
            );
        }
        $deliveryHeaders = '';
        foreach (['Delivered-To', 'X-Original-To', 'Envelope-To'] as $header) {
            $deliveryHeaders .= "\n" . (\MailHelper::getHeader($thread->headers ?? '', $header) ?? '');
        }
        $matches = FivewaysPolicy::personMatches(
            $addresses,
            FivewaysPolicy::labels($row),
            [
                'team_domain' => config('mail_arrival.fiveways.team_domain', ''),
                'people' => config('mail_arrival.fiveways.people', []),
                'label_people' => config('mail_arrival.fiveways.label_people', [])
            ],
            $deliveryHeaders
        );
        foreach ($matches as $person) {
            $entry = $config['people'][$person] ?? [];
            $tag = \Modules\Tags\Entities\Tag::findOrFail(
                $entry['tag_id'] ?? 0
            );
            $folder = \App\Folder::findOrFail($entry['folder_id'] ?? 0);
            if (
                $tag->name !== $person ||
                (int) $folder->mailbox_id !== 3 ||
                (int) $folder->type !== 200 ||
                ($folder->meta['tag_id'] ?? null) !== $tag->id
            ) {
                throw new \RuntimeException(
                    'Fiveways person-folder policy changed'
                );
            }
            $tag->conversations()->syncWithoutDetaching([$conversation->id]);
            $tag->counter = \DB::table('conversation_tag')
                ->where('tag_id', $tag->id)
                ->count();
            $tag->save();
            \CustomFolder::setCounters($folder);
        }
    }
}

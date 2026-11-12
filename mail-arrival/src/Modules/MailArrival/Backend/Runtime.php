<?php
namespace Modules\MailArrival;
/** Keep native non-UI listeners. Only the custom importer's unsafe immediate inbox broadcast is replaced. */
class ArrivalEvents extends \Illuminate\Events\Dispatcher
{
    private $inner;
    private $history;
    public function __construct($inner, $history)
    {
        $this->inner = $inner;
        $this->history = $history;
    }
    public function original()
    {
        return $this->inner;
    }
    public function dispatch($event, $payload = [], $halt = false)
    {
        $name = is_object($event) ? get_class($event) : $event;
        if ($name === \App\Events\RealtimeMailboxNewThread::class) {
            return null;
        }
        if (
            in_array(
                $name,
                [
                    \App\Events\CustomerCreatedConversation::class,
                    \App\Events\CustomerReplied::class,
                    \App\Events\UserReplied::class
                ],
                true
            )
        ) {
            if ($this->history) {
                return null;
            }
            $payload = base64_encode(serialize($event));
            $key = hash(
                'sha256',
                $name . ':' . ($event->thread ?? $event->last_thread)->id
            );
            \DB::table('mail_arrival_event_outbox')->updateOrInsert(
                ['event_key' => $key],
                [
                    'mailbox_id' => (int) $event->conversation->mailbox_id,
                    'kind' => 'event',
                    'payload' => $payload,
                    'attempts' => 0,
                    'last_error' => null
                ]
            );
            return null;
        }
        if (
            $this->history &&
            $name === \Illuminate\Mail\Events\MessageSending::class
        ) {
            throw new \RuntimeException(
                'Sending forbidden in Fiveways history import'
            );
        }
        return $this->inner->dispatch($event, $payload, $halt);
    }
}
/** A separate action registry; the original filters and original action registry remain intact. */
class HistoryHooks extends \TorMorten\Eventy\Events
{
    public function __construct($original)
    {
        parent::__construct();
        $this->filter = $original->getFilter();
    }
}
final class Runtime
{
    public static function enrolled($id, $mailbox = null)
    {
        if (
            !DeploymentGuard::allowed() ||
            !config('mail_arrival.enabled', false) ||
            !in_array((int) $id, [1, 2, 3], true) ||
            !in_array(
                (int) $id,
                array_map('intval', config('mail_arrival.mailbox_ids', [])),
                true
            )
        ) {
            return false;
        }
        if (!DeploymentGuard::local()) {
            try {
                $mailbox = $mailbox ?? \App\Mailbox::findOrFail((int) $id);
                return (int) $mailbox->id === (int) $id &&
                    DeploymentGuard::matches($mailbox);
            } catch (\Throwable $error) {
                return false;
            }
        }
        return true;
    }
    public static function poll($id, array $options = [], $provider = null)
    {
        $id = (int) $id;
        if (
            PHP_SAPI !== 'cli' ||
            !self::enrolled($id)
        ) {
            throw new \RuntimeException(
                'Importer requires explicitly enabled approved CLI mailbox'
            );
        }
        $mailbox = \App\Mailbox::findOrFail($id);
        if (!DeploymentGuard::local() && $provider !== null) {
            throw new \RuntimeException('Provider injection requires local deployment');
        }
        $fixtureScope = DeploymentGuard::fixtureScope($id);
        if ($fixtureScope) {
            $settings = config('mail_arrival.clients.' . $id, []);
            if (
                !$provider &&
                !in_array(
                    $settings['host'] ?? null,
                    ['localhost', '127.0.0.1'],
                    true
                )
            ) {
                throw new \RuntimeException(
                    'Fixture scope requires explicitly injected local provider'
                );
            }
        }
        if (!DeploymentGuard::matches($mailbox)) {
            throw new \RuntimeException('Mailbox identity mismatch');
        }
        $paused = is_file(
            rtrim(config('mail_arrival.pause_dir', '/data'), '/') .
                '/mailbox-' .
                $id .
                '-sync.paused'
        );
        if ($paused || !$mailbox->isInActive()) {
            return [
                'status' => $paused ? 'paused' : 'disabled',
                'mailbox_id' => $id,
                'processed' => 0,
                'changed' => 0,
                'version' => Version::forMailbox($id)
            ];
        }
        $options = array_replace(
            config('mail_arrival.mailboxes.' . $id, []),
            $options
        );
        if (empty($options['folders'])) {
            $options['folders'] =
                $id === 3
                    ? ['[Gmail]/All Mail', '[Gmail]/Spam', '[Gmail]/Bin']
                    : ($id === 1
                        ? ['INBOX']
                        : $mailbox->getInImapFolders());
        }
        if (!$provider) {
            $settings = config('mail_arrival.clients.' . $id);
            $client = $settings
                ? (new \Webklex\PHPIMAP\ClientManager())->make($settings)
                : \MailHelper::getMailboxClient($mailbox);
            $provider = new ImapProvider(
                $client,
                $id === 3 ||
                    stripos(
                        $settings['host'] ?? $mailbox->in_server,
                        'gmail'
                    ) !== false ||
                    !empty($options['gmail'])
            );
        }
        if ($id !== 3) {
            $connection = config('queue.default');
            if (
                config('queue.connections.' . $connection . '.driver') !==
                    'database' ||
                (config('queue.connections.' . $connection . '.connection') &&
                    config(
                        'queue.connections.' . $connection . '.connection'
                    ) !== config('database.default'))
            ) {
                throw new \RuntimeException(
                    'Native import requires transactional database queue on the application connection'
                );
            }
        }
        $events = app('events');
        $guard = new ArrivalEvents($events, $id === 3);
        \Event::swap($guard);
        $flushed = false;
        $queue = null;
        $authManager = \Auth::getFacadeRoot();
        $hooks = \Eventy::getFacadeRoot();
        if ($id === 3) {
            \Eventy::swap(new HistoryHooks($hooks));
            $queue = \Queue::getFacadeRoot();
            \Queue::swap(
                new \Illuminate\Support\Testing\Fakes\QueueFake(app())
            );
            \Auth::swap(new \Illuminate\Auth\AuthManager(app()));
            \Auth::setUser(\App\User::findOrFail(1));
        }
        try {
            $transactions = new DatabaseStore();
            $sink =
                $id === 3
                    ? new FivewaysSink($mailbox, $provider, $options['folders'])
                    : new NativeSink($mailbox, $transactions);
            $result = (new Engine(
                $provider,
                $transactions,
                $sink,
                $options
            ))->run($id);
            if (method_exists($sink, 'afterCommit')) {
                $result['pending_side_effects'] = $sink->afterCommit();
            }
            $result['recovered_transaction_conflicts'] = $transactions->recoveredConflicts();
            $flushed = true;
            $result['mailbox_id'] = $id;
            $result['version'] = Version::forMailbox($id);
            $result['completed_at'] = microtime(true);
            return $result;
        } finally {
            try {
                if (!$flushed && isset($sink) && $id !== 3) {
                    $sink->afterCommit();
                }
            } finally {
                \Event::swap($events);
                if ($queue !== null) {
                    \Queue::swap($queue);
                }
                if ($id === 3) {
                    \Auth::swap($authManager);
                    \Eventy::swap($hooks);
                }
            }
        }
    }
}

/** Web-group middleware captures BEFORE MailboxesController paginates, not after its query. */
final class CaptureVersion
{
    public function handle($request, \Closure $next)
    {
        if (
            config('mail_arrival.enabled', false) &&
            preg_match('~^mailbox/(\d+)(?:/|$)~', $request->path(), $match)
        ) {
            $id = (int) $match[1];
            if (in_array($id, [1, 2, 3], true)) {
                app()->instance('mailarrival.captured', [
                    'mailbox_id' => $id,
                    'version' => Version::forMailbox($id)
                ]);
            }
        }
        return $next($request);
    }
}

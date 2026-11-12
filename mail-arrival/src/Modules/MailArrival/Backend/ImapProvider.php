<?php
namespace Modules\MailArrival;
/** Real Webklex protocol adapter. Eligibility never depends on flags or read-only SELECT support. */
final class ImapProvider
{
    private $client;
    private $protocol;
    private $gmail;
    public function __construct($client, $gmail = true)
    {
        $this->client = $client;
        $this->gmail = $gmail;
    }
    public function connect()
    {
        $this->client->connect();
        $this->protocol = $this->client->getConnection();
    }
    public function disconnect()
    {
        $this->client->disconnect();
    }
    public function state($folder)
    {
        $state = $this->protocol->selectFolder($folder);
        if (
            !is_array($state) ||
            empty($state['uidvalidity']) ||
            !isset($state['uidnext'])
        ) {
            throw new \RuntimeException(
                'IMAP source lacks UIDVALIDITY/UIDNEXT'
            );
        }
        return [
            'uidvalidity' => (string) $state['uidvalidity'],
            'uidnext' => (int) $state['uidnext']
        ];
    }
    public function uids($folder, $after, $through, $since = null)
    {
        $this->state($folder);
        if ($through <= $after) {
            return [];
        }
        $terms = ['UID', ((int) $after + 1) . ':' . (int) $through];
        if ($since !== null) {
            try {
                // A date-only catch-up floor is a UTC calendar date. Never let
                // the application's timezone move it to the previous UTC day.
                $utc = new \DateTimeZone('UTC');
                $date = new \DateTimeImmutable($since, $utc);
                $errors = \DateTimeImmutable::getLastErrors();
                if ($errors && ($errors['warning_count'] || $errors['error_count'])) {
                    throw new \RuntimeException('Invalid IMAP initial date');
                }
            } catch (\Throwable $error) {
                throw new \RuntimeException('Invalid IMAP initial date');
            }
            $terms[] = 'SINCE';
            $terms[] = $date->setTimezone($utc)->format('d-M-Y');
        }
        $uids = array_map('intval', $this->protocol->search($terms));
        // RFC3501 reversed ranges and '*': never trust SEARCH alone to enforce the bound.
        $uids = array_values(
            array_unique(
                array_filter($uids, function ($uid) use ($after, $through) {
                    return $uid > $after && $uid <= $through;
                })
            )
        );
        sort($uids, SORT_NUMERIC);
        return $uids;
    }
    public function metadata($folder, $uid)
    {
        $state = $this->state($folder);
        $fields = ['UID', 'INTERNALDATE', 'FLAGS', 'BODY.PEEK[HEADER]'];
        if ($this->gmail) {
            $fields = array_merge($fields, [
                'X-GM-MSGID',
                'X-GM-THRID',
                'X-GM-LABELS'
            ]);
        }
        $rows = $this->protocol->fetch($fields, (int) $uid, (int) $uid);
        $row = $rows[$uid] ?? null;
        if (!$row || (int) ($row['UID'] ?? 0) !== (int) $uid) {
            throw new \RuntimeException(
                'IMAP UID unavailable; reconcile source before advancing'
            );
        }
        $row['uidvalidity'] = $state['uidvalidity'];
        $row['folder'] = $folder;
        return $row;
    }
    public function groupRows(array $folders, $gid, $cap = 1000)
    {
        if (!ctype_digit((string) $gid)) {
            throw new \RuntimeException('Invalid Gmail group');
        }
        $rows = [];
        foreach ($folders as $folder) {
            $this->state($folder);
            $uids = array_unique(
                array_map(
                    'intval',
                    $this->protocol->search(['X-GM-THRID', (string) $gid])
                )
            );
            if (count($rows) + count($uids) > $cap) {
                throw new \RuntimeException(
                    'Gmail group metadata exceeds explicit bound'
                );
            }
            foreach ($uids as $uid) {
                $row = $this->metadata($folder, $uid);
                if ((string) ($row['X-GM-THRID'] ?? '') !== (string) $gid) {
                    throw new \RuntimeException('Gmail group search mismatch');
                }
                $rows[(string) $row['X-GM-MSGID']] = $row;
            }
        }
        return array_values($rows);
    }
    public function raw($folder, $uid, $expectedValidity = null)
    {
        $before = $this->state($folder);
        if (
            $expectedValidity !== null &&
            (string) $before['uidvalidity'] !== (string) $expectedValidity
        ) {
            throw new \RuntimeException(
                'UIDVALIDITY changed before MIME fetch'
            );
        }
        $rows = $this->protocol->fetch(
            ['UID', 'BODY.PEEK[]'],
            (int) $uid,
            (int) $uid
        );
        $after = $this->state($folder);
        if (
            (string) $before['uidvalidity'] !== (string) $after['uidvalidity']
        ) {
            throw new \RuntimeException(
                'UIDVALIDITY changed during MIME fetch'
            );
        }
        $raw = $rows[$uid]['BODY[]'] ?? null;
        if (!is_string($raw) || strpos($raw, "\r\n\r\n") === false) {
            throw new \RuntimeException('Incomplete IMAP MIME source');
        }
        return $raw;
    }
}

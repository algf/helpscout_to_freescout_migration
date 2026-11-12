<?php
/** Metadata-only live observation. No mailbox mutation, headers or MIME bodies. */
namespace MailArrivalEvidence;

final class LiveObserver
{
    private $protocol;
    private $mailbox;
    private $folders;
    private $lookup;
    private $clock;
    private $states = [];
    private $candidates = [];
    private $baselineUpperMs;
    private $cap;

    public function __construct($protocol, int $mailbox, array $folders, callable $lookup, callable $clock, int $cap = 20)
    {
        if (!in_array($mailbox, [1, 2, 3], true) || !$folders || count($folders) > 5 || count(array_unique($folders)) !== count($folders) || $cap < 1 || $cap > 50) {
            throw new \RuntimeException('Observation scope is not approved');
        }
        foreach ($folders as $folder) if (!is_string($folder) || $folder === '' || strlen($folder) > 255 || preg_match('/[\x00-\x1f\x7f]/', $folder)) throw new \RuntimeException('Observation folder is invalid');
        $this->protocol = $protocol; $this->mailbox = $mailbox; $this->folders = $folders;
        $this->lookup = $lookup; $this->clock = $clock; $this->cap = $cap;
    }

    private function nowMs(): int { return (int) floor(($this->clock)() * 1000); }
    private function state(string $folder): array
    {
        // EXAMINE is the read-only IMAP command. Never select read-write, STORE or fetch content.
        $s = $this->protocol->examineFolder($folder);
        if (!is_array($s) || empty($s['uidvalidity']) || !isset($s['uidnext']) || (int) $s['uidnext'] < 1) {
            throw new \RuntimeException('Read-only folder state unavailable');
        }
        return ['uidvalidity' => (string) $s['uidvalidity'], 'uidnext' => (int) $s['uidnext']];
    }
    public function baseline(): array
    {
        if ($this->states) throw new \RuntimeException('Baseline already captured');
        $started = $this->nowMs();
        foreach ($this->folders as $folder) $this->states[$folder] = $this->state($folder);
        $this->baselineUpperMs = $this->nowMs();
        return ['event' => 'baseline', 'mailbox_id' => $this->mailbox, 'started_ms' => $started, 'completed_ms' => $this->baselineUpperMs, 'folder_count' => count($this->states)];
    }
    public function sample(): array
    {
        if (!$this->states) throw new \RuntimeException('Capture baseline first');
        foreach ($this->folders as $folder) {
            $old = $this->states[$folder]; $remote = $this->state($folder);
            if ($remote['uidvalidity'] !== $old['uidvalidity'] || $remote['uidnext'] < $old['uidnext']) throw new \RuntimeException('Source epoch or UIDNEXT changed unexpectedly');
            $high = $remote['uidnext'] - 1; $low = $old['uidnext'];
            if ($high >= $low) {
                $uids = $this->protocol->search(['UID', $low . ':' . $high]);
                $uids = array_values(array_unique(array_map('intval', $uids))); sort($uids, SORT_NUMERIC);
                if (count($uids) > $this->cap || count($this->candidates) + count($uids) > $this->cap) throw new \RuntimeException('Observation bound exceeded');
                foreach ($uids as $uid) {
                    if ($uid < $low || $uid > $high) throw new \RuntimeException('Source returned out-of-range UID');
                    $rows = $this->protocol->fetch(['UID', 'INTERNALDATE', 'X-GM-MSGID'], $uid, $uid);
                    $row = $rows[$uid] ?? null;
                    if (!$row || (int) ($row['UID'] ?? 0) !== $uid || !ctype_digit((string) ($row['X-GM-MSGID'] ?? ''))) throw new \RuntimeException('Stable source metadata unavailable');
                    if (!preg_match('/^\d{1,2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/', (string) ($row['INTERNALDATE'] ?? ''))) throw new \RuntimeException('Provider receipt date invalid');
                    try { $received = new \DateTimeImmutable((string) $row['INTERNALDATE']); } catch (\Throwable $e) { throw new \RuntimeException('Provider receipt date invalid'); }
                    $receivedMs = $received->getTimestamp() * 1000;
                    // INTERNALDATE has one-second precision. Exclude ambiguous pre-baseline history.
                    if ($receivedMs < $this->baselineUpperMs) continue;
                    $gmail = (string) $row['X-GM-MSGID'];
                    $key = hash('sha256', $this->mailbox . "\0" . $gmail);
                    if (!isset($this->candidates[$key])) $this->candidates[$key] = ['gmail' => $gmail, 'provider_received_lower_ms' => $receivedMs, 'provider_received_upper_ms' => $receivedMs + 999, 'provider_observed_ms' => $this->nowMs(), 'last_absent_lower_ms' => null, 'reported' => false];
                }
            }
            $this->states[$folder] = $remote;
        }
        $events = [];
        foreach ($this->candidates as $key => &$candidate) {
            if ($candidate['reported']) continue;
            $queryStart = $this->nowMs(); $result = ($this->lookup)($this->mailbox, 'gmail:' . $candidate['gmail']); $queryEnd = $this->nowMs();
            if ($result === null) { $candidate['last_absent_lower_ms'] = $queryStart; continue; }
            if (empty($result['thread_id']) || empty($result['conversation_id']) || empty($result['ledger_written_at_utc'])) throw new \RuntimeException('Committed ledger target incomplete');
            if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', (string) $result['ledger_written_at_utc'])) throw new \RuntimeException('Ledger timestamp invalid');
            try { $written = new \DateTimeImmutable($result['ledger_written_at_utc'], new \DateTimeZone('UTC')); } catch (\Throwable $e) { throw new \RuntimeException('Ledger timestamp invalid'); }
            $commitLower = max($written->getTimestamp() * 1000, $candidate['last_absent_lower_ms'] ?? 0);
            if ($commitLower > $queryEnd || $candidate['provider_received_lower_ms'] > $queryEnd) throw new \RuntimeException('Clock or ledger timestamp inconsistent');
            $events[] = ['event' => 'ledger_visible', 'mailbox_id' => $this->mailbox, 'opaque_id' => $key, 'conversation_id' => (int) $result['conversation_id'], 'provider_received_lower_ms' => $candidate['provider_received_lower_ms'], 'provider_received_upper_ms' => $candidate['provider_received_upper_ms'], 'provider_observed_ms' => $candidate['provider_observed_ms'], 'ledger_written_lower_ms' => $written->getTimestamp() * 1000, 'commit_lower_ms' => $commitLower, 'commit_upper_ms' => $queryEnd];
            $candidate['reported'] = true;
        }
        unset($candidate);
        return $events;
    }
}

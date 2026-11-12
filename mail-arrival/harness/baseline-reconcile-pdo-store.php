<?php
namespace MailArrivalEvidence;

/** One PDO owns every lock and the complete reconciliation transaction. */
final class BaselineReconcilePdoStore
{
    private $pdo;
    private $seed;
    public function __construct(\PDO $pdo)
    {
        $this->pdo = $pdo;
        $this->seed = new CutoverPdoStore($pdo);
    }
    public function lock($id) { return $this->seed->lock($id); }
    public function unlock($id) { $this->seed->unlock($id); }
    public function transaction($callback) { $this->seed->transaction($callback); }

    public function verifyMatches(array $matches)
    {
        $this->seed->verifyTargets($matches, true);
        foreach (array_chunk($matches, 100) as $chunk) {
            $expected = [];
            foreach ($chunk as $match) {
                $identity = 'gmail:' . $match['gmail_id'];
                $key = hash('sha256', $match['mailbox_id'] . "\0" . $identity);
                $expected[$key] = [$match['mailbox_id'], $identity, $match['thread_id']];
            }
            $marks = implode(',', array_fill(0, count($expected), '?'));
            $query = $this->pdo->prepare("SELECT message_key,mailbox_id,identity,target_thread_id FROM mail_arrival_messages WHERE message_key IN ($marks) FOR UPDATE");
            $query->execute(array_keys($expected));
            $found = [];
            while ($row = $query->fetch(\PDO::FETCH_ASSOC)) {
                $found[$row['message_key']] = [(int) $row['mailbox_id'], $row['identity'], (int) $row['target_thread_id']];
            }
            $query->closeCursor();
            foreach ($expected as $key => $value) {
                if (($found[$key] ?? null) !== $value) {
                    throw new \RuntimeException('MATCHED_LEDGER_MISMATCH');
                }
            }
        }
    }

    public function source($id, $folder)
    {
        $query = $this->pdo->prepare('SELECT mailbox_id,state FROM mail_arrival_sources WHERE source_key=? FOR UPDATE');
        $query->execute([hash('sha256', $id . "\0" . $folder)]);
        $row = $query->fetch(\PDO::FETCH_ASSOC);
        $query->closeCursor();
        if (!$row || (int) $row['mailbox_id'] !== $id) {
            throw new \RuntimeException('CHECKPOINT_SCOPE_MISMATCH');
        }
        return json_decode($row['state'], true, 32, JSON_THROW_ON_ERROR);
    }

    public function defer($id, array $source)
    {
        $key = hash('sha256', $id . "\0" . $source['folder'] . ':' . $source['uidvalidity'] . ':' . $source['UID']);
        $query = $this->pdo->prepare('SELECT mailbox_id,source FROM mail_arrival_deferred WHERE message_key=? FOR UPDATE');
        $query->execute([$key]);
        $existing = $query->fetch(\PDO::FETCH_ASSOC);
        $query->closeCursor();
        if ($existing) {
            $prior = json_decode($existing['source'], true, 32, JSON_THROW_ON_ERROR);
            if ((int) $existing['mailbox_id'] !== $id || !is_array($prior) ||
                ($prior['folder'] ?? null) !== $source['folder'] ||
                (string) ($prior['uidvalidity'] ?? '') !== $source['uidvalidity'] ||
                (string) ($prior['UID'] ?? '') !== (string) $source['UID']) {
                throw new \RuntimeException('DEFERRED_SCOPE_MISMATCH');
            }
            return false;
        }
        $query = $this->pdo->prepare('INSERT INTO mail_arrival_deferred (message_key,mailbox_id,source) VALUES (?,?,?)');
        $query->execute([$key, $id, json_encode($source, JSON_THROW_ON_ERROR)]);
        return true;
    }

    public function checkpoint($id, $folder, array $state)
    {
        $query = $this->pdo->prepare('UPDATE mail_arrival_sources SET state=? WHERE source_key=? AND mailbox_id=?');
        $query->execute([json_encode($state, JSON_THROW_ON_ERROR), hash('sha256', $id . "\0" . $folder), $id]);
        if ($query->rowCount() !== 1) {
            throw new \RuntimeException('CHECKPOINT_WRITE_FAILED');
        }
    }
}

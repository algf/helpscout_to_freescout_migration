<?php
namespace Modules\MailArrival;

final class MessageReservation
{
    public static function headerId(array $row)
    {
        $header = $row['BODY[HEADER]'] ?? $row['RFC822.HEADER'] ?? '';
        $header = preg_replace('/\r?\n[ \t]+/', ' ', $header);
        if (!preg_match('/^Message-ID:[ \t]*(.+)$/mi', $header, $match)) {
            return null;
        }
        $id = preg_replace('/\s+/', '', trim($match[1], "<> \t\r\n"));
        return $id !== '' ? $id : null;
    }

    public static function key($messageId)
    {
        // MySQL advisory lock names are bounded. Logs never need the raw Message-ID.
        return 'mail-arrival-mid:' . substr(hash('sha256', $messageId), 0, 40);
    }
}

trait ReservesMessageId
{
    private $heldMessageReservation;

    public function reserve(array $row, callable $loadRaw)
    {
        $id = MessageReservation::headerId($row);
        if ($id === null) {
            $id = $this->fallbackMessageId($row, $loadRaw);
        }
        $key = MessageReservation::key($id);
        $result = \DB::selectOne('SELECT GET_LOCK(?,0) acquired', [$key]);
        if ((int) $result->acquired !== 1) {
            return false;
        }
        $this->heldMessageReservation = $key;
        return true;
    }

    public function releaseMessage()
    {
        if ($this->heldMessageReservation === null) {
            return;
        }
        $key = $this->heldMessageReservation;
        $this->heldMessageReservation = null;
        \DB::select('SELECT RELEASE_LOCK(?)', [$key]);
    }
}

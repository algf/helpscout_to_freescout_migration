<?php
namespace Modules\MailArrival;

final class PollCadence
{
    public static function delay($startedAt, $finishedAt, $interval, $failures)
    {
        if ($failures > 0) {
            // Failed polls retain the bounded backoff after the attempt finishes.
            return min(60, $interval * pow(2, min($failures - 1, 3)));
        }
        // A healthy worker starts on an interval, rather than adding its work time.
        // An overrun starts one new attempt; it never replays missed timer ticks.
        return max(0, $startedAt + $interval - $finishedAt);
    }
}

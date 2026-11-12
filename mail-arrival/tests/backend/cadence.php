<?php
namespace {
require_once $argv[1].'/Backend/PollCadence.php';
function check($ok,$label){if(!$ok)throw new RuntimeException($label);echo"PASS $label\n";}
use Modules\MailArrival\PollCadence;
check(abs(PollCadence::delay(100,102,10,0)-8)<0.001,'healthy cadence subtracts poll work duration');
check(PollCadence::delay(100,112,10,0)===0,'overrun never queues overlapping missed ticks');
check(abs(PollCadence::delay(112,112.5,10,0)-9.5)<0.001,'next cadence anchors to new attempt after an overrun');
check(PollCadence::delay(100,102,10,1)===10,'first transient failure keeps full retry wait');
check(PollCadence::delay(100,102,10,4)===60,'retry backoff is bounded to sixty seconds');
echo"BACKEND_CADENCE_PASS\n";
}

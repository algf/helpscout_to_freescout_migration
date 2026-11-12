<?php
namespace App {
    class Thread {
        const TYPE_CUSTOMER = 1;
        const TYPE_MESSAGE = 2;
        const TYPE_NOTE = 3;
        const TYPE_LINEITEM = 4;
        const STATE_DRAFT = 1;
        const STATE_PUBLISHED = 2;
    }
}
namespace {
class Eventy { static $filter; static function addFilter($n, $f, $p) { self::$filter = $f; } static function addAction($n, $f, $p, $a = 1) {} }
class Helper { static $print = false; static function isPrint() { return self::$print; } }
class Container { public $data = []; function instance($k, $v) { $this->data[$k] = $v; } }
class Request { public $full = false; function has($k) { return $this->full; } }
class Collection implements \IteratorAggregate {
    public $items;
    function __construct($a) { $this->items = $a; }
    function getIterator(): \Traversable { return new \ArrayIterator($this->items); }
    function take($n) { return new self(array_slice($this->items, 0, $n, true)); }
    function pluck($key) { return new self(array_map(function ($v) use ($key) { return $v->$key; }, $this->items)); }
    function all() { return $this->items; }
    function filter($f) { return new self(array_filter($this->items, $f)); }
    function values() { return new self(array_values($this->items)); }
    function count() { return count($this->items); }
}
$c = new Container; $r = new Request;
function app() { global $c; return $c; }
function request() { global $r; return $r; }
require $argv[1];
$run = Eventy::$filter;
function check($ok, $message) { if (!$ok) throw new \Exception($message); echo "PASS $message\n"; }
function thread($id, $type = 1, $state = 2, $time = null, $body = '<p>Real message</p>') {
    return (object) ['id' => $id, 'type' => $type, 'state' => $state, 'created_at' => (object) ['timestamp' => $time === null ? $id : $time], 'body' => $body];
}
function assertIds($items, $expected, $message) {
    global $run, $c;
    $all = new Collection($items); $visible = $run($all);
    check($visible->pluck('id')->all() === $expected, $message);
    check(array_keys($visible->items) === ($expected ? range(0, count($expected) - 1) : []), $message.' contiguous keys');
    check(count(array_unique($expected)) === $visible->count(), $message.' no duplicate IDs');
    check($c->data['conversationhistory.hidden'] === count($items) - count($expected), $message.' hidden count');
    foreach ($visible->items as $row) check(in_array($row, $items, true), $message.' original model '.$row->id);
    return $visible;
}
$items = []; for ($i = 30; $i > 0; $i--) $items[] = thread($i, 1, $i === 2 ? 1 : 2);
assertIds($items, array_merge(range(30, 19), [2]), 'latest twelve plus older draft');
foreach ([1 => 'customer', 2 => 'sent message', 3 => 'note'] as $type => $label) {
    $activity = []; for ($i = 30; $i >= 19; $i--) $activity[] = thread($i, 4);
    assertIds(array_merge($activity, [thread(18, $type), thread(17, 1), thread(2, 2, 1)]), array_merge(range(30, 19), [18, 2]), 'twelve lineitems retain latest '.$label.' and draft');
    assertIds(array_merge([thread(31, 2, 1)], $activity, [thread(18, $type), thread(17, 1)]), array_merge([31], range(30, 20), [18]), 'newer draft does not replace latest '.$label);
}
assertIds(array_merge(array_slice($activity, 0, 11), [thread(18), thread(17)]), array_merge(range(30, 20), [18]), 'eleven lineitems need no extra row');
assertIds(array_merge($activity, [thread(2, 2, 1)]), array_merge(range(30, 19), [2]), 'activity and draft only');
assertIds($activity, range(30, 19), 'activity only');
assertIds([], [], 'empty history');
// Timeline orders by timestamp, then numeric ID, even if native collection ties differ.
assertIds(array_merge($activity, [thread(9, 1, 2, 10), thread(10, 1, 2, 10), thread(50, 1, 2, 9)]), array_merge(range(30, 19), [10]), 'timestamp tie uses numeric ID');
assertIds(array_merge($activity, [thread(10, 1, 2, 10), thread(9, 1, 2, 10)]), array_merge(range(30, 19), [10]), 'timestamp tie independent of input order');
// Body parsing must match the timeline preview marker, including quote fallback.
foreach ([
    '<p><strong>Imported Help Scout activity</strong></p><p>Status changed</p>',
    '<p>&#73;mported&nbsp;Help<br>Scout <span>activity</span></p>',
    '<script>unrelated</script><style>p{color:red}</style><p>Imported Help Scout activity: changed</p>',
    '<blockquote><p>Imported Help Scout activity: quoted only</p></blockquote>',
    '<div class="thread-meta">Metadata</div><p>Imported Help Scout activity</p>',
    '<p>Imp<script>ignored</script>orted Help Scout activity</p>',
    '<p>Imported Help Scout <b>activity',
] as $index => $body) {
    assertIds(array_merge($activity, [thread(18, 3, 2, null, $body), thread(17)]), array_merge(range(30, 19), [17]), 'skip imported activity shape '.$index);
}
foreach ([
    null,
    '',
    '<p>Real <b>note',
    '<p>Real note</p><blockquote>Imported Help Scout activity</blockquote>',
    '<blockquote>Imported Help Scout activity</blockquote><p>Real note</p>',
    '<p>Imported Help Scout activitylog is a real note</p>',
    '<p>A real note about Imported Help Scout activity</p>',
    '<p>Quoted customer reply</p><blockquote>Earlier email</blockquote>',
    '<p></p><div class="thread-attachments">Attachment only</div>',
] as $index => $body) {
    assertIds(array_merge($activity, [thread(18, 3, 2, null, $body), thread(17)]), array_merge(range(30, 19), [18]), 'retain eligible body shape '.$index);
}
$all = new Collection($items);
$r->full = true; check($run($all) === $all, 'full history original collection retained'); check($c->data['conversationhistory.hidden'] === 0, 'full request clears hidden state');
$r->full = false; $run($all); Helper::$print = true;
check($run($all) === $all, 'print original collection retained'); check($c->data['conversationhistory.hidden'] === 0, 'print clears hidden state');
Helper::$print = false;
assertIds(array_slice($items, 0, 3), [30, 29, 28], 'short history complete and clears hidden state');
}

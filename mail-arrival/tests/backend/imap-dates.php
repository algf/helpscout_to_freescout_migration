<?php
namespace {
require_once $argv[1].'/Backend/ImapProvider.php';
function check($ok,$label) {if(!$ok)throw new RuntimeException($label); echo "PASS $label\n";}
class DateProtocol {
    public $searches=[];
    public function selectFolder($folder) {return ['uidvalidity'=>1,'uidnext'=>101];}
    public function search($terms) {$this->searches[]=$terms; return [];}
}
$protocol=new DateProtocol();
$client=new class($protocol) {
    private $protocol;
    public function __construct($protocol) {$this->protocol=$protocol;}
    public function connect() {}
    public function getConnection() {return $this->protocol;}
};
$provider=new \Modules\MailArrival\ImapProvider($client);
$provider->connect();
$prior=date_default_timezone_get();
try {
    foreach (['Australia/Sydney','UTC'] as $timezone) {
        date_default_timezone_set($timezone);
        $provider->uids('INBOX',0,100,'2026-11-09');
        check(end($protocol->searches)===['UID','1:100','SINCE','09-Nov-2026'],"date-only floor stays 09 November under $timezone");
        $provider->uids('INBOX',0,100,'2026-04-05');
        check(end($protocol->searches)===['UID','1:100','SINCE','05-Apr-2026'],"daylight-saving transition retains explicit floor under $timezone");
        $provider->uids('INBOX',0,100,'2026-11-09T00:00:00Z');
        check(end($protocol->searches)===['UID','1:100','SINCE','09-Nov-2026'],"explicit UTC instant retains its day under $timezone");
        $provider->uids('INBOX',0,100,null);
        check(end($protocol->searches)===['UID','1:100'],"steady UID search has no accidental date floor under $timezone");
    }
    foreach (['not-a-date','2026-02-30'] as $invalid) {
        $before=count($protocol->searches);
        try {$provider->uids('INBOX',0,100,$invalid); throw new RuntimeException('Expected invalid date failure');}
        catch (RuntimeException $error) {check($error->getMessage()==='Invalid IMAP initial date'&&count($protocol->searches)===$before,'invalid date cannot issue an IMAP search');}
    }
} finally {date_default_timezone_set($prior);}
echo "BACKEND_IMAP_DATES_PASS\n";
}

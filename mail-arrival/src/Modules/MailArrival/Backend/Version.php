<?php
namespace Modules\MailArrival;
final class Version
{
    public static function forMailbox($id)
    {
        if (
            !in_array((int) $id, [1, 2, 3], true) ||
            !\Schema::hasTable('mail_arrival_versions')
        ) {
            return '0';
        }
        return (string) (\DB::table('mail_arrival_versions')
            ->where('mailbox_id', (int) $id)
            ->value('version') ?:
        0);
    }
    public static function bump($id)
    {
        \DB::statement(
            'INSERT INTO mail_arrival_versions (mailbox_id, version) VALUES (?, 1) ON DUPLICATE KEY UPDATE version=version+1',
            [(int) $id]
        );
    }
}

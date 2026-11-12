<?php
namespace Modules\MailArrival;
final class Installer
{
    public static function install()
    {
        DeploymentGuard::assertInstall();
        if (!\Schema::hasTable('mail_arrival_versions')) {
            \Schema::create('mail_arrival_versions', function ($t) {
                $t->unsignedInteger('mailbox_id')->primary();
                $t->unsignedBigInteger('version')->default(0);
            });
        }
        foreach ([1, 2, 3] as $id) {
            if (
                !\DB::table('mail_arrival_versions')
                    ->where('mailbox_id', $id)
                    ->exists()
            ) {
                \DB::table('mail_arrival_versions')->insert([
                    'mailbox_id' => $id,
                    'version' => 0
                ]);
            }
        }
        if (!\Schema::hasTable('mail_arrival_event_outbox')) {
            \Schema::create('mail_arrival_event_outbox', function ($t) {
                $t->string('event_key', 64)->primary();
                $t->unsignedInteger('mailbox_id')->index();
                $t->string('kind', 32);
                $t->longText('payload');
                $t->unsignedInteger('attempts')->default(0);
                $t->string('last_error', 255)->nullable();
            });
        }
        if (!\Schema::hasTable('mail_arrival_index_outbox')) {
            \Schema::create('mail_arrival_index_outbox', function ($t) {
                $t->unsignedInteger('thread_id')->primary();
                $t->unsignedInteger('attempts')->default(0);
                $t->string('last_error', 255)->nullable();
            });
        }
        if (!\Schema::hasTable('fiveways_gmail_history')) {
            \Schema::create('fiveways_gmail_history', function ($t) {
                $t->string('gmail_id', 32)->primary();
                $t->string('gmail_thread_id', 32)->index();
                $t->unsignedInteger('target_thread_id')->unique();
                $t->string('sha256', 64);
            });
        }
        if (!\Schema::hasTable('mail_arrival_sources')) {
            \Schema::create('mail_arrival_sources', function ($t) {
                $t->string('source_key', 64)->primary();
                $t->unsignedInteger('mailbox_id');
                $t->text('state');
            });
        }
        if (!\Schema::hasTable('mail_arrival_messages')) {
            \Schema::create('mail_arrival_messages', function ($t) {
                $t->string('message_key', 64)->primary();
                $t->unsignedInteger('mailbox_id');
                $t->string('identity', 255);
                $t->unsignedInteger('target_thread_id')->nullable();
                $t->string('sha256', 64)->nullable();
                $t->string('outcome', 32);
                $t->dateTime('committed_at');
                $t->index('mailbox_id');
            });
        }
        if (!\Schema::hasTable('mail_arrival_deferred')) {
            \Schema::create('mail_arrival_deferred', function ($t) {
                $t->string('message_key', 64)->primary();
                $t->unsignedInteger('mailbox_id');
                $t->text('source');
            });
        }
    }
}

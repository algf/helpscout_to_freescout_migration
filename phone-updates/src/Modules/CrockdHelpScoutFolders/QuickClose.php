<?php
namespace CrockdHelpScoutFolders;

class QuickClose
{
    public static function button($conversation, $mode)
    {
        if (!auth()->user() || !auth()->user()->can('update', $conversation)
            || (int)$conversation->state !== \App\Conversation::STATE_PUBLISHED) return '';
        if ($conversation->isClosed()) return $mode === 'row' ? '<span class="mailbox-already-closed">Closed</span>' : '';
        if (!$conversation->hasStatus([\App\Conversation::STATUS_ACTIVE, \App\Conversation::STATUS_PENDING])) return '';
        // Other modules can add a control to the left of Close, in rows and the conversation toolbar (UnSub adds Unsubscribe).
        $before = (string)\Eventy::filter('crockd.quick_close.before', '', $conversation, $mode);
        // And after Close (RowAssign adds Assign to list rows; the theme shows it on phones only).
        $after = (string)\Eventy::filter('crockd.quick_close.after', '', $conversation, $mode);
        return $before.'<button type="button" class="btn btn-default mailbox-one-click-close" data-conversation-id="'.(int)$conversation->id.'" data-close-mode="'.$mode.'" data-status="3" aria-label="Close conversation #'.(int)$conversation->number.'" title="Close conversation"><span class="mailbox-close-icon" aria-hidden="true">✅</span> Close</button>'.$after;
    }

    public static function boot()
    {
        // Andrew, 1 Oct 2026: Close (or any status change) on a conversation page goes back to the folder it was opened
        // from, in every mailbox, not on to the next conversation. FreeScout picks the page from each person's "after
        // send" choice (Next for everyone) unless the request names one, so status changes name "back to folder".
        // Replies and assignments still follow each person's choice. List rows (x_embed) stay put, as before.
        app('events')->listen(\Illuminate\Routing\Events\RouteMatched::class, function ($event) {
            $request = $event->request;
            if ($event->route->getName() !== 'conversations.ajax' || $request->input('action') !== 'conversation_change_status'
                || $request->filled('after_send') || !class_exists('\App\MailboxUser')) return;
            $request->merge(['after_send' => \App\MailboxUser::AFTER_SEND_FOLDER]);
        });
        \Eventy::addAction('conversations_table.col_before_conv_number', function () {
            if (!\Helper::isPrint()) echo '<col class="mailbox-close-column">';
        }, 40, 0);
        \Eventy::addAction('conversations_table.th_before_conv_number', function () {
            if (!\Helper::isPrint()) echo '<th class="mailbox-close-column"><span class="sr-only">Actions</span></th>';
        }, 40, 0);
        \Eventy::addAction('conversations_table.td_before_conv_number', function ($conversation) {
            if (!\Helper::isPrint()) echo '<td class="mailbox-close-column">'.self::button($conversation, 'row').'</td>';
        }, 40, 1);
        \Eventy::addAction('conversation.convinfo.before_nav', function ($conversation, $mailbox) {
            if (!\Helper::isPrint()) {
                $button = self::button($conversation, 'conversation');
                if ($button !== '') echo '<li class="mailbox-close-toolbar">'.$button.'</li>';
            }
        }, 40, 2);
        \Eventy::addAction('javascript', function () {
            if (!\Helper::isPrint()) echo file_get_contents(__DIR__.'/quick-close.js');
        }, 45, 0);
    }
}

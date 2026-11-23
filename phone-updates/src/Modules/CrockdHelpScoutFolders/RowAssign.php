<?php
namespace CrockdHelpScoutFolders;

// Andrew, 21 Nov 2026: assign an email from the inbox on a phone, as Help Scout allowed. Phone rows get an Assign
// button under Close. It lists the same people as the bulk bar's Assignee menu (the mailbox's assignable users,
// "Anyone" and "Me"), read from that menu on the page, and saves through FreeScout's own single-conversation
// assignment action (conversation_change_user), so the server applies the same checks: the person must be allowed
// to change the conversation and the new assignee must have access to its mailbox. Desktop rows stay as they were;
// the bulk bar already assigns there.
class RowAssign
{
    public static function button($conversation)
    {
        $assignee = $conversation->user_id ? $conversation->user : null;
        $name = $assignee ? trim($assignee->getFullName()) : '';
        $first = $assignee ? trim((string)$assignee->first_name) : '';
        // "Me" for your own emails, matching the menu; otherwise the assignee's first name.
        $label = $assignee && (int)$assignee->id === (int)auth()->id() ? 'Me' : ($first !== '' ? $first : ($name !== '' ? $name : 'Assign'));
        $number = (int)$conversation->number;
        $aria = 'Assign conversation #'.$number.'. Assigned to '.($name !== '' ? $name : 'anyone');
        $icon = '<svg class="mailbox-row-assign-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
        return '<button type="button" class="btn btn-default mailbox-row-assign" data-conversation-id="'.(int)$conversation->id.'"'
            .' data-user-id="'.($assignee ? (int)$assignee->id : -1).'" data-number="'.$number.'" aria-haspopup="menu" aria-expanded="false"'
            .' aria-label="'.e($aria).'" title="'.e($name !== '' ? 'Assigned to '.$name.'. Change' : 'Assign').'">'
            .$icon.'<span class="mailbox-row-assign-label">'.e($label).'</span></button>';
    }

    public static function boot()
    {
        \Eventy::addFilter('crockd.quick_close.after', function ($html, $conversation, $mode) {
            return $mode === 'row' ? $html.self::button($conversation) : $html;
        }, 20, 3);
        \Eventy::addAction('javascript', function () {
            if (!\Helper::isPrint()) echo file_get_contents(__DIR__.'/row-assign.js');
        }, 46, 0);
    }
}

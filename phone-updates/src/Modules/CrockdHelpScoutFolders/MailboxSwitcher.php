<?php
namespace CrockdHelpScoutFolders;

use App\Folder;

// Andrew, 23 Nov 2026: on a phone, switching mailbox and then going to a folder took five taps and two page loads
// (menu, Mailbox, mailbox, Folders, folder). The Folders panel now starts with the mailboxes (Andrew, Crockd,
// Fiveways) and their Unassigned counts. Tapping one shows its folders in the same panel; tapping a folder opens it:
// three taps and one page load. Only mailboxes the person can view are listed, in the navbar's order. The panel loads
// the other mailboxes' folders when it opens, so counts are fresh and the list page itself costs nothing extra.
class MailboxSwitcher
{
    public static function boot()
    {
        if (!app()->routesAreCached()) {
            \Route::group(['middleware' => ['web', 'auth', 'roles'], 'roles' => ['admin', 'user'], 'prefix' => \Helper::getSubdirectory()], function () {
                \Route::get('/mailbox-switcher/folders', function () { return MailboxSwitcher::folders(); })
                    ->name('crockdhelpscoutfolders.mailbox_switcher');
            });
        }
        \Eventy::addAction('javascript', function () {
            if (\Helper::isPrint() || !auth()->check()) return;
            // Module routes are not in FreeScout's generated JavaScript route list, so pass the address directly.
            echo 'window.hsMailboxSwitcherUrl='.json_encode(route('crockdhelpscoutfolders.mailbox_switcher')).';';
            echo file_get_contents(__DIR__.'/mailbox-switcher.js');
        }, 48, 0);
    }

    // [{id, name, url, unassigned, unassigned_folder_id, folders: [{id, name, icon, url, count, strong, section}]}]
    public static function folders()
    {
        $user = auth()->user();
        $result = [];
        foreach ($user->mailboxesCanView(true) as $mailbox) {
            if (!$user->can('view', $mailbox)) continue;
            $folders = $mailbox->getAssesibleFolders();
            $items = [];
            $unassigned = 0; $unassignedId = null;
            foreach ($folders as $folder) {
                // Same visibility as the native sidebar when no folder of this mailbox is open.
                if ($folder->type == Folder::TYPE_DELETED) continue;
                if ($folder->type == Folder::TYPE_DRAFTS && !$folder->total_count) continue;
                $count = $folder->type == Folder::TYPE_SPAM ? (int)$folder->total_count : (int)$folder->getCount($folders);
                if ($folder->type == Folder::TYPE_UNASSIGNED) { $unassigned = $count; $unassignedId = (int)$folder->id; }
                $section = null;
                if (Views::isView($folder)) $section = Views::isClient($folder) ? 'Clients' : 'Views';
                $items[] = [
                    'id' => (int)$folder->id,
                    'name' => (string)$folder->getTypeName(),
                    'icon' => preg_replace('/[^a-z0-9-]/', '', (string)$folder->getTypeIcon()),
                    'url' => $folder->url($mailbox->id),
                    'count' => $count,
                    'strong' => in_array((int)$folder->type, [Folder::TYPE_UNASSIGNED, Folder::TYPE_MINE], true),
                    'section' => $section,
                ];
            }
            $result[] = [
                'id' => (int)$mailbox->id,
                'name' => (string)$mailbox->name,
                'url' => route('mailboxes.view', ['id' => $mailbox->id]),
                'unassigned' => $unassigned,
                'unassigned_folder_id' => $unassignedId,
                'folders' => $items,
            ];
        }
        return response()->json(['mailboxes' => $result])->header('Cache-Control', 'private, no-store');
    }
}

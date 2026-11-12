<?php
// A receipt read never fetches provider mail or marks a conversation as viewed.
\Route::group(['middleware' => ['web', 'auth', 'roles'], 'roles' => ['admin', 'user'], 'prefix' => \Helper::getSubdirectory()], function () {
    \Route::get('/mail-arrival/version', function (\Illuminate\Http\Request $request) {
        $raw = $request->query('mailbox_id');
        if (!is_scalar($raw) || !preg_match('/^[1-9][0-9]*$/', (string) $raw)) {
            return response()->json(['status' => 'error'], 400)->header('Cache-Control', 'private, no-store');
        }
        $mailbox = \App\Mailbox::find((int) $raw);
        if (!$mailbox || !auth()->user()->can('view', $mailbox)) {
            return response()->json(['status' => 'error'], 403)->header('Cache-Control', 'private, no-store');
        }
        return response()->json(['status' => 'success', 'mailbox_id' => (int) $mailbox->id,
            'version' => (string) \Modules\MailArrival\Version::forMailbox($mailbox->id)])
            ->header('Cache-Control', 'private, no-store');
    })->name('mailarrival.version');
    \Route::get('/mail-arrival/snapshot', function (\Illuminate\Http\Request $request) {
        $mailbox = \App\Mailbox::find((int) $request->query('mailbox_id'));
        $folder = \App\Folder::find((int) $request->query('folder_id'));
        $user = auth()->user();
        if (!$mailbox || !$folder || (int) $folder->mailbox_id !== (int) $mailbox->id || !$user->can('view', $mailbox) || !$user->can('view', $folder)) {
            return response()->json(['status' => 'error'], 403)->header('Cache-Control', 'private, no-store');
        }
        foreach (['filter', 'params', 'sorting'] as $key) {
            if ($request->query($key) !== null && !is_array($request->query($key))) return response()->json(['status' => 'error'], 400)->header('Cache-Control', 'private, no-store');
        }
        // Profile/search filters use a cross-mailbox native query. Keep this inbox
        // untouched rather than broaden it under the current mailbox heading.
        if ($request->query('filter')) return response()->json(['status' => 'error'], 409)->header('Cache-Control', 'private, no-store');
        // Delegate the folder-bound query, assignee, sorting and HTML to native code.
        $controller = app(\App\Http\Controllers\ConversationsController::class);
        $result = ['status' => 'error', 'msg' => ''];
        $result = $controller->ajaxConversationsPagination($request, $result, $user);
        if ($result['status'] !== 'success' || !empty($result['msg'])) return response()->json(['status' => 'error'], 409)->header('Cache-Control', 'private, no-store');
        $sidebar = view('mailboxes/sidebar_menu_view', ['mailbox' => $mailbox, 'folders' => $mailbox->getAssesibleFolders(), 'folder' => $folder])->render();
        return response()->json(['status' => 'success', 'mailbox_id' => (int) $mailbox->id, 'html' => $result['html'], 'sidebar_html' => $sidebar, 'active_count' => (int) $folder->active_count])->header('Cache-Control', 'private, no-store');
    })->name('mailarrival.snapshot');
});

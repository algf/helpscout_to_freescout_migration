# FreeScout phone updates release

This release overlay makes the inbox easier to use on a phone and makes unsubscribe outcomes clear. It is not a standalone installation or a complete set of modules. It was deployed on 23 November 2026.

## Changes

- **Assign on phone rows.** Inbox rows at 1000px and narrower have an Assign control under Close. It lists the same people as the bulk-bar Assignee menu and saves through FreeScout's own `conversation_change_user` action, so the server applies its usual permission and mailbox-access checks and states why it refuses. It shares the per-conversation lock with Close and Unsubscribe. A tap outside the open menu, or the second tap of a double tap, only closes the menu.
- **Unsubscribe outcomes.** Every outcome says whether the email closed; only an accepted request closes it. If the server cannot save its pre-send safety record (for example, a cache folder owned by another system user), it sends nothing and answers 503 with `retry: true`; the one-click button stays for a retry. After an accepted request, the close is recorded before any cache copies, which are best effort.
- **Unsub on phone rows.** Rows offer Unsubscribe wherever the conversation page does (one-click, the sender's page, or a filled-in email). Operational notices still never offer it.
- **Inbox reader Close.** "Close and next" is now "Close": after a confirmed close the reader returns to the inbox list (same folder and scroll position) instead of opening the next conversation.
- **Mailbox switcher.** The phone Folders panel opens on mailbox tabs (from the navbar's Mailbox menu, with Unassigned counts loaded when the panel opens). A tab shows that mailbox's folders, so any folder in any mailbox is three taps away. The mailbox name in the phone header opens the same panel. Folder data comes from `GET /mailbox-switcher/folders` (signed-in users; only mailboxes they can view; folder names, links and counts only). Desktop loads nothing for it.
- **Phone menu.** Below 768px the navbar menu button opens a panel from the right with every destination showing (Mailboxes, the current mailbox's settings, Manage, Account). Each entry taps its native original, so pop-ups, new tabs, toggles and Log Out behave as before. The phone top bar stays pinned on list pages, the mailbox settings gear moves into the menu, and the duplicate search entry is gone. Tablet and desktop keep the native navbar.

## Release overlay

Twelve installed files. Three public copies differ from the installed files in comment wording only (internal references removed).

| Installed file | Live SHA-256 | Public copy |
|---|---|---|
| `Modules/CrockdHelpScoutFolders/QuickClose.php` | `657998bc08082045fb16dc1681b51c3780736e17e8dead74fc7ad65152ffad83` | `phone-updates/src/Modules/CrockdHelpScoutFolders/QuickClose.php` (identical) |
| `Modules/CrockdHelpScoutFolders/start.php` | `b8ecebd014c57a50c548efb976bdc2a148cf24b5f36247c8266070a2579eaf30` | `phone-updates/src/Modules/CrockdHelpScoutFolders/start.php` (identical) |
| `Modules/CrockdHelpScoutFolders/RowAssign.php` | `bb218551260c7f696f9424444f4d894bdd62725f00683938a8292924a36d66ee` | `phone-updates/src/Modules/CrockdHelpScoutFolders/RowAssign.php` (identical) |
| `Modules/CrockdHelpScoutFolders/row-assign.js` | `0eae1925cf71915958020f53be3f2be9dfe035fa903dbafcfd561b9e330d5d10` | `phone-updates/src/Modules/CrockdHelpScoutFolders/row-assign.js` (identical) |
| `Modules/CrockdHelpScoutFolders/MailboxSwitcher.php` | `f1eab32e5e0838326c12ed374284a02a7884c4391b0bf8972da9e54ae99b7c30` | `phone-updates/src/Modules/CrockdHelpScoutFolders/MailboxSwitcher.php` (identical) |
| `Modules/CrockdHelpScoutFolders/mailbox-switcher.js` | `4956f3e4cf16cc090b563e71e6cd0d9f2feec90de695c0e18dcad7ff06bc3ab3` | `phone-updates/src/Modules/CrockdHelpScoutFolders/mailbox-switcher.js` (identical) |
| `Modules/UnSub/Tests/unsubscribe-integration.php` | `cea8d093f5aafee9ef6a2b0779540a3092cea570ebae02c7988c3855eea7d5eb` | `phone-updates/src/Modules/UnSub/Tests/unsubscribe-integration.php` (comment wording differs) |
| `Modules/UnSub/Http/Controllers/UnsubscribeController.php` | `110da7d74c02eb08800d9e17d39960051c9286d3bbc58ffe96ea51fa9593e0dc` | `action-speed/src/UnSub/Http/Controllers/UnsubscribeController.php` (comment wording differs) |
| `Modules/UnSub/Resources/assets/unsub.js` | `66b5c7a324f470c6a47d18cb215063ec72c1f14fa88beed8ae7eb666545cf5af` | `action-speed/src/UnSub/Resources/assets/unsub.js` (identical) |
| `Modules/HelpScoutTheme/Public/css/theme.css` | `6f7b30a1ac23dedf2ce64a2b60408851db0f9fdc30ea9f46df796dcb07f68364` | `design-review/module/HelpScoutTheme/Public/css/theme.css` (comment wording differs) |
| `Modules/HelpScoutTheme/Public/js/theme.js` | `c35a1d2997d9aa4a4be8f7cf304a6d55a4ff92c711f0a6e15808a6e3a7801113` | `design-review/module/HelpScoutTheme/Public/js/theme.js` (identical) |
| `Modules/InboxNavigation/navigation.js` | `e7609a1356b255eb78f0bcab24333a56e12137207f69d116ca1372d064b6bcd3` | `navigation-reader/modules/InboxNavigation/navigation.js` (identical) |

`CrockdHelpScoutFolders/start.php` and `QuickClose.php` are overlays of the existing module: they load the module's other classes, which are not part of this repository. Back up the destination files and use the installation's deployment and rollback procedure. Copy new files before `start.php`, and allow the PHP file-timestamp check (2 seconds) before testing.

## Tests

- `node --test tests/*.test.cjs` in this folder: Assign request, lock and refusal handling; unsubscribe messages and the not-started retry path; mailbox switcher escaping, section labels and off-site link rejection.
- `navigation-reader/tests/reader-close-returns.test.cjs`: the reader returns to the list after a confirmed close.
- `action-speed/tests`: the existing action regression checks, run against the updated unsubscribe files.
- `src/Modules/UnSub/Tests/unsubscribe-integration.php`: runs inside an installation with a fake transport; all records roll back. It now covers cache failures before and after the request.

Browser tests for these changes ran against an isolated synthetic installation and are not part of this public overlay, because the harness and its seed data are installation-specific.

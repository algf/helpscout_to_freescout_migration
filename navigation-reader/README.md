# Native inbox reader and bounded history

Optional FreeScout modules for an existing installation with the reviewed action-speed release and Help Scout theme. This is a source overlay, not a standalone help desk.

InboxNavigation keeps the inbox mounted while a native conversation opens in a same-origin reader. Back preserves inbox position. Native unsaved drafts and pending actions stay mounted. Close and next waits for confirmed closure. A readiness gate keeps controls unavailable until native handlers are ready and preserves recovery links during loading or failure.

ConversationHistory initially retains the latest twelve thread rows, every draft and the newest eligible email or note. Activity rows and imported activity notes cannot displace the newest real message. Full history, print and older-thread links retain the native route.

## Installation boundary

Copy the two module directories into the existing Modules directory and activate their aliases through the native module workflow. Back up existing files and activation state first. Install the matching conversation UI overlay under design-review. No core patch or database schema migration is required. Preserve the existing quick-close, unsubscribe and other supporting modules.

This release contains no next-ticket preparation implementation, route or flag. The preparation experiment did not complete its paired speed benchmark and is not accepted. No preparation speed gain is claimed.

## Verification

Portable reader safety and readiness checks run with `node --test tests/*.test.cjs`. The history filter harness runs with `php tests/history-filter.php modules/ConversationHistory/start.php` and requires PHP DOM.

Local browser evidence covers all three mailboxes, desktop and mobile, drafts, pending actions, native read state, exactly-once closes, error recovery, 5/50/200-thread histories, activity-heavy histories, older links and print. The seeded application and its detailed test results are retained outside this public source overlay. Physical devices, provider delivery and sustained production performance remain separate verification surfaces.

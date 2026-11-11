# FreeScout action speed release

This release overlay improves individual conversation closes and one-click unsubscribe in an existing FreeScout installation. It is not a standalone installation or a complete set of modules.

## Changes

- Close controls remove the selected row immediately while the server confirms the change. Individual close requests use a bounded queue. A page navigation hands unsent queued requests to the browser for best-effort delivery.
- Close, bulk close and unsubscribe coordinate actions on the same conversation. Failed or unconfirmed actions report an error instead of claiming success.
- A one-click unsubscribe can recover its result after same-tab navigation without repeating the provider request. Folder counts and the visible mobile header reconcile from the server.
- Unsubscribe and close operations defer folder counter updates through the existing InboxSpeed middleware.

## Release overlay

| Source | Installed destination |
| --- | --- |
| `src/CrockdHelpScoutFolders/quick-close.js` | `Modules/CrockdHelpScoutFolders/quick-close.js` |
| `src/InboxShortcuts/Resources/assets/inbox-shortcuts.js` | `Modules/InboxShortcuts/Resources/assets/inbox-shortcuts.js` |
| `src/InboxSpeed/Middleware.php` | `Modules/InboxSpeed/Middleware.php` |
| `src/UnSub/Http/Controllers/UnsubscribeController.php` | `Modules/UnSub/Http/Controllers/UnsubscribeController.php` |
| `src/UnSub/Resources/assets/unsub.js` | `Modules/UnSub/Resources/assets/unsub.js` |

The overlay depends on the existing module bootstrap, routes, and supporting InboxSpeed classes. Check the installed versions and backing services before applying it. Back up the destination files and use the installation's deployment and rollback procedure. A browser keepalive handoff is best effort; it is not a delivery guarantee.

The local test harness, baseline files, runtime configuration, generated results and deployment evidence are not part of this public overlay.

## Test framework

The release includes the synthetic fixtures, baseline sources, test scripts and local runner used for comparison. The Node unit tests can run with `node --test tests/*.test.cjs` from this directory. Browser and PHP integration tests require an independently prepared, isolated seeded FreeScout runtime, the supporting modules and a local test login. The original local compose configuration is excluded because it contains installation-specific host names; this snapshot is not a self-contained Docker setup. The fixture transport only accepts its reserved `.invalid` endpoint.

The package and lock files describe the test dependency. Install it in a clean environment rather than copying a local `node_modules` link. Test scripts, baseline files and fixtures are for local verification only and are not part of the five-file production overlay.

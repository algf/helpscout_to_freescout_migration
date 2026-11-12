# Mail arrival speed

Incoming-mail importer and arrival test harness across three mailboxes. Local acceptance and independent production operational checks passed. The update is deployed. Three approved test emails each reached the correct committed FreeScout thread exactly once. Conservative provider-to-commit upper bounds were 18.298 seconds for mailbox 1, 25.100 seconds for mailbox 2 and 13.875 seconds for mailbox 3.

These three samples do not establish a production p95 or guaranteed speed. An earlier natural arrival took 74.001–76.464 seconds during a provider connection failure and remains in the evidence. Fresh foreground arrival timing across all three mailboxes remains unverified because in-app browser control was unavailable for the final test. Prior production monitor checks and the local browser suites passed. Module activation or schema installation alone does not start an importer.

Final local acceptance passed. See [verification and retained evidence](VERIFICATION.md) and [harness run results](harness/RESULTS.md).

## Acceptance

Measure three distinct events: provider receipt, committed FreeScout message and visible inbox row. The sender's Date header and FreeScout thread created_at are not ingestion timestamps. Report each mailbox separately and retain every sample, including failed or late samples.

The initial target is p95 under 30 seconds from provider receipt to a foreground inbox row, with bounded 10-second independent polling. Committed-to-visible target is two seconds when the user is not editing, selecting or actioning a ticket. A safe pending notice is allowed while work is in progress; deferred time must be reported separately. These are targets until the results establish them.

Required correctness cases:

- New messages and replies in all three mailboxes, including messages read in the provider before fetch.
- Stable threading and source identity, cross-folder duplicates, duplicate replays and crash recovery.
- Source UIDVALIDITY resets, missing/expired checkpoints and explicit bounded initial catch-up.
- Attachment bytes and source flags retained, with sender Date deliberately different from provider receipt.
- No checkpoint advance past failed work. Overlapping workers for one mailbox do not duplicate imports. Separate mailbox workers can progress independently.
- Fiveways Gmail thread identity, sent/archive/spam/bin/draft policies, prior conversation URLs, decisions and membership boundaries preserved.
- Inbox refresh defers during pending close/unsubscribe, selections and retained drafts. It resumes safely after clean reader Back. No lost focus, scroll, page/filter state or stale reinserted closed rows.
- Version endpoint requires authentication and mailbox access. It exposes only a revision, never message contents.

## Local boundaries

`scripts/local.mjs` rejects any URL other than http://localhost:53927 and requires the named Docker app to use only the internal `freescout-ui-local_isolated` network. Next-ticket preparation must be disabled. The synthetic IMAP server binds only to loopback inside that app. Provider credentials are injected in memory for tests; saved mailbox credentials remain unchanged.

Database and app-file backups, fixture records, timing samples and failure evidence are retained under ignored `results/`. Do not delete these as ordinary build artefacts. Tests must not run concurrently against the shared fixture database unless the test explicitly owns and coordinates those concurrent workers.

## Controlled production release

Use [config.example.php](config.example.php) for the full configuration shape. It is disabled, enrols no mailboxes and uses example identities. Copy it to the application's private `config/mail_arrival.php`, replace the verified deployment and policy values, and set an approved fixed catch-up date. The example is not loaded automatically. Native imports also require a database queue on the application database connection. Keep the configured copy outside the public package.

Production import is opt-in. `DeploymentGuard` requires `production.enabled=true`, an exact HTTPS `production.app_url`, and private `production.mailboxes` identity pins for IDs 1, 2 and 3. It rejects fixture scopes, custom client credentials and injected providers in production. Installer checks all saved mailbox identities before schema changes. Importing additionally requires `mail_arrival.enabled=true` and explicit `mailbox_ids`; activating the module is insufficient. Native cross-mailbox copies must also match the destination identity pin.

Keep these deployment values outside Git. Fiveways owner/access, team domain, person aliases and label mappings also come from explicit private policy. Source code contains no personal account or team-member defaults. Credentials stay in the existing native mailbox connections.

The module does not install a production scheduler. Release controls prepare a closed host gate and one-shot, independently locked mailbox polls at ten-second offsets. Opening the gate is a separate owner-transfer step. Native mailboxes 1 and 2 share cross-import behaviour, so their legacy workers must be fenced together. Keep release-owned pause markers present while draining old workers, seeding and enabling the new configuration; drain pre-enable workers again before removing only the release-owned pauses. Retire the previous custom Fiveways owner separately. Preserve old schedules and a rollback that closes the new gate before restoring legacy owners.

A bounded, metadata-only inventory and explicit absolute catch-up date/cap precede the handoff. Validate known targets and source epochs, seed all checkpoint and known-message records in one transaction, and leave unknown or deferred messages for the importer. A captured high UID is not a completed checkpoint. Finish initial seeding before measuring steady-state live delivery.

Local synthetic timing does not prove Google network behaviour, production mailbox size or physical-phone behaviour. Production acceptance needs actual provider receipt, a committed message, a visible inbox row, unchanged source flags, healthy workers and drained outboxes. Store provider identifiers, actual identity pins, backups and live receipts in private operator artefacts. Gmail push remains a later trigger option; correctness does not depend on it.

## Reproduce the local checks

Run from this directory. Use the existing isolated Docker app. Do not run the database or browser suites in parallel with each other. The concurrency tests start their own controlled workers.

1. `node scripts/local.mjs` checks the container, network, URL and disabled next-ticket preparation.
2. `node scripts/install.mjs` takes a backup on first use, checks PHP syntax, installs the local module and verifies every installed file hash. It does not enrol a mailbox or start an importer.
3. `python3 tests/backend/run-portable.py` checks engine, pause and durable outbox policies without booting Laravel.
4. `npm run test:provider` checks the synthetic provider protocol fixtures.
5. `node --test tests/frontend/monitor.test.cjs` checks browser monitor state transitions.
6. `node scripts/seed-frontend.mjs` adds run-specific synthetic UI fixtures. It preserves older fixtures.
7. `MAIL_ARRIVAL_UI_RUN=desktop-UNIQUE npm run test:frontend` runs the desktop UI checks. Then use `MAIL_ARRIVAL_UI_WIDTH=390 MAIL_ARRIVAL_UI_RUN=mobile-UNIQUE npm run test:frontend` for mobile.
8. `node scripts/harness-integration.mjs arrival-UNIQUE` starts the loopback provider and exercises the real Webklex adapter, native mail processor and database. Use a fresh lowercase run name of 8–40 characters.
9. `node scripts/harness-timing.mjs arrival-UNIQUE` uses that same passing integration run for 20 arrivals in each mailbox. Do not restart the provider between those two commands.
10. Stop and export the preceding fixture with `node scripts/harness-provider.mjs stop arrival-UNIQUE`. Then `node scripts/harness-folders.mjs folders-UNIQUE` uses a separate run for the actual configured folder names and cross-folder duplicates.

Stop and export the folder fixture with `node scripts/harness-provider.mjs stop folders-UNIQUE` after the check. The stop command verifies its process identity and preserves the latest synthetic state, protocol transcript and server log.

The local module needs `mail_arrival.enabled=true` to show the monitor. Keep persistent `mailbox_ids=[]`; the integration harness enrols its own loopback sources only for each test process. Do not copy production credentials into this fixture. The local staging-login route and synthetic user are existing test infrastructure, not production authentication.

The timing harness fails unless every mailbox has all 20 visible arrivals, every visible row maps to its committed message, each worker finishes healthy, and both p95 thresholds pass. It retains transient poll failures. The timestamps bracket fixture publication and database commit; the reported upper bounds include host/container clock uncertainty.

## What the implementation changes

`src/Modules/MailArrival` contains the opt-in module. `Runtime` selects the correct native or Fiveways processing path. `Engine` keeps per-folder checkpoints and a per-mailbox lock. `ImapProvider` fetches source UIDs regardless of read state and uses `BODY.PEEK` to retain source flags. The sinks preserve native threading and Fiveways history policies. Durable outboxes move notification and search work after the message transaction. A committed mailbox revision drives the authenticated inbox monitor.

The browser polls a small receipt once per second while visible. It replaces the current inbox table only when it is safe, preserves supported folder, assignee and sort context and focus, and defers while a selection, reader, draft, pointer gesture or write is active. Failed requests time out and retry with backoff. Hidden pages stop polling. Unsupported profile or search filters are left intact instead of being refreshed through a broader query.

The importer runs only from CLI and only for an explicitly enrolled, approved deployment. Production uses the fail-closed pins above. Operational health is verified. Fresh Gmail-to-storage arrival is verified once per mailbox. Production p95 and fresh foreground display timing remain unverified; passing local checks does not establish those live outcomes.

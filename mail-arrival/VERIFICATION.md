# Arrival-speed verification

Status: local acceptance and production operational acceptance passed on 13 November 2026 (Australia/Sydney). The update is deployed across all three mailboxes. Independent checks passed for source parity, one importer owner per mailbox, drained deferred work and outboxes, and retained source flags. Three explicitly approved test emails were sent once through the existing FreeScout mail transport and each was matched to its expected mailbox, exact message identity, expected body and one imported ledger target.

| Mailbox | Provider-to-commit lower bound | Provider-to-commit upper bound |
| --- | ---: | ---: |
| 1 | 14.001 s | 18.298 s |
| 2 | 20.001 s | 25.100 s |
| 3 | 7.001 s | 13.875 s |

All three samples were below 30 seconds through committed storage. They are not a production p95 or a foreground-display measurement. The in-app browser runtime was unavailable during this final check, so no new browser visibility claim is made. Earlier production monitor checks and local browser checks remain separate evidence.

An earlier natural arrival took 74.001–76.464 seconds during a provider connection failure. The row was later confirmed visible, but that mailbox was not foreground at commit. The failed speed sample is retained. An overnight log review also found intermittent, recovered provider connection failures and slow empty polls; it does not establish per-message latency. Actual identities, schedules, timestamps and live receipts remain in private operator artefacts.

## Scope and environment

The candidate is in branch `codex/freescout-mail-arrival-20261112`, based on `0c48edd`. It adds the opt-in `MailArrival` module and a synthetic IMAP, database and browser test harness. The accepted conversation-view and inbox-navigation source files are unchanged.

The acceptance surface is the real local FreeScout app at `http://localhost:53927`. Its Docker network is internal. The provider is a loopback-only IMAP server inside the app container. The importer uses the real Webklex client, native mail processor, database and browser rendering. All messages used by the local harness are synthetic. Mailbox account settings and production credentials are unchanged. Next-ticket preparation stays disabled.

Timing measures three distinct events: bounded source publication, bounded database commit and a visible browser row after two animation frames. A subject Date header is never used as provider receipt time. Each visible conversation is matched back to its committed ledger entry. The 60-message run uses 20 arrivals per mailbox and independent 10-second workers. The goals are p95 under 30 seconds from publication to visible row, and under two seconds from commit to visible row while the inbox is safe to update.

## Final speed result

The local timing run `results/arrival-release-20261113j-timing.json` passed both gates in all three mailboxes. It committed and displayed all 60 synthetic messages, matched every visible conversation to its database entry, had zero failed polls and finished with no pending side effects. It recorded 29 internally recovered transaction conflicts. These are reported retries, not failed polling attempts.

| Mailbox | Samples | p95 source publication to visible | p95 commit to visible |
| --- | ---: | ---: | ---: |
| Personal | 20 | 6.952 s | 1.431 s |
| Crockd | 20 | 10.701 s | 1.288 s |
| Fiveways | 20 | 9.730 s | 1.426 s |

These are conservative upper bounds, including clock uncertainty. They pass the local targets of under 30 seconds and under two seconds. The run also records first visible DOM observation, two-frame visibility, version polling intervals and request timings. These local figures are not production timings. No production percentile or before/after speed ratio is claimed. The integration receipt records the installed source hashes used for the timing run.

The timing provider was stopped after exporting its state and transcript. Test browser processes ended. The local FreeScout app remains available for review. Persistent importer enrolment remains empty, and next-ticket preparation remains disabled.

## Focused checks

The release backend passes 160 portable PHP assertions: 52 engine and private person-policy checks, 25 runtime/deployment guards, 30 outbox, message-lock and destination-pin checks, five polling cadence checks, 13 database transaction checks, 10 IMAP date checks and 25 CLI success/failure timing and privacy checks. These run without Laravel or database writes; they do not replace the real integration checks. The frozen browser monitor passes 20 JavaScript state and concurrency checks. The version-route test passes 17 permission and input assertions. Independent review covered mailbox access, folder scope and the shared native refresh queue bridge.

The release-only baseline reconciliation helper passed 36 fake-store checks and 13 guarded temporary-PDO checks, including numeric-string UIDs, atomic checkpoint and deferred-queue updates, target mismatch refusal and lock release. The PDO checks used temporary tables on one isolated local connection. Its source hashes and counts are retained in `tests/backend/results/baseline-reconcile-receipt.json`; these local checks do not establish a production reconciliation outcome.

## Browser checks

The final desktop suite passed all 17 checks with no skips or retries. Receipt: `results/frontend-desktop-20261113j/report.json`. The final 390px mobile suite passed 15 checks with two intentional skips. The skipped controls, selection checkboxes and column sorting, are hidden in the accepted mobile interface and are covered at desktop width. The actual mobile conversation-toolbar unsubscribe, Back and parallel-close path passes in all three mailboxes. The suite also checks clean and dirty readers, retained drafts, timeouts, late page responses, held Close taps, mailbox permissions and unsupported-filter rejection. The first mobile run stopped when its synthetic row could not be scrolled into view behind older future-dated fixtures; it recorded four passes, one failure, one skip and 11 not run. Its report and trace remain at `results/frontend-mobile-20261113j/`. The test-only fixture was then sorted ahead of those rows; the focused dirty-reader check and complete mobile rerun passed. Receipt: `results/frontend-mobile-20261113k/report.json`.

## Real importer checks

The final release source, including the production guard and destination identity pin, passed all 46 checks in `results/arrival-release-20261113j-integration.json`. These use the actual Webklex adapter, native processor and database. They cover all three mailboxes, pre-read arrivals, unchanged source flags, threading, exact attachment bytes, empty polls with no body fetch, replay, UIDVALIDITY reset, source failure and recovery, independent workers, owner pause/resume, same-message concurrent delivery and advisory lock contention. A forced failure after native writes leaves the conversation, thread, ledger, version, outbox and checkpoint unchanged; its retry imports exactly once.

The separate exact-folder run passed all 14 checks in `results/arrival-folders-20261113k-folders.json`. It covers Crockd Inbox/pilot and the default Fiveways All Mail/Spam/Bin folders, stable identity deduplication, checkpoints, status policies and replay. The synthetic provider passed five protocol/fixture tests. A final privacy cleanup replaced the Sent fixture sender with a matching synthetic policy identity; all 46 real-adapter integration checks passed again in `results/arrival-privacy-20261113l-integration.json`. Production module source was unchanged.

## Retained evidence

Manual in-app browser review confirmed all three local inbox views. New final-run Crockd messages then appeared without reloading the page. Hidden-tab and back/forward-cache logic has portable test coverage; this task did not establish physical assistive-technology behaviour.

The pre-change database and app archive are in `results/before-2026-11-12T12-06-50-075Z/`. `manifest.json` contains SHA-256 checksums. `results/installed.json` identifies the installed module hashes. Results and backups are ignored by Git and retained locally.

Earlier failed and partial runs remain in `results/`. In particular, `arrival-final-20261112b-timing.json` stopped after nine samples when a Crockd poll failed. That version of the harness did not retain the original failure output. Its checkpoint was retained and a diagnostic retry imported the waiting messages. The harness now retains process output and retries transient failures on a later poll, while requiring all 60 observations, healthy final workers and the speed thresholds. The earlier partial run is not counted as a pass.

## Conflict found by the timed run

The first full final-source run, `results/arrival-release-20261112c-timing.json`, delivered and displayed all 60 messages but failed its speed gates. It recorded ten failed poll attempts. Per-mailbox conservative p95 publication-to-visible / commit-to-visible bounds were 21.879 / 1.894 seconds for Personal, 37.646 / 2.920 for Crockd and 11.182 / 3.694 for Fiveways. Completion did not count as a pass.

The short diagnostic retained the original native failure: SQLSTATE HY000, driver code 1020. The local server reports MariaDB 12.3.3, `innodb_snapshot_isolation=ON` and `REPEATABLE-READ`. [MariaDB's snapshot isolation documentation](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-system-variables) explains that a locking read against a row outside the transaction's read view can raise this conflict and roll back the transaction. The installed Laravel version then calls PDO rollback again and masks the first failure. The correction retains the original cause, keeps the same PDO connection and advisory locks, and retries only recognised transient conflicts at most three times. It resets notification and mailbox model state for each attempt, advances counts only after commit and reports recovered conflicts. The final clean-provider speed run rejects any unexpected failed poll. Server-wide isolation settings remain unchanged.

## Catch-up date and safe diagnostics

Production catch-up exposed a date conversion defect: a date-only IMAP `SINCE` floor could shift to the preceding UTC calendar day when the application timezone was ahead of UTC. The provider now treats date-only floors as UTC calendar dates. Ten portable checks cover Sydney and UTC timezones, a daylight-saving transition, explicit UTC instants, invalid dates and steady polling without a date floor. The final-source 46-check integration and 60-arrival timing runs use that fix.

CLI failure reports expose only static failure categories, validated SQLSTATE and driver codes and fixed reason labels. They do not print native error messages, SQL values, email content or credentials. Twenty-five portable checks cover CLI success/failure timing and privacy paths.

## Release boundary

`DeploymentGuard` now supports a controlled production deployment. It requires an exact HTTPS application pin, private identities for all three mailboxes and explicit production opt-in. It rejects production fixture/client/provider injection. Installer verifies saved identities before DDL; runtime checks the source identity, and native cross-import eligibility checks the destination identity. Fiveways owner/access and person-folder policies are explicit private configuration, with no personal defaults in the public source. The 160 portable checks include mismatched identities, fixture refusal and destination drift.

Module/schema installation remains separate from enrolment and scheduling. The release-owned schedule uses a host gate and per-mailbox locks for handoff. Native 1/2 and the custom Fiveways owner must be fenced and drained; a second drain after enabling configuration prevents an old-config worker from crossing pause removal. Rollback closes the new host gate, waits for owners, disables enrolment without depending on the import identity guard, removes only release-owned pause markers and restores the previous schedule. Busy lock exits are distinct from importer failures.

Metadata inventory and seeding do not prove arrival. The inventory uses a fixed, bounded floor and source fence; seed validation retains unknown/draft work, verifies known targets and source epochs, and commits ledger/checkpoint rows together. Initial seeding must finish before a steady-state live timing claim.

Local synthetic evidence does not prove real Gmail latency, production network behaviour, production mailbox size or physical-phone behaviour. Fresh provider receipt through committed storage is verified once per mailbox. Production p95 and fresh foreground visibility timing remain unverified. Production source flags, importer ownership, healthy jobs, drained outboxes and rollback state have been checked separately and retained in private operator evidence. Do not describe local results or prepared schedules as a live speed improvement. Keep production provider identifiers, contents and actual account/configuration values out of public commits.

A subsequent CLI-only diagnostic update records complete-poll start/end or failure timestamps and monotonic elapsed time. It passed 160 portable checks and independent review. It changes no import, retry, cadence or timeout behaviour. The live CLI hash and successful receipt from each mailbox are retained privately. The 60-arrival benchmark predates this logging-only change; it was not repeated. Poll timing does not identify separate network/authentication phases or repair the observed live connection delay.

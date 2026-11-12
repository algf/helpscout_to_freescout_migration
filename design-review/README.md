# FreeScout UI release

Reviewed responsive UI source for an existing FreeScout installation with HelpScoutTheme and CrockdHelpScoutFolders installed. This directory is a four-file release overlay, not a complete FreeScout installation or standalone module bundle.

## Changes

- Compact inboxes use a wide sender/age, subject and preview column, with one aligned Close column. Close has a 76 by 48 pixel target. More, tag badges and thread-count badges are hidden in compact inbox rows.
- Desktop customer columns use 72% of the measured name-based width, leaving more space for conversation subjects and previews. Long names truncate while retaining their full accessible text and hover title.
- The separate conversation-ID column is removed. Desktop Copy link actions show and announce successful copying.
- Header search, folder navigation, tags, conversation details and the composer have revised spacing and responsive behaviour. Existing native controls and backend actions are retained.

- Conversation views keep the latest message open and show older messages as compact sender, time and preview rows. Older messages expand with keyboard or pointer input. Delivery warnings remain visible.
- The conversation sidebar uses matching Tags and Customer headings, contained wrapping tags, aligned customer details and larger mobile touch targets. Native tag and customer actions are retained.
- The optional inbox reader and recent-history modules are in `../navigation-reader/`. Next-ticket preparation is excluded.

## Release files

| Source file | Existing installed destination |
| --- | --- |
| `module/HelpScoutTheme/Public/css/theme.css` | `Modules/HelpScoutTheme/Public/css/theme.css` |
| `module/HelpScoutTheme/Public/js/theme.js` | `Modules/HelpScoutTheme/Public/js/theme.js` |
| `aligned/Modules/CrockdHelpScoutFolders/list-tools.js` | `Modules/CrockdHelpScoutFolders/list-tools.js` |
| `aligned/Modules/ConversationTimeline/Resources/assets/timeline.js` | `Modules/ConversationTimeline/Resources/assets/timeline.js` |

Use the existing module bootstrap files, fonts, icons and supporting modules. Back up the destination files, copy the reviewed replacements, and refresh asset discovery through the installation's scoped deployment procedure. Installation-specific deployment commands are intentionally not included.

## Verification

The 12 November conversation update has passing local evidence for all 317 discovered cases across the full run and targeted follow-ups. The initial run recorded 265 passes, 17 failures, one interruption and 34 cases not run. Stale reader-entry and scroll-position expectations were updated without changing product source. All affected functional cases then passed, as did all 29 mobile cases and all 12 write cases. Four screenshot baselines were individually reviewed and updated; all 11 visual cases passed in follow-ups. A named synthetic Fiveways fixture is restored to its seeded state before its screenshot so earlier write tests do not change the comparison.

The sidebar also passed 26 focused checks across all three mailboxes at 320, 390, 768 and 1440 pixels, with two duplicate action cases intentionally skipped. Two extra checks verified intercepted native tag autocomplete, add and remove requests. An independent source and screenshot review found no remaining scoped blocker. The inbox reader has 14 portable safety/readiness tests, and the history filter passed 492 assertions. Physical phones and VoiceOver were not tested.

Production verification covered all three mailboxes: native and reader views, desktop and mobile layout, tag containment, customer settings, older-message expansion, Show latest and Back to inbox. Measured live CSS widths were 358, 389, 769 and 1440px; exact 320px evidence is local. Deployed file hashes match this source. No live customer message was sent or ticket actioned during this verification.

The retained 11 November results below describe the previous inbox release.

Verified on 11 November 2026:

- The initial final layout passed 314 local automated tests: 273 desktop checks, 29 mobile checks and 12 write-workflow checks, with zero failures, skips, flaky tests or retries in the completed run.
- The later two-line CSS customer-width adjustment passed 18 targeted desktop checks, three mobile tests covering all mailboxes at four widths, and 11 visual comparisons. The full 314-test suite was not rerun after this adjustment.
- Production checks covered three mailboxes at CSS viewport widths of 320, 390, 768 and 1440 pixels, plus selection, Copy link feedback, folder navigation and conversation layouts. Matching-viewport measurements confirmed the customer-width reduction was 28% in all three mailboxes.
- JavaScript syntax and TypeScript checks passed. Production send and Close actions were not exercised on real email; write workflows were verified using isolated synthetic data.

The test harness, synthetic runtime and detailed evidence remain in the local review workspace. Live email captures, account details, deployment records, backup archives and environment configuration are excluded from this public source snapshot. The directory's allowlist ensures only the release files and this note are included.

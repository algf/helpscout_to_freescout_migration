# FreeScout UI release

Reviewed responsive UI source for an existing FreeScout installation with HelpScoutTheme and CrockdHelpScoutFolders installed. This directory is a three-file release overlay, not a complete FreeScout installation or standalone module bundle.

## Changes

- Compact inboxes use a wide sender/age, subject and preview column, with one aligned Close column. Close has a 76 by 48 pixel target. More, tag badges and thread-count badges are hidden in compact inbox rows.
- Desktop customer columns use 72% of the measured name-based width, leaving more space for conversation subjects and previews. Long names truncate while retaining their full accessible text and hover title.
- The separate conversation-ID column is removed. Desktop Copy link actions show and announce successful copying.
- Header search, folder navigation, tags, conversation details and the composer have revised spacing and responsive behaviour. Existing native controls and backend actions are retained.

## Release files

| Source file | Existing installed destination |
| --- | --- |
| `module/HelpScoutTheme/Public/css/theme.css` | `Modules/HelpScoutTheme/Public/css/theme.css` |
| `module/HelpScoutTheme/Public/js/theme.js` | `Modules/HelpScoutTheme/Public/js/theme.js` |
| `aligned/Modules/CrockdHelpScoutFolders/list-tools.js` | `Modules/CrockdHelpScoutFolders/list-tools.js` |

Use the existing module bootstrap files, fonts, icons and supporting modules. Back up the destination files, copy the reviewed replacements, and clear the FreeScout asset cache through the installation's deployment procedure. Installation-specific deployment commands are intentionally not included.

## Verification

Verified on 11 November 2026:

- The initial final layout passed 314 local automated tests: 273 desktop checks, 29 mobile checks and 12 write-workflow checks, with zero failures, skips, flaky tests or retries in the completed run.
- The later two-line CSS customer-width adjustment passed 18 targeted desktop checks, three mobile tests covering all mailboxes at four widths, and 11 visual comparisons. The full 314-test suite was not rerun after this adjustment.
- Production checks covered three mailboxes at CSS viewport widths of 320, 390, 768 and 1440 pixels, plus selection, Copy link feedback, folder navigation and conversation layouts. Matching-viewport measurements confirmed the customer-width reduction was 28% in all three mailboxes.
- JavaScript syntax and TypeScript checks passed. Production send and Close actions were not exercised on real email; write workflows were verified using isolated synthetic data.

The test harness, synthetic runtime and detailed evidence remain in the local review workspace. Live email captures, account details, deployment records, backup archives and environment configuration are excluded from this public source snapshot. The directory's allowlist ensures only the release files and this note are included.

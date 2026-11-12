# Prepared live arrival observation

This is a review artifact. Do not run it until the release operator verifies the production app identity, three mailbox identities, Gmail connection settings, exact folder names and deployment state. It does not itself authorise a production connection, send mail or create a canary. Use naturally arriving messages unless Andrew explicitly authorises a separate test message.

`../scripts/live-observe.php` establishes each folder's UIDVALIDITY and UIDNEXT baseline, then uses IMAP `EXAMINE`, bounded UID searches and metadata-only UID fetches for UID, Gmail message ID and INTERNALDATE. It never fetches headers or bodies and never issues STORE or changes Seen. It filters out source dates that could predate its baseline, fails on an epoch change or unexpected source identity, and reports only mailbox ID, SHA-256 opaque ID, conversation ID and timestamp bounds. Mailbox addresses come only from private `mail_arrival.production.mailboxes` pins. Folder names come from each private `mail_arrival.mailboxes.N.folders` setting. The operator must also provide `mail_arrival.production.observer_clients.N` with the verified `login`, `host`, `port`, `encryption` and `validate_cert` pins for each observed mailbox. The login pin may differ from the mailbox address, but must exactly match the saved login and constructed client. SSL on port 993 and certificate validation are required. Missing or mismatched pins are blockers, not reasons to relax the guard silently.

The existing `MailHelper` authentication path may refresh an expired OAuth token under the existing account scope. That routine token update was authorised by the release operator. The observer does not print or persist credentials. Once connected, its ledger lookups use prepared SELECTs on the primary PDO after enforcing and verifying a session-level read-only default. It never invokes the importer or alters a schedule. The process writes JSON lines to stdout only, so an operator may capture them on the local workstation; provider exceptions are deliberately sanitised. An external wall-clock process timeout should bound network stalls.

Example structure, after operator verification and staging the two files together in their matching `scripts/` and `harness/` directories:

```sh
timeout 150 php /path/to/mail-arrival/scripts/live-observe.php \
  --expected-app-url "$VERIFIED_APP_URL" --mailboxes 1,2,3 \
  --duration 120 --interval 5 --cap 20
```

Do not place credentials in arguments, logs, screenshots or evidence. No raw Gmail ID, address, subject, header or body is emitted. The script uses an opaque `sha256(mailbox_id + NUL + Gmail message ID)` for correlation. Candidate messages must have an INTERNALDATE whose one-second lower bound is after the completed baseline. They must also have an `imported` ledger row and a thread joined to the same mailbox before an event is emitted. Historical matches and ambiguous pre-baseline source dates are not fresh-arrival proof.

INTERNALDATE supplies a one-second provider timestamp interval. The ledger `committed_at` is written inside the transaction at one-second precision, **not an exact commit timestamp**. An observed absent ledger query and the written timestamp give a conservative lower bound; the first successful primary-DB query gives the upper bound. These are bounds on commit, not a precise measurement. The observer uses the same PDO for the read-only check and all ledger reads to avoid replica lag.

The production browser proof remains separate. Andrew or the release operator observes the actual IAB inbox and correlates the displayed conversation ID with the opaque ledger event. Record a bounded interval between the last observation where the row was absent and the first where it was visible. If observation begins after the row is already present, only a visibility upper bound is known; do not call it a first-visible time. A read-only UI witness does not prove another recipient or device saw the message.

Browser/workstation and server clocks must be compared before computing latency. `../scripts/live-clock-bound.mjs LOCAL_BEFORE_MS REMOTE_MS LOCAL_AFTER_MS` performs only the offline arithmetic: the three inputs bracket a read-only remote clock observation. It makes no SSH or network connection. Record the round-trip uncertainty and use the conservative ends of the intervals when evaluating any threshold. If there are too few natural arrivals, a clock mismatch, stale credentials or an unsupported folder, report the proof gap rather than infer a percentile or send a test email.

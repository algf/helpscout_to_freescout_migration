<?php
/**
 * Public example only. The module does not load this file automatically.
 * Copy to the application's PRIVATE config/mail_arrival.php and replace the
 * examples after verifying saved mailbox identities, provider settings and folders.
 * Never commit the configured copy, credentials, live identifiers or receipts.
 */
return [
    // Module activation and schema installation alone do not start importing.
    'enabled' => false,
    'mailbox_ids' => [],

    // Used only on loopback deployments without a fixture_scope override.
    'mailbox_identities' => [
        1 => 'personal@example.com',
        2 => 'support@example.com',
        3 => 'team@example.com'
    ],

    'production' => [
        'enabled' => false,
        // Must exactly match app.url, including any application path. HTTPS only.
        'app_url' => 'https://support.example.com',
        // These pins must match the existing saved identities for all three IDs.
        'mailboxes' => [
            1 => 'personal@example.com',
            2 => 'support@example.com',
            3 => 'team@example.com'
        ],
        // Read-only live-observation pins. These do not configure importer clients.
        // Verify against each saved native connection; passwords stay in FreeScout.
        'observer_clients' => [
            1 => [
                'login' => 'personal@example.com',
                'host' => 'imap.example.com',
                'port' => 993,
                'encryption' => 'ssl',
                'validate_cert' => true
            ],
            2 => [
                'login' => 'support@example.com',
                'host' => 'imap.example.com',
                'port' => 993,
                'encryption' => 'ssl',
                'validate_cert' => true
            ],
            3 => [
                'login' => 'team@example.com',
                'host' => 'imap.example.com',
                'port' => 993,
                'encryption' => 'ssl',
                'validate_cert' => true
            ]
        ]
    ],

    // Use a fixed approved absolute date, such as YYYY-MM-DD, never a rolling date.
    // The placeholder deliberately fails validation. Inventory and reconcile known
    // targets before cutover. Capturing a high UID alone must not skip missing mail.
    'mailboxes' => [
        1 => [
            'initial_since' => 'REPLACE_WITH_APPROVED_ABSOLUTE_DATE',
            'initial_max_messages' => 2500,
            'batch_size' => 25,
            'folders' => ['INBOX']
        ],
        2 => [
            'initial_since' => 'REPLACE_WITH_APPROVED_ABSOLUTE_DATE',
            'initial_max_messages' => 2500,
            'batch_size' => 25,
            // Include every verified native input folder. This extra name is an
            // example, not a folder that the module creates or requires.
            'folders' => ['INBOX', 'FreeScout-Pilot']
        ],
        3 => [
            'initial_since' => 'REPLACE_WITH_APPROVED_ABSOLUTE_DATE',
            'initial_max_messages' => 2500,
            'batch_size' => 25,
            // Requires Gmail message/thread IDs. Use actual provider folder names;
            // some accounts use [Gmail]/Trash instead of [Gmail]/Bin.
            'folders' => ['[Gmail]/All Mail', '[Gmail]/Spam', '[Gmail]/Bin']
        ]
    ],

    // Existing owner pause markers: mailbox-N-sync.paused. Do not remove them here.
    'pause_dir' => '/data',
    // Retain the existing target-before.json and person-folders.json policy files.
    'fiveways_history_dir' => '/data/fiveways-history',
    'fiveways' => [
        // Access must include owner_email and contain no unapproved users.
        'scope' => [
            'email' => 'team@example.com',
            'owner_email' => 'personal@example.com',
            'allowed_users' => [
                'personal@example.com',
                'first@example.com',
                'second@example.com'
            ]
        ],
        'team_domain' => 'example.com',
        // Keys must match the retained person-folders.json people/tag names.
        'people' => [
            'first' => ['first@example.com', 'first-alias@example.com'],
            'second' => ['second@example.com']
        ],
        // Exact existing Gmail labels mapped to the same person keys.
        'label_people' => [
            'To First' => 'first',
            'To Second' => 'second'
        ]
    ],

    // Synthetic local tests only. Production rejects populated scope/client
    // overrides and injected providers. Leave these empty on every live install.
    // fixture_scope[N]: {email, owner_email, allowed_users}; loopback only.
    // clients[N]: Webklex settings for a loopback synthetic provider; no saved edits.
    'fixture_scope' => [],
    'clients' => []
];

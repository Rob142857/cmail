#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerCli = resolve(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const expectedMigrations = readdirSync(resolve(root, 'packages', 'shared', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right, 'en'));

if (expectedMigrations.length === 0) {
  throw new Error('No D1 migration files were found.');
}

const persistenceDirectory = mkdtempSync(join(tmpdir(), 'cmail-migrations-'));

function runWrangler(args, captureOutput = false) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', NO_COLOR: '1' },
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    if (captureOutput) {
      process.stderr.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
    }
    throw new Error(`Wrangler exited with status ${result.status ?? 'unknown'}.`);
  }

  return result.stdout ?? '';
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function assertArrayEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function assertWranglerFailure(args, label) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status === 0) throw new Error(`${label}: expected D1 command to fail.`);
}

const baseArguments = [
  'cmail-schema-test',
  '--local',
  '--config',
  'scripts/wrangler.test.toml',
  '--persist-to',
  persistenceDirectory,
];

try {
  runWrangler(['d1', 'migrations', 'apply', ...baseArguments]);

  const rawMigrations = runWrangler(
    [
      'd1',
      'execute',
      ...baseArguments,
      '--command',
      'SELECT name FROM d1_migrations ORDER BY id;',
      '--json',
    ],
    true,
  );
  const parsedMigrations = JSON.parse(rawMigrations);
  const appliedMigrations = (parsedMigrations?.[0]?.results ?? []).map((row) => String(row.name));

  const verificationSql = `
    SELECT
      (SELECT COUNT(*) FROM d1_migrations) AS migration_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'users', 'sessions', 'mailboxes', 'mailbox_assignments', 'messages',
          'attachments', 'ict_policy_versions', 'ict_policy_signatures',
          'signature_templates', 'audit_log', 'mail_trace', 'rate_limits',
          'mailbox_reservations', 'send_idempotency', 'retention_config', 'org_settings',
          'organization_directory_settings', 'organization_layers',
          'organization_units', 'organization_roles', 'organization_positions',
          'push_subscriptions', 'outbound_send_journal',
          'outbound_send_targets', 'outbound_send_attachments'
        )) AS application_table_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'index' AND name IN (
          'idx_messages_inbound_idempotency', 'idx_signatures_user_policy',
          'idx_organization_units_root_name', 'idx_push_subscriptions_user',
          'idx_messages_draft_owner',
          'idx_mailbox_reservations_mailbox_time',
          'idx_mailbox_reservations_sender_time',
          'idx_mailbox_reservations_pending_storage',
          'idx_mailbox_reservations_draft_slots'
        )) AS essential_index_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'trigger' AND name IN (
          'trg_organization_units_prevent_insert_cycle',
          'trg_organization_units_prevent_cycle'
        )) AS organization_trigger_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'trigger' AND name IN (
          'trg_mailbox_reservations_guard',
          'trg_mailbox_reservations_prune',
          'trg_message_reservation_complete',
          'trg_message_reservation_release',
          'trg_draft_update_reservation_complete'
        )) AS inbound_guard_trigger_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'trigger' AND name IN (
          'trg_outbound_send_journal_payload_immutable',
          'trg_outbound_send_journal_result_guard',
          'trg_outbound_send_journal_state_guard',
          'trg_outbound_send_journal_materialized_guard',
          'trg_outbound_send_journal_terminal_release',
          'trg_outbound_send_journal_delete_guard',
          'trg_outbound_send_targets_immutable',
          'trg_outbound_send_target_reservation_guard',
          'trg_outbound_send_target_reservation_extend',
          'trg_outbound_send_attachments_immutable'
        )) AS outbound_journal_trigger_count,
      (SELECT COUNT(*) FROM retention_config
        WHERE (entity_type = 'deleted_messages' AND retention_days = 90)
           OR (entity_type = 'attachments' AND retention_days = 90)
           OR (entity_type = 'trace' AND retention_days = 90)
           OR (entity_type = 'audit' AND retention_days = 730)) AS retention_default_count,
      (SELECT enabled FROM organization_directory_settings
        WHERE singleton_id = 1) AS public_directory_enabled,
      (SELECT COUNT(*) FROM pragma_table_info('organization_positions')
        WHERE name = 'visibility' AND "notnull" = 1
          AND dflt_value = '''internal''') AS internal_visibility_default_count,
      (SELECT COUNT(*) FROM pragma_table_info('messages')
        WHERE name = 'draft_version' AND "notnull" = 1
          AND dflt_value = '0') AS draft_version_column_count,
      (SELECT COUNT(*) FROM pragma_table_info('messages')
        WHERE name = 'importance' AND "notnull" = 1
          AND dflt_value = '''normal''') AS importance_column_count,
      (SELECT COUNT(*) FROM pragma_table_info('messages')
        WHERE name = 'references_header') AS references_column_count,
      (SELECT COUNT(*) FROM pragma_table_info('messages')
        WHERE name = 'reply_to_addresses' AND "notnull" = 1
          AND dflt_value = '''[]''') AS reply_to_column_count,
      (SELECT COUNT(*) FROM pragma_table_info('messages')
        WHERE name IN ('provider_message_ids', 'failed_recipients')) AS message_delivery_column_count,
      (SELECT COUNT(*) FROM pragma_table_info('attachments')
        WHERE name IN ('content_id', 'disposition')) AS attachment_mime_column_count,
      (SELECT COUNT(*) FROM pragma_table_info('mail_trace')
        WHERE name IN ('provider_message_ids', 'failed_recipients')) AS trace_delivery_column_count,
      (SELECT COUNT(*) FROM pragma_table_info('outbound_send_journal')
        WHERE name IN ('payload_hash', 'html_sha256', 'text_sha256')
          AND "notnull" = 1) AS outbound_digest_column_count,
      (SELECT COUNT(*) FROM signature_templates
        WHERE id = 'sig-default' AND applies_to = '*') AS default_signature_count,
      (SELECT COUNT(*) FROM pragma_foreign_key_check) AS foreign_key_violation_count;
  `;

  const rawResult = runWrangler(
    ['d1', 'execute', ...baseArguments, '--command', verificationSql, '--json'],
    true,
  );
  const parsedResult = JSON.parse(rawResult);
  const row = parsedResult?.[0]?.results?.[0];

  if (!row) {
    throw new Error('Wrangler returned no schema verification row.');
  }

  assertEqual(Number(row.migration_count), expectedMigrations.length, 'Applied migration count');
  assertArrayEqual(appliedMigrations, expectedMigrations, 'Applied migration names');
  assertEqual(Number(row.application_table_count), 25, 'Application table count');
  assertEqual(Number(row.essential_index_count), 9, 'Essential index count');
  assertEqual(Number(row.organization_trigger_count), 2, 'Organisation cycle-trigger count');
  assertEqual(Number(row.inbound_guard_trigger_count), 5, 'Delivery reservation-trigger count');
  assertEqual(Number(row.outbound_journal_trigger_count), 10, 'Outbound journal-trigger count');
  assertEqual(Number(row.retention_default_count), 4, 'Retention default count');
  assertEqual(Number(row.public_directory_enabled), 0, 'Public directory default');
  assertEqual(Number(row.internal_visibility_default_count), 1, 'Position visibility default');
  assertEqual(Number(row.draft_version_column_count), 1, 'Draft version column');
  assertEqual(Number(row.importance_column_count), 1, 'Message importance column');
  assertEqual(Number(row.references_column_count), 1, 'Message References column');
  assertEqual(Number(row.reply_to_column_count), 1, 'Message Reply-To column');
  assertEqual(Number(row.message_delivery_column_count), 2, 'Message provider delivery columns');
  assertEqual(Number(row.attachment_mime_column_count), 2, 'Attachment MIME metadata columns');
  assertEqual(Number(row.trace_delivery_column_count), 2, 'Trace provider delivery columns');
  assertEqual(Number(row.outbound_digest_column_count), 3, 'Outbound journal digest columns');
  assertEqual(Number(row.default_signature_count), 1, 'Default signature seed count');
  assertEqual(Number(row.foreign_key_violation_count), 0, 'Foreign-key violation count');

  const senderHashA = 'a'.repeat(64);
  const senderHashB = 'b'.repeat(64);
  const guardSql = `
    INSERT INTO users (id, email, display_name, status) VALUES
      ('guard-user', 'guard-user@example.test', 'Guard user', 'active');

    INSERT INTO mailboxes (id, address, display_name) VALUES
      ('guard-count', 'guard-count@example.test', 'Guard count'),
      ('guard-bytes', 'guard-bytes@example.test', 'Guard bytes'),
      ('guard-sender', 'guard-sender@example.test', 'Guard sender'),
      ('guard-storage', 'guard-storage@example.test', 'Guard storage'),
      ('guard-disabled', 'guard-disabled@example.test', 'Guard disabled'),
      ('guard-multi-a', 'guard-multi-a@example.test', 'Guard multi A'),
      ('guard-multi-b', 'guard-multi-b@example.test', 'Guard multi B'),
      ('guard-same', 'guard-same@example.test', 'Guard same'),
      ('guard-duplicate', 'guard-duplicate@example.test', 'Guard duplicate'),
      ('guard-draft', 'guard-draft@example.test', 'Guard draft'),
      ('guard-journal', 'guard-journal@example.test', 'Guard journal');

    INSERT OR IGNORE INTO mailbox_reservations
      (id, delivery_key, mailbox_id, sender_hash, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('count-1', 'count-delivery-1', 'guard-count', '', 10, 1, 0, 0, 0, unixepoch() + 900);
    INSERT OR IGNORE INTO mailbox_reservations
      (id, delivery_key, mailbox_id, sender_hash, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('count-2', 'count-delivery-2', 'guard-count', '', 10, 1, 0, 0, 0, unixepoch() + 900);

    INSERT OR IGNORE INTO mailbox_reservations
      (id, delivery_key, mailbox_id, sender_hash, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('bytes-1', 'bytes-delivery-1', 'guard-bytes', '', 40, 0, 100, 0, 0, unixepoch() + 900),
      ('bytes-2', 'bytes-delivery-2', 'guard-bytes', '', 60, 0, 100, 0, 0, unixepoch() + 900);
    INSERT OR IGNORE INTO mailbox_reservations
      (id, delivery_key, mailbox_id, sender_hash, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('bytes-3', 'bytes-delivery-3', 'guard-bytes', '', 1, 0, 100, 0, 0, unixepoch() + 900);

    INSERT OR IGNORE INTO mailbox_reservations
      (id, delivery_key, mailbox_id, sender_hash, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('sender-1', 'sender-delivery-1', 'guard-sender', '${senderHashA}', 1, 0, 0, 1, 0, unixepoch() + 900);
    INSERT OR IGNORE INTO mailbox_reservations
      (id, delivery_key, mailbox_id, sender_hash, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('sender-2', 'sender-delivery-2', 'guard-sender', '${senderHashA}', 1, 0, 0, 1, 0, unixepoch() + 900);
    INSERT OR IGNORE INTO mailbox_reservations
      (id, delivery_key, mailbox_id, sender_hash, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('sender-3', 'sender-delivery-3', 'guard-sender', '${senderHashB}', 1, 0, 0, 1, 0, unixepoch() + 900);

    INSERT INTO messages
      (id, mailbox_id, direction, from_address, to_addresses, subject, size_bytes)
    VALUES
      ('storage-existing', 'guard-storage', 'inbound', 'sender@example.test', '[]', 'Existing', 900);
    INSERT OR IGNORE INTO mailbox_reservations
      (id, delivery_key, mailbox_id, sender_hash, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('storage-1', 'storage-current', 'guard-storage', '', 100, 0, 0, 0, 1000, unixepoch() + 900);
    INSERT INTO messages
      (id, mailbox_id, direction, from_address, to_addresses, subject, size_bytes)
    VALUES
      ('storage-current', 'guard-storage', 'inbound', 'sender@example.test', '[]', 'Current', 100);
    INSERT OR IGNORE INTO mailbox_reservations
      (id, delivery_key, mailbox_id, sender_hash, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('storage-2', 'storage-over', 'guard-storage', '', 1, 0, 0, 0, 1000, unixepoch() + 900);

    INSERT OR IGNORE INTO mailbox_reservations
      (id, delivery_key, mailbox_id, sender_hash, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('disabled-1', 'disabled-delivery', 'guard-disabled', '', 999999, 0, 0, 0, 0, unixepoch() + 900),
      ('disabled-duplicate', 'disabled-delivery', 'guard-disabled', '', 999999, 0, 0, 0, 0, unixepoch() + 900);

    -- Storage-only reservations share one invariant across mailbox copies.
    INSERT OR IGNORE INTO mailbox_reservations
      (id, delivery_key, reservation_type, mailbox_id, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('multi-a', 'multi-delivery-a', 'storage', 'guard-multi-a', 60, 0, 0, 0, 100, unixepoch() + 900),
      ('multi-b', 'multi-delivery-b', 'storage', 'guard-multi-b', 60, 0, 0, 0, 100, unixepoch() + 900);

    INSERT INTO mailbox_reservations
      (id, delivery_key, reservation_type, mailbox_id, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('outbound-reservation', 'outbound-settle', 'storage', 'guard-multi-a', 40, 0, 0, 0, 100, unixepoch() + 900);
    INSERT INTO messages
      (id, mailbox_id, direction, from_address, to_addresses, subject, size_bytes, folder)
    VALUES
      ('outbound-settle', 'guard-multi-a', 'outbound', 'sender@example.test', '[]', 'Sent', 40, 'sent');

    INSERT INTO messages
      (id, mailbox_id, direction, from_address, to_addresses, subject, size_bytes, folder, draft_owner_id, body_r2_key)
    VALUES
      ('draft-update', 'guard-draft', 'outbound', 'sender@example.test', '[]', 'Draft', 10, 'drafts', 'guard-user', 'old-body');
    INSERT INTO mailbox_reservations
      (id, delivery_key, reservation_type, mailbox_id, draft_owner_id, draft_row_limit, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('draft-update-reservation', 'draft-update/draft-update', 'storage', 'guard-draft', NULL, 0, 10, 0, 0, 0, 100, unixepoch() + 900);
    UPDATE messages SET size_bytes = 20, body_r2_key = 'new-body' WHERE id = 'draft-update';

    INSERT INTO mailbox_reservations
      (id, delivery_key, reservation_type, mailbox_id, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('journal-reservation', 'journal-message', 'storage', 'guard-journal', 1, 0, 0, 0, 100, unixepoch() + 900);
    INSERT INTO outbound_send_journal
      (id, user_id, mailbox_id, idempotency_key, payload_hash, html_sha256,
       text_sha256, provider,
       from_address, to_addresses, cc_addresses, envelope_recipients, subject,
       snippet, importance, thread_id, proposed_message_id_header,
       message_id_header, html_r2_key, text_r2_key, persisted_bytes,
       provider_payload_bytes)
    VALUES
      ('journal-1', 'guard-user', 'guard-journal', 'draft:journal-draft:version:1',
       '${'c'.repeat(64)}', '${'d'.repeat(64)}', '${'e'.repeat(64)}',
       'cloudflare', 'guard-journal@example.test',
       '["recipient@example.net"]', '[]', '["recipient@example.net"]',
       'Journal test', 'Journal test', 'normal', '<journal@example.test>',
       '<journal@example.test>', '<journal@example.test>',
       'outbound-journal/journal-1/body.html',
       'outbound-journal/journal-1/body.txt', 1, 1);
    INSERT INTO outbound_send_targets
      (id, journal_id, ordinal, message_id, mailbox_id, direction, folder,
       body_r2_key, attachment_ids, reservation_id)
    VALUES
      ('journal-target-1', 'journal-1', 0, 'journal-message', 'guard-journal',
       'outbound', 'sent', 'messages/guard-journal/journal-message/body.html',
       '[]', 'journal-reservation');

    INSERT INTO mailbox_reservations
      (id, delivery_key, reservation_type, mailbox_id, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('terminal-reservation', 'terminal-message', 'storage', 'guard-journal',
       1, 0, 0, 0, 100, unixepoch() + 900);
    INSERT INTO outbound_send_journal
      (id, user_id, mailbox_id, idempotency_key, payload_hash, html_sha256,
       text_sha256, provider, from_address, to_addresses, cc_addresses,
       envelope_recipients, subject, snippet, proposed_message_id_header,
       message_id_header, html_r2_key, text_r2_key, persisted_bytes,
       provider_payload_bytes)
    VALUES
      ('journal-terminal', 'guard-user', 'guard-journal', 'draft:terminal:v:1',
       '${'4'.repeat(64)}', '${'5'.repeat(64)}', '${'6'.repeat(64)}',
       'cloudflare', 'guard-journal@example.test', '["recipient@example.net"]',
       '[]', '["recipient@example.net"]', 'Terminal test', 'Terminal test',
       '<terminal@example.test>', '<terminal@example.test>',
       'outbound-journal/journal-terminal/body.html',
       'outbound-journal/journal-terminal/body.txt', 1, 1);
    INSERT INTO outbound_send_targets
      (id, journal_id, ordinal, message_id, mailbox_id, direction, folder,
       body_r2_key, attachment_ids, reservation_id)
    VALUES
      ('journal-terminal-target', 'journal-terminal', 0, 'terminal-message',
       'guard-journal', 'outbound', 'sent',
       'messages/guard-journal/terminal-message/body.html', '[]',
       'terminal-reservation');
  `;
  runWrangler(['d1', 'execute', ...baseArguments, '--command', guardSql]);

  assertWranglerFailure(
    ['d1', 'execute', ...baseArguments, '--command', `
      INSERT INTO messages
        (id, mailbox_id, direction, from_address, to_addresses, subject, importance)
      VALUES
        ('invalid-importance', 'guard-count', 'inbound', 'sender@example.test', '[]', 'Invalid', 'urgent');
    `],
    'Message importance enum guard',
  );

  const sameMailboxGroupSql = `
    INSERT INTO mailbox_reservations
      (id, delivery_key, reservation_type, mailbox_id, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES ('same-1', 'same-delivery-1', 'storage', 'guard-same', 60, 0, 0, 0, 100, unixepoch() + 900);
    INSERT INTO mailbox_reservations
      (id, delivery_key, reservation_type, mailbox_id, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES ('same-2', 'same-delivery-2', 'storage', 'guard-same', 50, 0, 0, 0, 100, unixepoch() + 900);
  `;
  assertWranglerFailure(
    ['d1', 'execute', ...baseArguments, '--command', sameMailboxGroupSql],
    'Same-mailbox aggregate reservation rollback',
  );
  runWrangler(['d1', 'execute', ...baseArguments, '--command', `
    INSERT INTO mailbox_reservations
      (id, delivery_key, reservation_type, mailbox_id, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES ('same-exact', 'same-exact-delivery', 'storage', 'guard-same', 100, 0, 0, 0, 100, unixepoch() + 900);
  `]);

  const duplicateGroupSql = `
    INSERT INTO mailbox_reservations
      (id, delivery_key, reservation_type, mailbox_id, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES ('duplicate-1', 'duplicate-delivery', 'storage', 'guard-duplicate', 10, 0, 0, 0, 100, unixepoch() + 900);
    INSERT INTO mailbox_reservations
      (id, delivery_key, reservation_type, mailbox_id, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES ('duplicate-2', 'duplicate-delivery', 'storage', 'guard-duplicate', 10, 0, 0, 0, 100, unixepoch() + 900);
  `;
  assertWranglerFailure(
    ['d1', 'execute', ...baseArguments, '--command', duplicateGroupSql],
    'Duplicate delivery-key group rollback',
  );

  assertWranglerFailure(
    ['d1', 'execute', ...baseArguments, '--command', `
      INSERT INTO mailbox_reservations
        (id, delivery_key, reservation_type, mailbox_id, draft_owner_id, draft_row_limit, message_bytes,
         mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
         storage_quota_bytes, pending_expires_at)
      VALUES ('draft-cap', 'draft-cap-delivery', 'draft', 'guard-draft', 'guard-user', 1, 1, 0, 0, 0, 100, unixepoch() + 900);
    `],
    'Per-user mailbox draft-row cap',
  );

  runWrangler(['d1', 'execute', ...baseArguments, '--command', `
    UPDATE outbound_send_journal
      SET state = 'dispatching', dispatch_token = 'terminal-attempt-1',
          attempt_count = attempt_count + 1, dispatched_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = 'journal-terminal';
    UPDATE outbound_send_journal
      SET state = 'permanent_failure', last_error = 'provider rejected',
          updated_at = datetime('now')
      WHERE id = 'journal-terminal';
  `]);

  const rawGuardResult = runWrangler(
    ['d1', 'execute', ...baseArguments, '--command', `
      SELECT
        (SELECT COUNT(*) FROM mailbox_reservations WHERE mailbox_id = 'guard-count') AS count_rows,
        (SELECT COUNT(*) FROM mailbox_reservations WHERE mailbox_id = 'guard-bytes') AS byte_rows,
        (SELECT COALESCE(SUM(message_bytes), 0) FROM mailbox_reservations WHERE mailbox_id = 'guard-bytes') AS byte_total,
        (SELECT COUNT(*) FROM mailbox_reservations WHERE mailbox_id = 'guard-sender') AS sender_rows,
        (SELECT COUNT(*) FROM mailbox_reservations WHERE id = 'storage-1' AND storage_pending = 0) AS storage_completed,
        (SELECT COUNT(*) FROM mailbox_reservations WHERE id = 'storage-2') AS storage_over_rows,
        (SELECT COUNT(*) FROM mailbox_reservations WHERE mailbox_id = 'guard-disabled') AS disabled_rows,
        (SELECT COUNT(*) FROM mailbox_reservations WHERE id IN ('multi-a', 'multi-b')) AS multi_rows,
        (SELECT COUNT(*) FROM mailbox_reservations WHERE mailbox_id = 'guard-same') AS same_rows,
        (SELECT COUNT(*) FROM mailbox_reservations WHERE mailbox_id = 'guard-duplicate') AS duplicate_rows,
        (SELECT COUNT(*) FROM mailbox_reservations WHERE id = 'outbound-reservation' AND storage_pending = 0) AS outbound_completed,
        (SELECT COUNT(*) FROM mailbox_reservations WHERE id = 'draft-update-reservation' AND storage_pending = 0 AND delivery_key IS NULL) AS draft_update_completed,
        (SELECT COUNT(*) FROM mailbox_reservations WHERE id = 'draft-cap') AS draft_cap_rows,
        (SELECT pending_expires_at FROM mailbox_reservations WHERE id = 'journal-reservation') AS journal_reservation_expiry,
        (SELECT COUNT(*) FROM mailbox_reservations
          WHERE id = 'terminal-reservation' AND storage_pending = 0
            AND delivery_key IS NULL) AS terminal_reservation_released;
    `, '--json'],
    true,
  );
  const guardRow = JSON.parse(rawGuardResult)?.[0]?.results?.[0];
  if (!guardRow) throw new Error('Wrangler returned no inbound-guard verification row.');
  assertEqual(Number(guardRow.count_rows), 1, 'Atomic mailbox-message boundary');
  assertEqual(Number(guardRow.byte_rows), 2, 'Atomic mailbox-byte boundary row count');
  assertEqual(Number(guardRow.byte_total), 100, 'Atomic mailbox-byte exact boundary');
  assertEqual(Number(guardRow.sender_rows), 2, 'Mailbox-scoped sender boundary');
  assertEqual(Number(guardRow.storage_completed), 1, 'Storage reservation completion trigger');
  assertEqual(Number(guardRow.storage_over_rows), 0, 'Retained-storage overage rejection');
  assertEqual(Number(guardRow.disabled_rows), 1, 'Disabled guard and duplicate uniqueness behavior');
  assertEqual(Number(guardRow.multi_rows), 2, 'Independent multi-mailbox reservations');
  assertEqual(Number(guardRow.same_rows), 1, 'Same-mailbox aggregate rollback and exact-boundary reuse');
  assertEqual(Number(guardRow.duplicate_rows), 0, 'Duplicate delivery-key group rollback');
  assertEqual(Number(guardRow.outbound_completed), 1, 'Outbound message-insert settlement');
  assertEqual(Number(guardRow.draft_update_completed), 1, 'Draft update-delta settlement');
  assertEqual(Number(guardRow.draft_cap_rows), 0, 'Per-user mailbox draft-row cap');
  assertEqual(Number(guardRow.journal_reservation_expiry), 4102444800, 'Durable outbound reservation expiry');
  assertEqual(Number(guardRow.terminal_reservation_released), 1, 'Atomic terminal reservation release');

  assertWranglerFailure(
    ['d1', 'execute', ...baseArguments, '--command', `
      UPDATE outbound_send_journal SET subject = 'Mutated' WHERE id = 'journal-1';
    `],
    'Outbound journal payload immutability',
  );
  assertWranglerFailure(
    ['d1', 'execute', ...baseArguments, '--command', `
      DELETE FROM outbound_send_journal WHERE id = 'journal-1';
    `],
    'Unresolved outbound journal deletion',
  );
  assertWranglerFailure(
    ['d1', 'execute', ...baseArguments, '--command', `
      DELETE FROM mailbox_reservations WHERE id = 'journal-reservation';
    `],
    'Unresolved outbound reservation deletion',
  );
  assertWranglerFailure(
    ['d1', 'execute', ...baseArguments, '--command', `
      INSERT INTO outbound_send_journal
        (id, user_id, mailbox_id, idempotency_key, payload_hash, html_sha256,
         text_sha256, provider,
         from_address, to_addresses, cc_addresses, envelope_recipients, subject,
         snippet, proposed_message_id_header, message_id_header, html_r2_key,
         text_r2_key, persisted_bytes, provider_payload_bytes)
      VALUES
        ('journal-duplicate', 'guard-user', 'guard-journal', 'draft:journal-draft:version:1',
         '${'f'.repeat(64)}', '${'a'.repeat(64)}', '${'b'.repeat(64)}',
         'cloudflare', 'guard-journal@example.test',
         '["recipient@example.net"]', '[]', '["recipient@example.net"]',
         'Duplicate', 'Duplicate', '<duplicate@example.test>',
         '<duplicate@example.test>', 'outbound-journal/duplicate/body.html',
         'outbound-journal/duplicate/body.txt', 1, 1);
    `],
    'Active outbound idempotency uniqueness',
  );

  runWrangler(['d1', 'execute', ...baseArguments, '--command', `
    UPDATE outbound_send_journal
      SET state = 'dispatching', dispatch_token = 'attempt-1',
          attempt_count = attempt_count + 1, dispatched_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = 'journal-1';
    UPDATE outbound_send_journal
      SET state = 'accepted', accepted_at = datetime('now')
      WHERE id = 'journal-1';
  `]);
  assertWranglerFailure(
    ['d1', 'execute', ...baseArguments, '--command', `
      UPDATE outbound_send_journal
        SET provider_message_ids = '["rewritten"]'
        WHERE id = 'journal-1';
    `],
    'Accepted outbound result immutability',
  );
  assertWranglerFailure(
    ['d1', 'execute', ...baseArguments, '--command', `
      UPDATE outbound_send_journal SET state = 'materialized' WHERE id = 'journal-1';
    `],
    'Incomplete outbound materialization guard',
  );
  runWrangler(['d1', 'execute', ...baseArguments, '--command', `
    INSERT INTO messages
      (id, mailbox_id, message_id_header, direction, from_address, to_addresses,
       cc_addresses, subject, snippet, body_r2_key, size_bytes, folder, is_read,
       importance, thread_id)
    VALUES
      ('journal-message', 'guard-journal', '<journal@example.test>', 'outbound',
       'guard-journal@example.test', '["recipient@example.net"]', '[]',
       'Journal test', 'Journal test',
       'messages/guard-journal/journal-message/body.html', 1, 'sent', 1,
       'normal', '<journal@example.test>');
    UPDATE outbound_send_targets
      SET materialized_at = datetime('now') WHERE id = 'journal-target-1';
    UPDATE outbound_send_journal
      SET state = 'materialized', materialized_at = datetime('now')
      WHERE id = 'journal-1';
  `]);
  const rawJournalResult = runWrangler(
    ['d1', 'execute', ...baseArguments, '--command', `
      SELECT
        (SELECT state FROM outbound_send_journal WHERE id = 'journal-1') AS state,
        (SELECT storage_pending FROM mailbox_reservations WHERE id = 'journal-reservation') AS storage_pending;
    `, '--json'],
    true,
  );
  const journalRow = JSON.parse(rawJournalResult)?.[0]?.results?.[0];
  if (!journalRow) throw new Error('Wrangler returned no outbound-journal verification row.');
  assertEqual(String(journalRow.state), 'materialized', 'Outbound journal terminal state');
  assertEqual(Number(journalRow.storage_pending), 0, 'Outbound reservation settlement');

  assertWranglerFailure(
    ['d1', 'execute', ...baseArguments, '--command', `
      INSERT INTO outbound_send_journal
        (id, user_id, mailbox_id, idempotency_key, payload_hash, html_sha256,
         text_sha256, provider, from_address, to_addresses, cc_addresses,
         envelope_recipients, subject, snippet, proposed_message_id_header,
         message_id_header, html_r2_key, text_r2_key, persisted_bytes,
         provider_payload_bytes)
      VALUES
        ('journal-after-materialized', 'guard-user', 'guard-journal',
         'draft:journal-draft:version:1', '${'1'.repeat(64)}', '${'2'.repeat(64)}',
         '${'3'.repeat(64)}', 'cloudflare', 'guard-journal@example.test',
         '["recipient@example.net"]', '[]', '["recipient@example.net"]',
         'Duplicate after materialization', 'Duplicate',
         '<after-materialized@example.test>', '<after-materialized@example.test>',
         'outbound-journal/after-materialized/body.html',
         'outbound-journal/after-materialized/body.txt', 1, 1);
    `],
    'Materialized outbound idempotency tombstone',
  );

  runWrangler(['d1', 'execute', ...baseArguments, '--command', `
    UPDATE mailbox_reservations
      SET created_epoch = unixepoch() - 7201
      WHERE id = 'journal-reservation';
    INSERT INTO mailbox_reservations
      (id, delivery_key, reservation_type, mailbox_id, message_bytes,
       mailbox_message_limit, mailbox_byte_limit, sender_message_limit,
       storage_quota_bytes, pending_expires_at)
    VALUES
      ('reservation-after-terminal-prune', 'after-terminal-prune', 'storage',
       'guard-journal', 1, 0, 0, 0, 100, unixepoch() + 900);
  `]);
  const rawPruneResult = runWrangler(
    ['d1', 'execute', ...baseArguments, '--command', `
      SELECT
        (SELECT COUNT(*) FROM mailbox_reservations
          WHERE id = 'journal-reservation') AS old_reservation_count,
        (SELECT COUNT(*) FROM mailbox_reservations
          WHERE id = 'reservation-after-terminal-prune') AS new_reservation_count,
        (SELECT COUNT(*) FROM outbound_send_targets
          WHERE id = 'journal-target-1' AND reservation_id IS NULL) AS detached_target_count;
    `, '--json'],
    true,
  );
  const pruneRow = JSON.parse(rawPruneResult)?.[0]?.results?.[0];
  if (!pruneRow) throw new Error('Wrangler returned no terminal-prune verification row.');
  assertEqual(Number(pruneRow.old_reservation_count), 0, 'Terminal reservation pruning');
  assertEqual(Number(pruneRow.new_reservation_count), 1, 'Reservation insert after terminal pruning');
  assertEqual(Number(pruneRow.detached_target_count), 1, 'Terminal target reservation detachment');

  const migrationLabel = expectedMigrations.length === 1 ? 'migration' : 'migrations';
  console.log(
    `Fresh D1 migration verified: ${expectedMigrations.length} ${migrationLabel}, ` +
      '25 application tables, required indexes, atomic delivery guards, triggers, and defaults.',
  );
} finally {
  rmSync(persistenceDirectory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

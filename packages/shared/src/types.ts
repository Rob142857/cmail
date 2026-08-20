// ─── User ─────────────────────────────────────────────────
export type UserRole = 'standard' | 'manager';
export type UserStatus = 'pending' | 'active' | 'paused' | 'offboarded';
/**
 * Every identity provider cmail can bind a user_identities row to. 'email'
 * is the invitation-scoped one-time-code method (see email-otp.ts) — it is
 * deliberately NOT a valid value of users.auth_provider below; that column
 * keeps its original narrower CHECK (see migration 0013's comment for why),
 * so OTP-only accounts simply leave auth_provider at ''.
 */
export type AuthProvider = 'google' | 'microsoft' | 'email';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  /** Denormalised OAuth display cache only — never 'email'. See AuthProvider. */
  auth_provider: 'google' | 'microsoft' | '';
  created_at: string;
  updated_at: string;
  last_sign_in: string | null;
  /** Country (CF-IPCountry) of the most recent successful sign-in, for email-OTP geo-change auditing. */
  last_auth_country: string | null;
}

/** Immutable OpenID Connect identity bound to one cmail user. */
export interface UserIdentity {
  provider: AuthProvider;
  subject: string;
  user_id: string;
  created_at: string;
}

/** Hashed, single-use first-sign-in invitation. Raw tokens are never stored. */
export interface EnrollmentToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  consumed_at: string | null;
  created_at: string;
  created_by: string | null;
}

// ─── Session ──────────────────────────────────────────────
export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  issued_at: string;
  expires_at: string;
  ip_address: string | null;
  revoked: number;
}

// ─── Mailbox ──────────────────────────────────────────────
export type MailboxType = 'personal' | 'shared';

export interface Mailbox {
  id: string;
  address: string;
  type: MailboxType;
  /** The immutable account owner for a personal mailbox; null for shared mailboxes. */
  owner_user_id: string | null;
  display_name: string;
  status: 'active' | 'disabled';
  created_at: string;
}

export interface MailboxAssignment {
  user_id: string;
  mailbox_id: string;
  permissions: 'read' | 'send-as' | 'full';
  assigned_at: string;
  assigned_by: string | null;
}

// ─── Message ──────────────────────────────────────────────
export type MessageDirection = 'inbound' | 'outbound' | 'internal';
export type Folder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash';
export type MessageImportance = 'low' | 'normal' | 'high';
export interface MessageParticipant {
  address: string;
  name: string;
}

export interface Message {
  id: string;
  mailbox_id: string;
  message_id_header: string | null;
  direction: MessageDirection;
  from_address: string;
  /** Decoded display-only RFC 5322 name; routing always uses from_address. */
  from_name: string;
  to_addresses: string; // JSON array
  cc_addresses: string; // JSON array
  to_participants: string; // JSON array of MessageParticipant
  cc_participants: string; // JSON array of MessageParticipant
  subject: string;
  snippet: string;
  body_r2_key: string | null;
  has_attachments: number;
  size_bytes: number;
  folder: Folder;
  draft_owner_id: string | null;
  draft_version: number;
  is_read: number;
  is_starred: number;
  importance: MessageImportance;
  in_reply_to: string | null;
  references_header: string | null;
  reply_to_addresses: string;
  reply_to_participants: string; // JSON array of MessageParticipant
  /** JSON array of provider tracking identifiers; they are not RFC Message-IDs. */
  provider_message_ids: string;
  failed_recipients: string;
  thread_id: string | null;
  /** Spam score reported by the receiving boundary; null when none was given. */
  spam_score: number | null;
  /** 1 when the mailbox had no prior correspondence with the sender. */
  sender_first_contact: number;
  received_at: string;
  created_at: string;
}

// ─── Attachment ───────────────────────────────────────────
export interface Attachment {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  r2_key: string;
  content_id: string | null;
  disposition: 'attachment' | 'inline';
}

// ─── Policy ───────────────────────────────────────────────
export interface PolicyVersion {
  id: string;
  version_label: string;
  body_text: string;
  published_at: string;
  published_by: string | null;
}

export interface PolicySignature {
  id: string;
  user_id: string;
  policy_version_id: string;
  signed_at: string;
  ip_address: string | null;
  session_id: string | null;
}

// ─── Email signatures ────────────────────────────────────────────────────
/** One self-service signature per user; managers may lock it centrally. */
export interface PersonalSignature {
  user_id: string;
  html_body: string;
  plain_text_body: string;
  is_locked: number;
  updated_at: string;
  updated_by: string | null;
}

/** An organisation signature chosen by mailbox address, or the `*` default. */
export interface SignatureTemplate {
  id: string;
  name: string;
  applies_to: string;
  html_body: string;
  plain_text_body: string;
  is_locked: number;
  is_enabled: number;
  updated_at: string;
  updated_by: string | null;
}

// ─── Audit ────────────────────────────────────────────────
export type AuditEventType =
  | 'user.onboard' | 'user.offboard' | 'user.pause' | 'user.reactivate' | 'user.role_change'
  | 'auth.sign_in' | 'auth.sign_in_denied' | 'auth.session_expired'
  | 'auth.identity_bound' | 'auth.bootstrap_completed' | 'auth.enrollment_issued'
  | 'policy.publish' | 'policy.sign' | 'policy.reset'
  | 'mailbox.create' | 'mailbox.delete' | 'mailbox.assign' | 'mailbox.unassign'
  | 'signature.update' | 'signature.lock'
  | 'retention.update'
  | 'export.mailbox'
  | 'security.rate_limit' | 'security.suspicious_auth';

export interface AuditRecord {
  event_id: string;
  timestamp: string;
  actor_id: string | null;
  actor_role: 'standard' | 'manager' | 'system';
  event_type: AuditEventType;
  target: string | null;
  detail: string | null;
  ip_address: string | null;
  session_id: string | null;
}

// ─── Mail Trace ───────────────────────────────────────────
export interface MailTrace {
  trace_id: string;
  message_id_header: string | null;
  provider_message_ids: string;
  failed_recipients: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  envelope_from: string | null;
  envelope_to: string | null;
  header_from: string | null;
  subject: string | null;
  size_bytes: number | null;
  status: 'delivered' | 'bounced' | 'rejected' | 'quarantined' | 'deferred' | 'sent';
  status_detail: string | null;
  spf_result: string | null;
  dkim_result: string | null;
  dmarc_result: string | null;
  spam_score: number | null;
  tls_version: string | null;
  relay_response: string | null;
  source_ip: string | null;
}

// ─── Env bindings (Cloudflare) ────────────────────────────
export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;


  MAIL_DOMAIN: string;
  APP_NAME: string;
  APP_URL: string;
  SESSION_SECRET: string;

  // Organisation branding (used in invite emails, landing, footer)
  ORG_NAME?: string;          // e.g. "Example Organisation"
  ORG_SHORT_NAME?: string;    // e.g. "Example Org"
  ORG_URL?: string;           // e.g. "https://example.com"
  SUPPORT_EMAIL?: string;     // e.g. "support@example.com"
  LANDING_URL?: string;       // e.g. "https://mail.example.com"
  POLICY_URL?: string;        // e.g. "https://mail.example.com/policy"
  REPO_URL?: string;          // e.g. "https://github.com/Rob142857/cmail"
  SYSTEM_EMAIL?: string;      // sender used for invites/system mail
  SYSTEM_FROM_NAME?: string;
  BRAND_LOGO_URL?: string;
  BRAND_ICON_URL?: string;
  BRAND_ICON_192_URL?: string;
  BRAND_ICON_512_URL?: string;
  BRAND_OG_IMAGE_URL?: string;
  BRAND_PRIMARY_COLOR?: string;
  LOCALE?: string;
  TIME_ZONE?: string;

  // Guardrails
  MAX_RECIPIENTS_PER_MESSAGE?: string;
  OUTBOUND_RATE_LIMIT_PER_HOUR?: string;
  OUTBOUND_WORK_LIMIT_PER_HOUR?: string;
  DRAFT_SAVE_RATE_PER_HOUR?: string;
  MAX_DRAFTS_PER_MAILBOX_USER?: string;
  SESSION_TTL_HOURS?: string;
  MAX_SESSIONS_PER_USER?: string;
  MAX_INBOUND_BYTES?: string;
  MAX_ATTACHMENTS_PER_MESSAGE?: string;
  INBOUND_MAILBOX_MESSAGES_PER_HOUR?: string;
  INBOUND_MAILBOX_BYTES_PER_HOUR?: string;
  INBOUND_SENDER_MESSAGES_PER_HOUR?: string;
  MAILBOX_STORAGE_QUOTA_BYTES?: string;
  /** @deprecated Use MAILBOX_STORAGE_QUOTA_BYTES. */
  INBOUND_MAILBOX_STORAGE_BYTES?: string;
  INBOUND_SENDER_HASH_KEY?: string;
  MAX_INBOUND_DECODED_BODY_BYTES?: string;
  RETENTION_JOBS_ENABLED?: string;

  // Optional Web Push. The same VAPID key pair is configured on Pages and the
  // inbound Worker; only the public key is ever sent to browsers.
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  PUSH_ENDPOINT_HOSTS?: string;

  // Auth — at least one required
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: string;

  // Outbound — optional explicit selection; "auto" uses the first complete configuration
  OUTBOUND_PROVIDER?: string;
  /** Recommended Cloudflare path: private Pages-to-Worker service binding. */
  EMAIL_SERVICE?: Fetcher;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_EMAIL_API_TOKEN?: string;
  POSTMARK_API_KEY?: string;

  // Bootstrap — first-run manager setup (both are temporary secrets/config)
  BOOTSTRAP_ADMIN_EMAIL?: string;
  BOOTSTRAP_ADMIN_TOKEN?: string;
}

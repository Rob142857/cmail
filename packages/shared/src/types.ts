// ─── User ─────────────────────────────────────────────────
export type UserRole = 'standard' | 'manager';
export type UserStatus = 'pending' | 'active' | 'paused' | 'offboarded';
export type AuthProvider = 'google' | 'microsoft';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  auth_provider: AuthProvider | '';
  created_at: string;
  updated_at: string;
  last_sign_in: string | null;
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

export interface Message {
  id: string;
  mailbox_id: string;
  message_id_header: string | null;
  direction: MessageDirection;
  from_address: string;
  to_addresses: string; // JSON array
  cc_addresses: string; // JSON array
  subject: string;
  snippet: string;
  body_r2_key: string | null;
  has_attachments: number;
  size_bytes: number;
  folder: Folder;
  is_read: number;
  is_starred: number;
  in_reply_to: string | null;
  thread_id: string | null;
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

// ─── Audit ────────────────────────────────────────────────
export type AuditEventType =
  | 'user.onboard' | 'user.offboard' | 'user.pause' | 'user.reactivate' | 'user.role_change'
  | 'auth.sign_in' | 'auth.sign_in_denied' | 'auth.session_expired'
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
  EMAIL: SendEmail; // Cloudflare Email Service binding (optional)

  MAIL_DOMAIN: string;
  APP_NAME: string;
  APP_URL: string;
  SESSION_SECRET: string;

  // Organisation branding (used in invite emails, landing, footer)
  ORG_NAME?: string;          // e.g. "Ma'atara Organisation"
  ORG_SHORT_NAME?: string;    // e.g. "Ma'atara"
  ORG_URL?: string;           // e.g. "https://maatara.io"
  SUPPORT_EMAIL?: string;     // e.g. "desk@maatara.io"
  LANDING_URL?: string;       // e.g. "https://cmail.maatara.io"
  POLICY_URL?: string;        // e.g. "https://mail.maatara.io/policy"
  REPO_URL?: string;          // e.g. "https://github.com/Rob142857/cmail"
  SYSTEM_EMAIL?: string;      // sender used for invites/system mail

  // Auth — at least one required
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: string;

  // Outbound — at most one
  RESEND_API_KEY?: string;
  POSTMARK_API_KEY?: string;

  // Bootstrap — first-run admin auto-provision
  BOOTSTRAP_ADMIN_EMAIL?: string;
}

// Cloudflare send_email binding type
interface SendEmail {
  send(message: EmailMessage): Promise<void>;
}

interface EmailMessage {
  readonly from: string;
  readonly to: string;
}

# cmail Codebase - Quick Fixes Guide

This document provides ready-to-implement fixes for the critical robustness issues identified in the audit.

---

## 1. ADD ROLE CHECKS TO ALL ADMIN ACTIONS

### Fix 1.1: Policy Publishing Permission Check
**File:** `apps/web/src/routes/admin/policy/+page.server.ts`  
**Change:** Lines 17-20

**Current:**
```typescript
export const actions: Actions = {
  publish: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };
```

**Fixed:**
```typescript
export const actions: Actions = {
  publish: async ({ request, platform, locals }) => {
    if (!locals.user) return { error: 'Not authenticated' };
    if (locals.user.role !== 'manager') return { error: 'Only managers can publish policies' };
    
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };
```

---

### Fix 1.2: Mailbox Creation Permission Check
**File:** `apps/web/src/routes/admin/mailboxes/+page.server.ts`  
**Change:** Lines 23-26

**Current:**
```typescript
create: async ({ request, platform, locals }) => {
  const env = platform?.env;
  if (!env) return { error: 'Platform not available' };

  const data = await request.formData();
```

**Fixed:**
```typescript
create: async ({ request, platform, locals }) => {
  if (!locals.user) return { error: 'Not authenticated' };
  if (locals.user.role !== 'manager') return { error: 'Only managers can create mailboxes' };

  const env = platform?.env;
  if (!env) return { error: 'Platform not available' };

  const data = await request.formData();
```

---

### Fix 1.3: Mailbox Assignment Permission Check
**File:** `apps/web/src/routes/admin/mailboxes/+page.server.ts`  
**Change:** Lines 44-47

**Current:**
```typescript
assign: async ({ request, platform, locals }) => {
  const env = platform?.env;
  if (!env) return { error: 'Platform not available' };

  const data = await request.formData();
```

**Fixed:**
```typescript
assign: async ({ request, platform, locals }) => {
  if (!locals.user) return { error: 'Not authenticated' };
  if (locals.user.role !== 'manager') return { error: 'Only managers can assign mailboxes' };

  const env = platform?.env;
  if (!env) return { error: 'Platform not available' };

  const data = await request.formData();
```

---

### Fix 1.4: Mail Trace View Permission Check
**File:** `apps/web/src/routes/admin/trace/+page.server.ts`  
**Change:** Lines 1-6

**Current:**
```typescript
import type { PageServerLoad } from './$types';
import type { MailTrace } from '@cmail/shared/types';

export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  if (!env) return { traces: [] };
```

**Fixed:**
```typescript
import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { MailTrace } from '@cmail/shared/types';

export const load: PageServerLoad = async ({ platform, url, locals }) => {
  if (!locals.user) throw redirect(302, '/');
  if (locals.user.role !== 'manager') throw error(403, 'Only managers can view mail trace');

  const env = platform?.env;
  if (!env) throw error(500);
```

---

## 2. UPDATE SCHEMA - FIX COLUMN MISMATCHES

### Fix 2.1: Add Missing html_body Column to ict_policy_versions
**File:** `packages/shared/src/schema.sql`  
**Change:** Lines 86-92

**Current:**
```sql
CREATE TABLE IF NOT EXISTS ict_policy_versions (
  id            TEXT PRIMARY KEY,
  version_label TEXT NOT NULL,
  body_text     TEXT NOT NULL,
  published_at  TEXT NOT NULL DEFAULT (datetime('now')),
  published_by  TEXT REFERENCES users(id)
);
```

**Fixed:**
```sql
CREATE TABLE IF NOT EXISTS ict_policy_versions (
  id            TEXT PRIMARY KEY,
  version_label TEXT NOT NULL,
  html_body     TEXT NOT NULL,
  published_at  TEXT NOT NULL DEFAULT (datetime('now')),
  published_by  TEXT REFERENCES users(id)
);
```

---

### Fix 2.2: Fix created_at to timestamp in Mail Trace Admin Query
**File:** `apps/web/src/routes/admin/trace/+page.server.ts`  
**Change:** All instances of `created_at` in ORDER BY clauses

**Current:**
```typescript
traces = await env.DB.prepare(
  'SELECT * FROM mail_trace WHERE envelope_from LIKE ? OR envelope_to LIKE ? OR subject LIKE ? OR message_id_header LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
).bind(term, term, term, term, pageSize, offset).all<MailTrace>();
```

**Fixed:**
```typescript
traces = await env.DB.prepare(
  'SELECT * FROM mail_trace WHERE envelope_from LIKE ? OR envelope_to LIKE ? OR subject LIKE ? OR message_id_header LIKE ? ORDER BY timestamp DESC LIMIT ? OFFSET ?',
).bind(term, term, term, term, pageSize, offset).all<MailTrace>();
```

**Apply to all three queries in that file (search, direction, all)**

---

## 3. FIX AUDIT FUNCTION TO HANDLE ERRORS

### Fix 3.1: Enhanced audit() Function with Error Handling
**File:** `apps/web/src/lib/server/db.ts`  
**Change:** Replace entire audit() function (lines 17-35)

**Current:**
```typescript
export async function audit(
  db: D1Database,
  event: {
    event_type: string;
    actor_id?: string | null;
    actor_role?: 'standard' | 'manager' | 'system';
    target?: string | null;
    detail?: string | null;
    ip_address?: string | null;
    session_id?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO audit_log (event_id, timestamp, actor_id, actor_role, event_type, target, detail, ip_address, session_id)
     VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    generateId(),
    event.actor_id ?? null,
    event.actor_role ?? 'system',
    event.event_type,
    event.target ?? null,
    event.detail ?? null,
    event.ip_address ?? null,
    event.session_id ?? null,
  ).run();
}
```

**Fixed:**
```typescript
// Define audit event type enum at top of file
type AuditEventType = 
  | 'policy.published'
  | 'policy.signed'
  | 'mailbox.created'
  | 'mailbox.assigned'
  | 'email.moved'
  | 'email.deleted'
  | 'system.error';

export async function audit(
  db: D1Database,
  event: {
    event_type: AuditEventType;
    actor_id?: string | null;
    actor_role?: 'standard' | 'manager' | 'system';
    target?: string | null;
    detail?: string | null;
    ip_address?: string | null;
    session_id?: string | null;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate required fields
    if (!event.event_type?.trim()) {
      return { success: false, error: 'event_type is required' };
    }

    // Use ISO timestamp for better precision
    const now = new Date().toISOString();

    await db.prepare(
      `INSERT INTO audit_log (event_id, timestamp, actor_id, actor_role, event_type, target, detail, ip_address, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      generateId(),
      now,
      event.actor_id ?? null,
      event.actor_role ?? 'system',
      event.event_type,
      event.target ?? null,
      event.detail ?? null,
      event.ip_address ?? null,
      event.session_id ?? null,
    ).run();

    return { success: true };
  } catch (err) {
    const error = err as Error;
    console.error(`[AUDIT_ERROR] Failed to log ${event.event_type}:`, error.message);
    return { success: false, error: error.message };
  }
}
```

---

### Fix 3.2: Update audit() Calls to Handle Result
**File:** `apps/web/src/routes/admin/policy/+page.server.ts`  
**Change:** Lines 34-39

**Current:**
```typescript
    await audit(env.DB, {
      event_type: 'policy.published',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      detail: `Published policy version ${versionLabel}`,
    });

    return { success: `Policy ${versionLabel} published. All users will be prompted to sign.` };
```

**Fixed:**
```typescript
    const auditResult = await audit(env.DB, {
      event_type: 'policy.published',
      actor_id: locals.user.id,
      actor_role: locals.user.role as 'standard' | 'manager',
      target: id,
      detail: `Published policy version ${versionLabel}`,
    });

    if (!auditResult.success) {
      console.error('Audit logging failed:', auditResult.error);
      return { error: 'Failed to log action to audit trail' };
    }

    return { success: `Policy ${versionLabel} published. All users will be prompted to sign.` };
```

---

## 4. FIX POLICY SIGNATURE VALIDATION

### Fix 4.1: Validate Policy Version Before Signing
**File:** `apps/web/src/routes/policy/+page.server.ts`  
**Change:** Lines 29-51

**Current:**
```typescript
export const actions: Actions = {
  default: async ({ locals, platform, request }) => {
    if (!locals.user) throw redirect(302, '/');
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const formData = await request.formData();
    const policyVersionId = formData.get('policy_version_id') as string;
    const accepted = formData.get('accept');

    if (!accepted || !policyVersionId) {
      return { error: 'You must accept the policy to continue' };
    }

    const id = generateId();
    await env.DB.prepare(
      'INSERT INTO ict_policy_signatures (id, user_id, policy_version_id, signed_at) VALUES (?, ?, ?, datetime(\'now\'))',
    ).bind(id, locals.user.id, policyVersionId).run();

    await audit(env.DB, {
      event_type: 'policy.signed',
      actor_id: locals.user.id,
      actor_role: locals.user.role as 'standard' | 'manager',
      detail: `Signed policy version ${policyVersionId}`,
    });

    throw redirect(302, '/mail');
  },
};
```

**Fixed:**
```typescript
export const actions: Actions = {
  default: async ({ locals, platform, request }) => {
    if (!locals.user) throw redirect(302, '/');
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const formData = await request.formData();
    const policyVersionId = formData.get('policy_version_id') as string;
    const accepted = formData.get('accept');

    if (!accepted || !policyVersionId) {
      return { error: 'You must accept the policy to continue' };
    }

    // ✅ Validate policy version exists
    const policyVersion = await env.DB.prepare(
      'SELECT id FROM ict_policy_versions WHERE id = ?'
    ).bind(policyVersionId).first<{ id: string }>();

    if (!policyVersion) {
      return { error: 'Policy version not found or has been deleted' };
    }

    // ✅ Check if already signed (prevent race condition)
    const existing = await env.DB.prepare(
      'SELECT id FROM ict_policy_signatures WHERE user_id = ? AND policy_version_id = ?',
    ).bind(locals.user.id, policyVersionId).first<{ id: string }>();

    if (existing) {
      throw redirect(302, '/mail');
    }

    try {
      const id = generateId();
      await env.DB.prepare(
        'INSERT INTO ict_policy_signatures (id, user_id, policy_version_id, signed_at) VALUES (?, ?, ?, datetime(\'now\'))',
      ).bind(id, locals.user.id, policyVersionId).run();

      const auditResult = await audit(env.DB, {
        event_type: 'policy.signed',
        actor_id: locals.user.id,
        actor_role: locals.user.role as 'standard' | 'manager',
        target: policyVersionId,
        detail: `Signed policy version ${policyVersionId}`,
      });

      if (!auditResult.success) {
        console.error('Audit logging failed on policy signature:', auditResult.error);
        // Continue anyway - user should not be blocked
      }

      throw redirect(302, '/mail');
    } catch (e) {
      if ((e as Error).message?.includes('UNIQUE constraint')) {
        // Already signed - redirect
        throw redirect(302, '/mail');
      }
      return { error: 'Failed to record policy signature' };
    }
  },
};
```

---

## 5. FIX MAILBOX VALIDATION

### Fix 5.1: Validate Mailbox Type and Email Address
**File:** `apps/web/src/routes/admin/mailboxes/+page.server.ts`  
**Change:** Lines 28-42

**Add validation utilities at top of file:**
```typescript
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

const VALID_MAILBOX_TYPES = new Set(['personal', 'shared']);

const MAX_DISPLAY_NAME_LEN = 255;
```

**Current:**
```typescript
  create: async ({ request, platform, locals }) => {
    if (!locals.user) return { error: 'Not authenticated' };
    if (locals.user.role !== 'manager') return { error: 'Only managers can create mailboxes' };

    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const data = await request.formData();
    const address = (data.get('address') as string)?.toLowerCase().trim();
    const displayName = (data.get('display_name') as string)?.trim() || '';
    const type = (data.get('type') as string) || 'shared';

    if (!address) return { error: 'Address is required' };

    const existing = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(address).first();
    if (existing) return { error: 'Mailbox already exists' };
```

**Fixed:**
```typescript
  create: async ({ request, platform, locals }) => {
    if (!locals.user) return { error: 'Not authenticated' };
    if (locals.user.role !== 'manager') return { error: 'Only managers can create mailboxes' };

    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const data = await request.formData();
    const address = (data.get('address') as string)?.toLowerCase().trim();
    const displayName = (data.get('display_name') as string)?.trim() || '';
    const type = (data.get('type') as string) || 'shared';

    // ✅ Validate address
    if (!address) return { error: 'Address is required' };
    if (!isValidEmail(address)) return { error: 'Invalid email address format' };

    // ✅ Validate type
    if (!VALID_MAILBOX_TYPES.has(type)) return { error: 'Invalid mailbox type' };

    // ✅ Validate display name
    if (displayName.length > MAX_DISPLAY_NAME_LEN) {
      return { error: `Display name exceeds ${MAX_DISPLAY_NAME_LEN} characters` };
    }

    const existing = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(address).first();
    if (existing) return { error: 'Mailbox already exists' };
```

---

### Fix 5.2: Validate Permissions Enum in Mailbox Assignment
**File:** `apps/web/src/routes/admin/mailboxes/+page.server.ts`  
**Change:** Lines 44-72

**Add at top of file:**
```typescript
const VALID_PERMISSIONS = new Set(['read', 'send-as', 'full']);
```

**Current:**
```typescript
  assign: async ({ request, platform, locals }) => {
    if (!locals.user) return { error: 'Not authenticated' };
    if (locals.user.role !== 'manager') return { error: 'Only managers can assign mailboxes' };

    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const data = await request.formData();
    const mailboxId = data.get('mailbox_id') as string;
    const userEmail = (data.get('user_email') as string)?.toLowerCase().trim();
    const permissions = (data.get('permissions') as string) || 'read';

    if (!mailboxId || !userEmail) return { error: 'Mailbox and user email required' };

    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(userEmail).first<{ id: string }>();
    if (!user) return { error: 'User not found' };
```

**Fixed:**
```typescript
  assign: async ({ request, platform, locals }) => {
    if (!locals.user) return { error: 'Not authenticated' };
    if (locals.user.role !== 'manager') return { error: 'Only managers can assign mailboxes' };

    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const data = await request.formData();
    const mailboxId = data.get('mailbox_id') as string;
    const userEmail = (data.get('user_email') as string)?.toLowerCase().trim();
    const permissions = (data.get('permissions') as string) || 'read';

    if (!mailboxId || !userEmail) return { error: 'Mailbox and user email required' };

    // ✅ Validate permissions enum
    if (!VALID_PERMISSIONS.has(permissions)) {
      return { error: 'Invalid permissions value' };
    }

    // ✅ Validate email format
    if (!isValidEmail(userEmail)) return { error: 'Invalid email address format' };

    // ✅ Validate mailbox exists
    const mailbox = await env.DB.prepare('SELECT id FROM mailboxes WHERE id = ?').bind(mailboxId).first<{ id: string }>();
    if (!mailbox) return { error: 'Mailbox not found' };

    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(userEmail).first<{ id: string }>();
    if (!user) return { error: `User ${userEmail} not found` };
```

---

## 6. FIX MAIL TRACE SECURITY ISSUES

### Fix 6.1: Escape LIKE Wildcards in Search
**File:** `apps/web/src/routes/admin/trace/+page.server.ts`  
**Change:** Lines 1-26

**Add helper function at top:**
```typescript
function escapeLikeWildcards(str: string): string {
  return str.replace(/[%_]/g, '\\$&');
}
```

**Current:**
```typescript
export const load: PageServerLoad = async ({ platform, url, locals }) => {
  if (!locals.user) throw redirect(302, '/');
  if (locals.user.role !== 'manager') throw error(403, 'Only managers can view mail trace');

  const env = platform?.env;
  if (!env) throw error(500);

  const search = url.searchParams.get('q');
  const direction = url.searchParams.get('direction');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = 100;
  const offset = (page - 1) * pageSize;

  let traces;
  if (search) {
    const term = `%${search}%`;
    traces = await env.DB.prepare(
      'SELECT * FROM mail_trace WHERE envelope_from LIKE ? OR envelope_to LIKE ? OR subject LIKE ? OR message_id_header LIKE ? ORDER BY timestamp DESC LIMIT ? OFFSET ?',
    ).bind(term, term, term, term, pageSize, offset).all<MailTrace>();
  } else if (direction) {
    traces = await env.DB.prepare(
      'SELECT * FROM mail_trace WHERE direction = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?',
    ).bind(direction, pageSize, offset).all<MailTrace>();
  } else {
    traces = await env.DB.prepare(
      'SELECT * FROM mail_trace ORDER BY timestamp DESC LIMIT ? OFFSET ?',
    ).bind(pageSize, offset).all<MailTrace>();
  }

  return {
    traces: traces.results || [],
    search: search || '',
    direction: direction || '',
    page,
  };
};
```

**Fixed:**
```typescript
export const load: PageServerLoad = async ({ platform, url, locals }) => {
  if (!locals.user) throw redirect(302, '/');
  if (locals.user.role !== 'manager') throw error(403, 'Only managers can view mail trace');

  const env = platform?.env;
  if (!env) throw error(500);

  const search = url.searchParams.get('q');
  const direction = url.searchParams.get('direction');
  const rawPage = url.searchParams.get('page');
  
  // ✅ Validate page parameter
  const page = Math.max(1, Math.min(1000000, parseInt(rawPage || '1', 10) || 1));
  const pageSize = 100;
  const offset = (page - 1) * pageSize;

  let traces;
  if (search) {
    // ✅ Validate search length
    const searchTerm = search.trim();
    if (searchTerm.length < 3) {
      return {
        traces: [],
        search: searchTerm,
        direction: direction || '',
        page,
        error: 'Search term must be at least 3 characters',
      };
    }

    // ✅ Escape LIKE wildcards
    const escapedTerm = escapeLikeWildcards(searchTerm);
    const term = `%${escapedTerm}%`;
    
    traces = await env.DB.prepare(
      'SELECT * FROM mail_trace WHERE (envelope_from LIKE ? ESCAPE \'\\' OR envelope_to LIKE ? ESCAPE \'\\' OR subject LIKE ? ESCAPE \'\\' OR message_id_header LIKE ? ESCAPE \'\\\') ORDER BY timestamp DESC LIMIT ? OFFSET ?',
    ).bind(term, term, term, term, pageSize, offset).all<MailTrace>();
  } else if (direction) {
    // ✅ Validate direction enum
    const VALID_DIRECTIONS = new Set(['inbound', 'outbound']);
    if (!VALID_DIRECTIONS.has(direction)) {
      return {
        traces: [],
        search: search || '',
        direction,
        page,
        error: 'Invalid direction parameter',
      };
    }

    traces = await env.DB.prepare(
      'SELECT * FROM mail_trace WHERE direction = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?',
    ).bind(direction, pageSize, offset).all<MailTrace>();
  } else {
    traces = await env.DB.prepare(
      'SELECT * FROM mail_trace ORDER BY timestamp DESC LIMIT ? OFFSET ?',
    ).bind(pageSize, offset).all<MailTrace>();
  }

  return {
    traces: traces.results || [],
    search: search || '',
    direction: direction || '',
    page,
  };
};
```

---

### Fix 6.2: Add Error Handling to logTrace() Function
**File:** `apps/email-worker/src/index.ts`  
**Change:** Lines 231-249

**Current:**
```typescript
async function logTrace(db: D1Database, trace: Record<string, unknown>): Promise<void> {
  await db.prepare(
    `INSERT INTO mail_trace (trace_id, message_id_header, direction, timestamp, envelope_from, envelope_to, header_from, subject, size_bytes, status, status_detail, spf_result, dkim_result, dmarc_result, spam_score, source_ip)
     VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    generateId(),
    (trace.message_id_header as string) ?? null,
    trace.direction as string,
    (trace.envelope_from as string) ?? null,
    (trace.envelope_to as string) ?? null,
    (trace.header_from as string) ?? null,
    (trace.subject as string) ?? null,
    (trace.size_bytes as number) ?? null,
    trace.status as string,
    (trace.status_detail as string) ?? null,
    (trace.spf_result as string) ?? null,
    (trace.dkim_result as string) ?? null,
    (trace.dmarc_result as string) ?? null,
    (trace.spam_score as number) ?? null,
    (trace.source_ip as string) ?? null,
  ).run();
}
```

**Fixed:**
```typescript
type TraceDirection = 'inbound' | 'outbound';
type TraceStatus = 'delivered' | 'bounced' | 'rejected' | 'quarantined' | 'deferred' | 'sent';

async function logTrace(
  db: D1Database,
  trace: {
    message_id_header?: string | null;
    direction: TraceDirection;
    envelope_from?: string | null;
    envelope_to?: string | null;
    header_from?: string | null;
    subject?: string | null;
    size_bytes?: number | null;
    status: TraceStatus;
    status_detail?: string | null;
    spf_result?: string | null;
    dkim_result?: string | null;
    dmarc_result?: string | null;
    spam_score?: number | null;
    source_ip?: string | null;
  },
): Promise<boolean> {
  try {
    // ✅ Validate enum values
    const VALID_DIRECTIONS: Record<TraceDirection, boolean> = { inbound: true, outbound: true };
    const VALID_STATUSES: Record<TraceStatus, boolean> = {
      delivered: true,
      bounced: true,
      rejected: true,
      quarantined: true,
      deferred: true,
      sent: true,
    };

    if (!VALID_DIRECTIONS[trace.direction]) {
      console.error(`[TRACE_ERROR] Invalid direction: ${trace.direction}`);
      return false;
    }

    if (!VALID_STATUSES[trace.status]) {
      console.error(`[TRACE_ERROR] Invalid status: ${trace.status}`);
      return false;
    }

    // ✅ Use ISO timestamp instead of datetime('now')
    const now = new Date().toISOString();

    await db.prepare(
      `INSERT INTO mail_trace (trace_id, message_id_header, direction, timestamp, envelope_from, envelope_to, header_from, subject, size_bytes, status, status_detail, spf_result, dkim_result, dmarc_result, spam_score, source_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId(),
      trace.message_id_header ?? null,
      trace.direction,
      now,
      trace.envelope_from ?? null,
      trace.envelope_to ?? null,
      trace.header_from ?? null,
      trace.subject ?? null,
      trace.size_bytes ?? null,
      trace.status,
      trace.status_detail ?? null,
      trace.spf_result ?? null,
      trace.dkim_result ?? null,
      trace.dmarc_result ?? null,
      trace.spam_score ?? null,
      trace.source_ip ?? null,
    ).run();

    return true;
  } catch (err) {
    const error = err as Error;
    console.error(`[TRACE_ERROR] Failed to log mail trace:`, {
      direction: trace.direction,
      status: trace.status,
      from: trace.envelope_from,
      to: trace.envelope_to,
      error: error.message,
    });
    return false;
  }
}
```

---

## 7. APPLY SAME FIXES TO db.ts traceEmail() FUNCTION

**File:** `apps/web/src/lib/server/db.ts`  
**Change:** Lines 37-66 (traceEmail function)

Replace with a call to the improved logTrace or add same validation there.

---

## DEPLOYMENT CHECKLIST

Before deploying any changes:

- [ ] All role checks added to admin endpoints
- [ ] Schema migration run (html_body column added)
- [ ] Audit function updated with error handling
- [ ] Policy validation enhanced
- [ ] Mailbox validation added
- [ ] Trace search LIKE injection fixed
- [ ] logTrace error handling added
- [ ] All TypeScript compiles without errors
- [ ] No `any` types used
- [ ] Test each critical path:
  - [ ] Policy publish as manager
  - [ ] Policy publish as standard user (should fail)
  - [ ] Sign policy
  - [ ] Create mailbox
  - [ ] Assign user to mailbox
  - [ ] Search trace
  - [ ] View trace admin page

---


# cmail Codebase Security & Robustness Audit

**Date:** April 2026  
**Scope:** Policy, Audit Logging, Mailbox Management, Mail Tracing  
**Status:** Critical issues identified - review before production

---

## EXECUTIVE SUMMARY

| Category | Status | Critical | Major | Minor |
|----------|--------|----------|-------|-------|
| Policy Code | ⚠️ At Risk | 3 | 2 | 1 |
| Audit Log | ⚠️ At Risk | 1 | 1 | 2 |
| Mailbox Management | 🔴 Critical | 3 | 3 | 2 |
| Mail Trace | ⚠️ At Risk | 1 | 2 | 3 |
| **Overall** | **🔴 CRITICAL** | **8** | **8** | **8** |

**Recommendation:** Do not deploy to production until critical issues are resolved.

---

## 1. POLICY CODE AUDIT

### Files Analyzed
- [apps/web/src/routes/admin/policy/+page.server.ts](apps/web/src/routes/admin/policy/+page.server.ts)
- [apps/web/src/routes/policy/+page.server.ts](apps/web/src/routes/policy/+page.server.ts)

### ✅ What Works Well
1. **Basic policy versioning** - Each policy is assigned a unique version ID
2. **Signature tracking** - Policy signatures are stored separately with timestamps
3. **Simple audit trail** - Policy events are logged to audit_log

### 🔴 CRITICAL ISSUES

#### 1.1 **No Permission Validation on Policy Publishing**
**File:** [apps/web/src/routes/admin/policy/+page.server.ts](apps/web/src/routes/admin/policy/+page.server.ts#L17-L30)  
**Severity:** CRITICAL  
**Issue:** The `publish` action accepts a `versionLabel` and `htmlBody` from any authenticated user without verifying they are a manager/admin.

```typescript
// Line 17-30: Missing role check
export const actions: Actions = {
  publish: async ({ request, platform, locals }) => {
    // ❌ NO CHECK: if (locals.user?.role !== 'manager') return error(403)
    const data = await request.formData();
    const versionLabel = ...
```

**Impact:** 
- Any authenticated user (even 'standard' role) can publish policies that affect all users
- Violates principle of least privilege
- No audit trail showing who published (logs `locals.user!.id` unsafely)

**Fix:**
```typescript
export const actions: Actions = {
  publish: async ({ request, platform, locals }) => {
    if (!locals.user) throw error(401);
    if (locals.user.role !== 'manager') throw error(403, 'Only managers can publish policies');
    
    // ... rest of code
  },
};
```

---

#### 1.2 **Concurrent Policy Version Race Condition**
**File:** [apps/web/src/routes/admin/policy/+page.server.ts](apps/web/src/routes/admin/policy/+page.server.ts#L17-L30)  
**Severity:** CRITICAL  
**Issue:** No transaction wrapping or locking when publishing a policy. Two admins could:
1. Admin A and Admin B both request a policy publish simultaneously
2. Both create separate version IDs
3. Both insert into DB at same time
4. Version numbering becomes undefined

**Current Code:**
```typescript
const id = generateId();
await env.DB.prepare(
  'INSERT INTO ict_policy_versions (...) VALUES (?, ?, ?, datetime(\'now\'))',
).bind(id, versionLabel, htmlBody).run();

await audit(env.DB, ...); // ❌ Audit happens AFTER insert, not atomic
```

**Impact:**
- Policy versions may be inserted out of order
- Audit log doesn't match published state
- No ordering guarantee for `published_at`

**Fix:**
```typescript
// Use a single transaction
try {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO ict_policy_versions (id, version_label, html_body, published_at) VALUES (?, ?, ?, datetime(\'now\'))'
    ).bind(id, versionLabel, htmlBody),
    env.DB.prepare(
      `INSERT INTO audit_log (event_id, timestamp, actor_id, actor_role, event_type, target, detail)
       VALUES (?, datetime('now'), ?, ?, 'policy.published', ?, ?)`
    ).bind(generateId(), locals.user.id, locals.user.role, id, `Published ${versionLabel}`)
  ]);
} catch (e) {
  return { error: 'Failed to publish policy' };
}
```

---

#### 1.3 **Policy Signature Insertion Without Version Validation**
**File:** [apps/web/src/routes/policy/+page.server.ts](apps/web/src/routes/policy/+page.server.ts#L29-L51)  
**Severity:** CRITICAL  
**Issue:** User signs a policy version ID they provide via form data. No validation that:
- The policy_version_id exists
- The policy_version_id was actually published
- The user hasn't already signed it (checked BEFORE load, but what if policy is deleted between load and submission?)

**Current Code (Lines 29-51):**
```typescript
// Line 29-37: TOCTOU vulnerability - signature can be accepted AFTER version deleted
const existing = await env.DB.prepare(
  'SELECT id FROM ict_policy_signatures WHERE user_id = ? AND policy_version_id = ?',
).bind(locals.user.id, latestPolicy.id).first<{ id: string }>();

if (existing) throw redirect(302, '/mail');

// ... later in action handler:
const formData = await request.formData();
const policyVersionId = formData.get('policy_version_id') as string;
// ❌ NO VALIDATION that policyVersionId exists or is still published!
await env.DB.prepare(
  'INSERT INTO ict_policy_signatures (id, user_id, policy_version_id, signed_at) VALUES (?, ?, ?, datetime(\'now\'))',
).bind(id, locals.user.id, policyVersionId).run(); // Will fail silently or with FK constraint error
```

**Impact:**
- Orphaned signature records if policy version is deleted
- Foreign key constraint violation causes 500 error
- No user feedback on signature creation failure
- Policy can be "signed" to non-existent version IDs

**Fix:**
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

    // ✅ VALIDATE version exists
    const policyVersion = await env.DB.prepare(
      'SELECT id FROM ict_policy_versions WHERE id = ?'
    ).bind(policyVersionId).first<{ id: string }>();
    
    if (!policyVersion) {
      return { error: 'Policy version not found' };
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

      await audit(env.DB, {
        event_type: 'policy.signed',
        actor_id: locals.user.id,
        actor_role: locals.user.role as 'standard' | 'manager',
        detail: `Signed policy version ${policyVersionId}`,
      });

      throw redirect(302, '/mail');
    } catch (e) {
      if ((e as Error).message.includes('UNIQUE constraint')) {
        throw redirect(302, '/mail');
      }
      return { error: 'Failed to record signature' };
    }
  },
};
```

---

### ⚠️ MAJOR ISSUES

#### 1.4 **Unsafe User ID Assertion in Publish Action**
**File:** [apps/web/src/routes/admin/policy/+page.server.ts](apps/web/src/routes/admin/policy/+page.server.ts#L35)  
**Severity:** MAJOR  
**Issue:** Line 35 uses `locals.user!.id` with non-null assertion without checking if user exists first

```typescript
await audit(env.DB, {
  event_type: 'policy.published',
  actor_id: locals.user!.id,  // ❌ Non-null assertion - if locals.user is null, runtime error
  actor_role: 'manager',
  detail: `Published policy version ${versionLabel}`,
});
```

**Impact:**
- Runtime error if authentication check was bypassed
- Breaks audit trail on failure

**Fix:**
```typescript
if (!locals.user) return { error: 'Not authenticated' };

await audit(env.DB, {
  event_type: 'policy.published',
  actor_id: locals.user.id,  // ✅ Now safe
  actor_role: locals.user.role as 'standard' | 'manager',
  detail: `Published policy version ${versionLabel}`,
});
```

---

#### 1.5 **No Input Length/Type Validation**
**File:** [apps/web/src/routes/admin/policy/+page.server.ts](apps/web/src/routes/admin/policy/+page.server.ts#L21-27)  
**Severity:** MAJOR  
**Issue:** Policy label and HTML body accept any string length without validation

```typescript
const versionLabel = (data.get('version_label') as string)?.trim();
const htmlBody = (data.get('html_body') as string)?.trim();

if (!versionLabel || !htmlBody) return { error: 'Version label and body are required' };
// ❌ No max length checks
// ❌ No HTML sanitization
// ❌ No script injection protection
```

**Impact:**
- Unbounded HTML can fill database
- Reflected in UI without sanitization → XSS risk
- No limits on policy label (could be terabytes in theory)

**Fix:**
```typescript
const MAX_LABEL_LEN = 100;
const MAX_HTML_LEN = 50000; // 50KB

const versionLabel = (data.get('version_label') as string)?.trim();
const htmlBody = (data.get('html_body') as string)?.trim();

if (!versionLabel || !htmlBody) return { error: 'Version label and body are required' };

if (versionLabel.length > MAX_LABEL_LEN) {
  return { error: `Version label exceeds ${MAX_LABEL_LEN} characters` };
}
if (htmlBody.length > MAX_HTML_LEN) {
  return { error: `Policy body exceeds ${MAX_HTML_LEN} characters` };
}

// Add DOMPurify or similar on frontend/backend for XSS protection
```

---

### 🟡 MINOR ISSUES

#### 1.6 **Missing HTML Column in Schema**
**File:** [packages/shared/src/schema.sql](packages/shared/src/schema.sql) - `ict_policy_versions` table  
**Severity:** MINOR  
**Issue:** Schema defines `body_text TEXT NOT NULL` but code inserts into `html_body`

```sql
CREATE TABLE IF NOT EXISTS ict_policy_versions (
  id            TEXT PRIMARY KEY,
  version_label TEXT NOT NULL,
  body_text     TEXT NOT NULL,        -- ❌ Schema says body_text
  published_at  TEXT NOT NULL DEFAULT (datetime('now')),
  published_by  TEXT REFERENCES users(id)
);
```

But code does:
```typescript
'INSERT INTO ict_policy_versions (id, version_label, html_body, published_at) VALUES (...)'
```

**Impact:**
- Code will fail with "no such column" error
- Must update schema to: `html_body TEXT NOT NULL`

**Fix:** Update schema and migrate.

---

## 2. AUDIT LOG CODE AUDIT

### Files Analyzed
- [apps/web/src/lib/server/db.ts](apps/web/src/lib/server/db.ts) - `audit()` function (lines 17-35)

### ✅ What Works Well
1. **Append-only pattern** - Audit log table is append-only, hard to modify
2. **Event type enumeration** - Defined event types help with categorization
3. **Flexible context** - Fields for actor_id, target, detail provide good audit trail

### 🔴 CRITICAL ISSUES

#### 2.1 **No Error Handling on Audit Insert Failure**
**File:** [apps/web/src/lib/server/db.ts](apps/web/src/lib/server/db.ts#L17-35)  
**Severity:** CRITICAL  
**Issue:** The `audit()` function silently swallows all errors

```typescript
export async function audit(
  db: D1Database,
  event: { event_type: string; ... },
): Promise<void> {
  await db.prepare(
    `INSERT INTO audit_log (...) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`
  ).bind(...).run();
  // ❌ No error handling - if INSERT fails, no indication
  // ❌ Calling code doesn't know audit failed
  // ❌ Can fail silently and lose audit trail
}
```

**Impact:**
- Audit trail gaps go undetected
- Critical operations may fail to log
- Compliance/forensics issues
- Policy violations go unaudited

**Example Failure Scenario:**
```
1. Database fills up → INSERT fails
2. audit() function returns void with no error
3. Policy publish happens (from line 35 of policy page)
4. User signs policy (happens but not logged)
5. Audit trail is incomplete
6. No way to know which operations weren't logged
```

**Fix:**
```typescript
export async function audit(
  db: D1Database,
  event: { ... },
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await db.prepare(
      `INSERT INTO audit_log (event_id, timestamp, actor_id, actor_role, event_type, target, detail, ip_address, session_id)
       VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`
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

    return { success: true };
  } catch (err) {
    const error = err as Error;
    console.error(`[AUDIT_ERROR] Failed to log ${event.event_type}:`, error.message);
    // ⚠️ Consider if this should throw or return error
    // - If throw: stops operation (blocks user action)
    // - If return: allows operation to continue (accepts incomplete audit)
    // Recommendation: Return error for non-critical audit events,
    // throw for critical security events
    return { success: false, error: error.message };
  }
}
```

**Then update all audit() calls:**
```typescript
const auditResult = await audit(env.DB, {
  event_type: 'policy.published',
  actor_id: locals.user.id,
  actor_role: locals.user.role,
  detail: `Published policy version ${versionLabel}`,
});

if (!auditResult.success) {
  console.error('Audit logging failed:', auditResult.error);
  return { error: 'Failed to log action to audit trail' };
}
```

---

### ⚠️ MAJOR ISSUES

#### 2.2 **No Validation of Event Type**
**File:** [apps/web/src/lib/server/db.ts](apps/web/src/lib/server/db.ts#L17)  
**Severity:** MAJOR  
**Issue:** Any string is accepted as `event_type` - no validation against known types

```typescript
export async function audit(
  db: D1Database,
  event: {
    event_type: string,  // ❌ Any string accepted
    actor_id?: string | null,
    actor_role?: 'standard' | 'manager' | 'system',
    target?: string | null,
    detail?: string | null,
    ...
  },
): Promise<void> { ... }
```

**Impact:**
- Typos create new undocumented event types
- Queries for specific events become fragile
- Audit report generation fails silently on typos
- No way to enforce event taxonomy

**Fix:**
```typescript
type AuditEventType = 
  | 'policy.published'
  | 'policy.signed'
  | 'mailbox.created'
  | 'mailbox.assigned'
  | 'mailbox.deleted'
  | 'email.moved'
  | 'email.deleted'
  | 'user.created'
  | 'user.deleted'
  | 'system.error';

export async function audit(
  db: D1Database,
  event: {
    event_type: AuditEventType,  // ✅ Enumerated type
    actor_id?: string | null;
    actor_role?: 'standard' | 'manager' | 'system';
    target?: string | null;
    detail?: string | null;
    ip_address?: string | null;
    session_id?: string | null;
  },
): Promise<{ success: boolean; error?: string }> {
  // ... implementation with error handling
}
```

---

#### 2.3 **No Null/Empty String Validation**
**File:** [apps/web/src/lib/server/db.ts](apps/web/src/lib/server/db.ts#L17-35)  
**Severity:** MAJOR  
**Issue:** Required fields can be empty strings or null, yielding useless audit records

```typescript
event: {
  event_type: string,  // Could be empty
  actor_id?: string | null,  // Could be null for all events
  actor_role?: 'standard' | 'manager' | 'system',
  target?: string | null,  // Could be null
  detail?: string | null,  // Could be null
}
```

**Example Problem:**
```
Audit log entry: { event_type: '', actor_id: null, detail: null }
Impossible to audit this event or attribute blame
```

**Fix:**
```typescript
export async function audit(
  db: D1Database,
  event: {
    event_type: AuditEventType;  // Required, non-empty
    actor_id?: string | null;
    actor_role?: 'standard' | 'manager' | 'system';
    target?: string | null;
    detail?: string | null;
    ip_address?: string | null;
    session_id?: string | null;
  },
): Promise<{ success: boolean; error?: string }> {
  // Validate
  if (!event.event_type?.trim()) {
    return { success: false, error: 'event_type is required' };
  }

  if (!event.actor_id && !event.actor_role) {
    return { success: false, error: 'actor_id or actor_role must be provided' };
  }

  // ... rest of implementation
}
```

---

### 🟡 MINOR ISSUES

#### 2.4 **No Timestamp Precision for Fast Operations**
**File:** [apps/web/src/lib/server/db.ts](apps/web/src/lib/server/db.ts#L26)  
**Severity:** MINOR  
**Issue:** Using `datetime('now')` in SQLite provides second precision. Multiple operations in same second lose ordering.

```typescript
`INSERT INTO audit_log (...timestamp...) VALUES (?, datetime('now'), ...)`
```

**Impact:**
- Two audited operations <1 second apart may be out of order in log
- Forensic analysis is harder (which happened first?)
- Violates causality in logs

**Fix:**
```typescript
// Use JavaScript timestamp with millisecond precision, store as ISO string
const now = new Date().toISOString();

await db.prepare(
  `INSERT INTO audit_log (..., timestamp, ...) VALUES (..., ?, ...)`
).bind(..., now, ...).run();
```

---

#### 2.5 **Audit Function Signature Inconsistency**
**File:** [apps/web/src/lib/server/db.ts](apps/web/src/lib/server/db.ts#L17) vs actual usage  
**Severity:** MINOR  
**Issue:** Return type is `Promise<void>` but callers don't handle errors. Should be `Promise<{ success: boolean; error?: string }>`

---

## 3. MAILBOX CODE AUDIT

### Files Analyzed
- [apps/web/src/routes/admin/mailboxes/+page.server.ts](apps/web/src/routes/admin/mailboxes/+page.server.ts)
- [apps/web/src/routes/mail/compose/+page.server.ts](apps/web/src/routes/mail/compose/+page.server.ts#L35-80) - mailbox permission checks
- [apps/web/src/routes/api/messages/[id]/+server.ts](apps/web/src/routes/api/messages/[id]/+server.ts) - deletion with cascades

### ✅ What Works Well
1. **Permission checks on compose** - Verifies user can send from specific mailbox
2. **Mailbox uniqueness constraint** - Address uniqueness enforced at DB level
3. **Cascade delete on DB** - When mailbox deleted, messages cascade
4. **Basic access control** - Checks mailbox_assignments table before operations

### 🔴 CRITICAL ISSUES

#### 3.1 **No Permission Check on Mailbox Creation**
**File:** [apps/web/src/routes/admin/mailboxes/+page.server.ts](apps/web/src/routes/admin/mailboxes/+page.server.ts#L23-43)  
**Severity:** CRITICAL  
**Issue:** `create` action accepts requests from any authenticated user without verifying they are a manager

```typescript
export const actions: Actions = {
  create: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };
    // ❌ NO CHECK: if (locals.user?.role !== 'manager') return error(403)

    const data = await request.formData();
    const address = (data.get('address') as string)?.toLowerCase().trim();
    ...
    const id = generateId();
    await env.DB.prepare(
      'INSERT INTO mailboxes (id, address, display_name, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, \'active\', datetime(\'now\'), datetime(\'now\'))',
    ).bind(id, address, displayName, type).run();
```

**Impact:**
- Any user can create arbitrary mailboxes (shared inboxes, phishing mailboxes, etc.)
- Mailbox proliferation and resource exhaustion
- Compliance violations (no audit trail of who created what)

**Fix:**
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

  // ... rest of code
}
```

---

#### 3.2 **No Validation of Mailbox Type and Email Address**
**File:** [apps/web/src/routes/admin/mailboxes/+page.server.ts](apps/web/src/routes/admin/mailboxes/+page.server.ts#L30-36)  
**Severity:** CRITICAL  
**Issue:** Mailbox address and type are not validated

```typescript
const address = (data.get('address') as string)?.toLowerCase().trim();
const displayName = (data.get('display_name') as string)?.trim() || '';
const type = (data.get('type') as string) || 'shared';
// ❌ No validation:
// - address is not checked if it's a valid email format
// - address could be "../../etc/passwd" or SQL injection patterns (though parameterized queries help)
// - type could be "admin", "system", or any value (no enum check)

if (!address) return { error: 'Address is required' };

const existing = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(address).first();
if (existing) return { error: 'Mailbox already exists' };

const id = generateId();
await env.DB.prepare(
  'INSERT INTO mailboxes (id, address, display_name, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, \'active\', datetime(\'now\'), datetime(\'now\'))',
).bind(id, address, displayName, type).run();
```

**Impact:**
- Invalid email addresses stored in database
- Inbound email worker tries to match against invalid addresses (never matches)
- Orphaned mailboxes that can't receive mail
- Type field could contain unexpected values

**Example Attack:**
```
POST /admin/mailboxes
address=test@example.com'; DROP TABLE users; --
type=shared

This won't work due to parameterized queries, but shows the intent.
```

**Fix:**
```typescript
import { isValidEmail } from '$lib/validation';

const VALID_TYPES = new Set(['personal', 'shared']);

const address = (data.get('address') as string)?.toLowerCase().trim();
const displayName = (data.get('display_name') as string)?.trim() || '';
const type = (data.get('type') as string) || 'shared';

if (!address) return { error: 'Address is required' };
if (!isValidEmail(address)) return { error: 'Invalid email address format' };
if (!VALID_TYPES.has(type)) return { error: 'Invalid mailbox type' };
if (displayName.length > 255) return { error: 'Display name too long' };

const existing = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(address).first();
if (existing) return { error: 'Mailbox already exists' };

const id = generateId();
await env.DB.prepare(
  'INSERT INTO mailboxes (id, address, display_name, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, \'active\', datetime(\'now\'), datetime(\'now\'))',
).bind(id, address, displayName, type).run();

await audit(env.DB, {
  event_type: 'mailbox.created',
  actor_id: locals.user.id,
  actor_role: locals.user.role as 'standard' | 'manager',
  target: id,
  detail: `Created ${type} mailbox ${address}`,
});

return { success: `Mailbox ${address} created` };
```

---

#### 3.3 **No Permission Check on Mailbox Assignment**
**File:** [apps/web/src/routes/admin/mailboxes/+page.server.ts](apps/web/src/routes/admin/mailboxes/+page.server.ts#L44-72)  
**Severity:** CRITICAL  
**Issue:** `assign` action has no authorization check

```typescript
assign: async ({ request, platform, locals }) => {
  const env = platform?.env;
  if (!env) return { error: 'Platform not available' };
  // ❌ NO CHECK: if (locals.user?.role !== 'manager') return error(403)

  const data = await request.formData();
  const mailboxId = data.get('mailbox_id') as string;
  const userEmail = (data.get('user_email') as string)?.toLowerCase().trim();
  const permissions = (data.get('permissions') as string) || 'read';

  if (!mailboxId || !userEmail) return { error: 'Mailbox and user email required' };

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(userEmail).first<{ id: string }>();
  if (!user) return { error: 'User not found' };

  // ✓ Good: Prevents duplicate assignments
  const existing = await env.DB.prepare(
    'SELECT id FROM mailbox_assignments WHERE mailbox_id = ? AND user_id = ?',
  ).bind(mailboxId, user.id).first();
  
  if (existing) {
    await env.DB.prepare(
      'UPDATE mailbox_assignments SET permissions = ? WHERE mailbox_id = ? AND user_id = ?',
    ).bind(permissions, mailboxId, user.id).run();
    return { success: 'Assignment updated' };
  }

  // ❌ NO VALIDATION: permissions could be anything
  const id = generateId();
  await env.DB.prepare(
    'INSERT INTO mailbox_assignments (id, mailbox_id, user_id, permissions, assigned_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
  ).bind(id, mailboxId, user.id, permissions).run();

  await audit(env.DB, {...});
  return { success: `User assigned to mailbox` };
}
```

**Impact:**
- Any user can assign other users to mailboxes
- User can escalate their own permissions to 'full' or 'send-as'
- User can revoke access for others
- Compliance/audit trail broken (shows logs but audit failed)

**Fix:**
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
  const VALID_PERMISSIONS = new Set(['read', 'send-as', 'full']);
  if (!VALID_PERMISSIONS.has(permissions)) {
    return { error: 'Invalid permissions value' };
  }

  // ✅ Validate mailbox exists
  const mailbox = await env.DB.prepare('SELECT id FROM mailboxes WHERE id = ?').bind(mailboxId).first<{ id: string }>();
  if (!mailbox) return { error: 'Mailbox not found' };

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(userEmail).first<{ id: string }>();
  if (!user) return { error: 'User not found' };

  const existing = await env.DB.prepare(
    'SELECT id FROM mailbox_assignments WHERE mailbox_id = ? AND user_id = ?',
  ).bind(mailboxId, user.id).first();

  try {
    if (existing) {
      await env.DB.prepare(
        'UPDATE mailbox_assignments SET permissions = ? WHERE mailbox_id = ? AND user_id = ?',
      ).bind(permissions, mailboxId, user.id).run();
    } else {
      const id = generateId();
      await env.DB.prepare(
        'INSERT INTO mailbox_assignments (id, mailbox_id, user_id, permissions, assigned_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
      ).bind(id, mailboxId, user.id, permissions).run();
    }

    const auditResult = await audit(env.DB, {
      event_type: 'mailbox.assigned',
      actor_id: locals.user.id,
      actor_role: locals.user.role as 'standard' | 'manager',
      target: mailboxId,
      detail: `Assigned ${userEmail} to mailbox ${mailboxId} with ${permissions} permissions`,
    });

    if (!auditResult.success) {
      return { error: 'Assignment recorded but audit logging failed' };
    }

    return { success: `User assigned to mailbox` };
  } catch (err) {
    return { error: `Failed to assign user: ${(err as Error).message}` };
  }
}
```

---

### ⚠️ MAJOR ISSUES

#### 3.4 **Race Condition in Mailbox Assignment Check**
**File:** [apps/web/src/routes/admin/mailboxes/+page.server.ts](apps/web/src/routes/admin/mailboxes/+page.server.ts#L62-73)  
**Severity:** MAJOR  
**Issue:** Check-then-act vulnerability (TOCTOU)

```typescript
const existing = await env.DB.prepare(
  'SELECT id FROM mailbox_assignments WHERE mailbox_id = ? AND user_id = ?',
).bind(mailboxId, user.id).first();  // <- Check

if (existing) {
  await env.DB.prepare(
    'UPDATE mailbox_assignments SET permissions = ? WHERE mailbox_id = ? AND user_id = ?',  // <- Act
  ).bind(permissions, mailboxId, user.id).run();
  return { success: 'Assignment updated' };
}

const id = generateId();
await env.DB.prepare(
  'INSERT INTO mailbox_assignments (id, mailbox_id, user_id, permissions, assigned_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
).bind(id, mailboxId, user.id, permissions).run();  // <- Act 2
```

**Race Condition Scenario:**
1. Manager A checks: assignment doesn't exist
2. Manager B checks: assignment doesn't exist (between A's check and insert)
3. Manager A inserts: success
4. Manager B inserts: UNIQUE constraint violation (PK is user_id, mailbox_id)
5. Manager B gets 500 error

**Impact:**
- Race condition between multiple admin operations
- Constraint violation crashes request
- No user-friendly error message
- Incomplete audit trail

**Fix:**
```typescript
// Use INSERT OR REPLACE to handle race condition atomically
try {
  const id = generateId();
  await env.DB.prepare(
    'INSERT OR REPLACE INTO mailbox_assignments (user_id, mailbox_id, permissions, assigned_at) VALUES (?, ?, ?, datetime(\'now\'))',
  ).bind(user.id, mailboxId, permissions).run();

  // Audit will capture it either way
  const auditResult = await audit(env.DB, { ... });
  return { success: `User assigned to mailbox` };
} catch (err) {
  return { error: `Failed to assign user: ${(err as Error).message}` };
}
```

---

#### 3.5 **Orphaned Attachments on Message Deletion**
**File:** [apps/web/src/routes/api/messages/[id]/+server.ts](apps/web/src/routes/api/messages/[id]/+server.ts#L60-80)  
**Severity:** MAJOR  
**Issue:** When a message is permanently deleted from trash, R2 storage cleanup is attempted, but:

1. If R2 delete fails, no retry/alert
2. If query for attachments fails, code continues
3. No transaction - DB delete succeeds but R2 delete fails, orphans storage

```typescript
if (msg.folder === 'trash') {
  // Permanent delete
  if (msg.body_r2_key) {
    await env.STORAGE.delete(msg.body_r2_key);  // ❌ No error handling
  }
  // Delete attachments from R2
  const attachments = await env.DB.prepare(
    'SELECT r2_key FROM attachments WHERE message_id = ?',
  ).bind(msg.id).all<{ r2_key: string }>();
  
  for (const att of attachments.results || []) {
    await env.STORAGE.delete(att.r2_key);  // ❌ No error handling or retry
  }
  
  await env.DB.prepare('DELETE FROM attachments WHERE message_id = ?').bind(msg.id).run();  // ✓ DB delete succeeds
  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(msg.id).run();  // ✓ DB delete succeeds
  // ❌ But if R2 deletes fail, orphaned storage remains
}
```

**Impact:**
- Storage cost accumulates for orphaned files
- No cleanup mechanism
- Impossible to audit what was deleted

**Fix:**
```typescript
if (msg.folder === 'trash') {
  try {
    // Collect all R2 keys
    const keysToDelete: string[] = [];
    
    if (msg.body_r2_key) {
      keysToDelete.push(msg.body_r2_key);
    }

    const attachments = await env.DB.prepare(
      'SELECT r2_key FROM attachments WHERE message_id = ?',
    ).bind(msg.id).all<{ r2_key: string }>();

    if (attachments.results) {
      keysToDelete.push(...attachments.results.map(a => a.r2_key));
    }

    // Delete from R2
    const r2Errors: string[] = [];
    for (const key of keysToDelete) {
      try {
        await env.STORAGE.delete(key);
      } catch (err) {
        r2Errors.push(`Failed to delete ${key}: ${(err as Error).message}`);
      }
    }

    // If R2 deletions failed, alert but continue (or optionally fail?)
    if (r2Errors.length > 0) {
      console.warn('[STORAGE_DELETE_ERROR] Could not delete R2 objects:', r2Errors);
      // Consider: should this fail the whole operation?
      // Or accept partial cleanup?
    }

    // Delete from DB
    await env.DB.prepare('DELETE FROM attachments WHERE message_id = ?').bind(msg.id).run();
    await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(msg.id).run();

    return json({ ok: true, r2_errors: r2Errors.length > 0 ? r2Errors : undefined });
  } catch (err) {
    const error = err as Error;
    return json({ ok: false, error: error.message }, { status: 500 });
  }
}
```

---

#### 3.6 **No Permission Check on Message Deletion**
**File:** [apps/web/src/routes/api/messages/[id]/+server.ts](apps/web/src/routes/api/messages/[id]/+server.ts#L55-60)  
**Severity:** MAJOR  
**Issue:** While the code does check mailbox assignment, there's no audit log for deletions

```typescript
export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
  if (!locals.user) throw error(401);
  const env = platform?.env;
  if (!env) throw error(500);

  const msg = await env.DB.prepare(
    `SELECT m.id, m.folder, m.body_r2_key FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     WHERE m.id = ? AND ma.user_id = ?`,
  ).bind(params.id, locals.user.id).first<{ id: string; folder: string; body_r2_key: string }>();

  if (!msg) throw error(404);

  // ✓ Permission check is good
  // ❌ No audit log for deletion
  // ❌ No soft delete before hard delete
```

**Impact:**
- Compliance violation: no audit trail of deletions
- Impossible to know who deleted what and when
- Violates data protection regulations

**Fix:**
```typescript
export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
  if (!locals.user) throw error(401);
  const env = platform?.env;
  if (!env) throw error(500);

  const msg = await env.DB.prepare(
    `SELECT m.id, m.folder, m.body_r2_key, m.mailbox_id FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     WHERE m.id = ? AND ma.user_id = ?`,
  ).bind(params.id, locals.user.id).first<{ id: string; folder: string; body_r2_key: string; mailbox_id: string }>();

  if (!msg) throw error(404);

  if (msg.folder === 'trash') {
    // Permanent delete - audit it
    try {
      // ... storage cleanup code from previous section ...
      
      await audit(env.DB, {
        event_type: 'email.deleted',
        actor_id: locals.user.id,
        actor_role: locals.user.role as 'standard' | 'manager',
        target: msg.id,
        detail: `Permanently deleted message ${msg.id} from mailbox ${msg.mailbox_id}`,
      });

      return json({ ok: true });
    } catch (err) {
      // ... error handling ...
    }
  } else {
    // Move to trash
    await env.DB.prepare('UPDATE messages SET folder = \'trash\' WHERE id = ?').bind(msg.id).run();
    
    // No need to audit soft delete to trash (already logged by PATCH action)
    return json({ ok: true });
  }
};
```

---

### 🟡 MINOR ISSUES

#### 3.7 **Email Address Not Validated in Mailbox Assignment**
**File:** [apps/web/src/routes/admin/mailboxes/+page.server.ts](apps/web/src/routes/admin/mailboxes/+page.server.ts#L49)  
**Severity:** MINOR  
**Issue:** User email is looked up but not validated before use

```typescript
const userEmail = (data.get('user_email') as string)?.toLowerCase().trim();

if (!mailboxId || !userEmail) return { error: 'Mailbox and user email required' };

const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(userEmail).first<{ id: string }>();
if (!user) return { error: 'User not found' };
```

**Impact:**
- Typo in email (e.g., "john.smith@company.com" vs "jon.smith@company.com") won't be caught
- User silently not assigned
- No feedback on invalid email format

**Fix:**
```typescript
import { isValidEmail } from '$lib/validation';

const userEmail = (data.get('user_email') as string)?.toLowerCase().trim();

if (!mailboxId || !userEmail) return { error: 'Mailbox and user email required' };
if (!isValidEmail(userEmail)) return { error: 'Invalid email address format' };

const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(userEmail).first<{ id: string }>();
if (!user) return { error: `User ${userEmail} not found` };
```

---

#### 3.8 **Compose Route: Missing Null Checks on Signature Query**
**File:** [apps/web/src/routes/mail/compose/+page.server.ts](apps/web/src/routes/mail/compose/+page.server.ts#L33-35)  
**Severity:** MINOR  
**Issue:** Signature template query result not validated

```typescript
const signature = await env.DB.prepare(
  'SELECT html_body, plain_text_body FROM signature_templates WHERE applies_to = \'*\' LIMIT 1',
).first<{ html_body: string; plain_text_body: string }>();

return {
  ...
  signature: signature?.html_body || '',  // ✓ Safe fallback
};
```

**Impact:**
- Minor: safely handled with fallback
- But better to explicitly check

---

## 4. MAIL TRACE CODE AUDIT

### Files Analyzed
- [apps/email-worker/src/index.ts](apps/email-worker/src/index.ts) - `logTrace()` function (lines 231-249)
- [apps/web/src/routes/admin/trace/+page.server.ts](apps/web/src/routes/admin/trace/+page.server.ts)

### ✅ What Works Well
1. **Append-only trace log** - Mail trace table is immutable
2. **Comprehensive logging** - Captures SPF/DKIM/DMARC results
3. **Pagination in admin** - Limits result set to 100 records per page
4. **Search by multiple fields** - Supports searching on from, to, subject, etc.

### 🔴 CRITICAL ISSUES

#### 4.1 **SQL Injection via LIKE Wildcards**
**File:** [apps/web/src/routes/admin/trace/+page.server.ts](apps/web/src/routes/admin/trace/+page.server.ts#L13-18)  
**Severity:** CRITICAL  
**Issue:** While using parameterized queries (good), the search term is not escaped for LIKE wildcards

```typescript
let traces;
if (search) {
  const term = `%${search}%`;  // ❌ No escaping for LIKE special chars (% and _)
  traces = await env.DB.prepare(
    'SELECT * FROM mail_trace WHERE envelope_from LIKE ? OR envelope_to LIKE ? OR subject LIKE ? OR message_id_header LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).bind(term, term, term, term, pageSize, offset).all<MailTrace>();
}
```

**Vulnerability:** Although parameterized queries prevent SQL injection, LIKE pattern injection is still possible.

**Example Attack:**
```
User searches for: "%"
This becomes: "%%%"
Query: SELECT * FROM mail_trace WHERE ... LIKE '%' OR ...
Result: Matches all records (every string contains the empty string)

More dangerous:
User searches for: "test%notfound"
This becomes: "%test%notfound%"
Query: WHERE ... LIKE '%test%notfound%'
Result: Only returns records with both patterns in order, but this is still unexpected behavior
```

**Impact:**
- Search filters don't work as expected
- Performance degradation: LIKE '%anything%' is slow on large tables
- Potential DoS by searching for all records repeatedly

**Fix:**
```typescript
function escapeLikeWildcards(str: string): string {
  return str.replace(/[%_]/g, '\\$&');
}

export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  if (!env) return { traces: [] };

  const search = url.searchParams.get('q');
  const direction = url.searchParams.get('direction');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = 100;
  const offset = (page - 1) * pageSize;

  let traces;
  if (search) {
    const searchTerm = search.trim();
    if (searchTerm.length < 3) {
      return { traces: [], error: 'Search term must be at least 3 characters', search: searchTerm, direction: direction || '', page };
    }
    
    const escapedTerm = escapeLikeWildcards(searchTerm);
    const term = `%${escapedTerm}%`;
    
    traces = await env.DB.prepare(
      'SELECT * FROM mail_trace WHERE envelope_from LIKE ? ESCAPE \'\\' OR envelope_to LIKE ? ESCAPE \'\\' OR subject LIKE ? ESCAPE \'\\' OR message_id_header LIKE ? ESCAPE \'\\' ORDER BY timestamp DESC LIMIT ? OFFSET ?',
    ).bind(term, term, term, term, pageSize, offset).all<MailTrace>();
  } else if (direction) {
    const validDirections = ['inbound', 'outbound'];
    if (!validDirections.includes(direction)) {
      return { traces: [], error: 'Invalid direction', search: search || '', direction, page };
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

#### 4.2 **No Error Handling in logTrace() Function**
**File:** [apps/email-worker/src/index.ts](apps/email-worker/src/index.ts#L231-249)  
**Severity:** CRITICAL  
**Issue:** The `logTrace()` function silently swallows errors

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
  // ❌ No error handling - if INSERT fails, trace is lost
  // ❌ Database connection error = silent failure
  // ❌ No logging of errors
}
```

**Impact:**
- Mail trace gaps go undetected
- Compliance/audit issues
- No visibility into email processing failures
- Impossible to diagnose email delivery problems

**Failure Scenarios:**
1. Database temporarily down → traces lost
2. Storage quota exceeded → traces lost
3. Network timeout → traces lost

**Fix:**
```typescript
async function logTrace(db: D1Database, trace: Record<string, unknown>): Promise<boolean> {
  try {
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
    
    return true;
  } catch (err) {
    const error = err as Error;
    console.error(`[TRACE_ERROR] Failed to log mail trace:`, {
      direction: trace.direction,
      from: trace.envelope_from,
      to: trace.envelope_to,
      error: error.message,
    });
    return false;
  }
}

// Then use it:
const traceLogged = await logTrace(env.DB, {
  direction: 'inbound',
  envelope_from: senderAddress,
  // ...
});

if (!traceLogged) {
  // Consider: should we quarantine the message if trace fails?
  // Or continue accepting but alert?
  console.warn('[TRACE_FAILURE] Email trace logging failed - message acceptance may not be tracked');
}
```

---

#### 4.3 **No Validation of Trace Direction and Status Enums**
**File:** [apps/email-worker/src/index.ts](apps/email-worker/src/index.ts#L231-249)  
**Severity:** CRITICAL  
**Issue:** The trace direction and status are not validated before insertion

```typescript
async function logTrace(db: D1Database, trace: Record<string, unknown>): Promise<void> {
  await db.prepare(
    `INSERT INTO mail_trace (..., direction, ..., status, ...)
     VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    generateId(),
    (trace.message_id_header as string) ?? null,
    trace.direction as string,  // ❌ Not validated - could be "invalid_direction"
    ...
    trace.status as string,  // ❌ Not validated - could be "pending" or any value
    ...
  ).run();
}
```

**Schema allows specific values:**
```sql
direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
status TEXT NOT NULL CHECK (status IN ('delivered', 'bounced', 'rejected', 'quarantined', 'deferred', 'sent')),
```

**Impact:**
- If invalid direction passed, constraint violation causes error
- Error propagates up and could break email processing flow
- Audit trail has corrupted data

**Example Call Sites:**
```typescript
// Line 164: Can pass any status
await logTrace(env.DB, {
  direction: 'inbound',
  envelope_from: senderAddress,
  envelope_to: recipientAddress,
  status: 'rejected',  // ✓ Valid
  ...
});

// Line 204: Can pass any status
await logTrace(env.DB, {
  direction: 'inbound',
  ...
  status: folder === 'spam' ? 'quarantined' : 'delivered',  // ✓ Valid
  ...
});

// Line 220: Can pass any status
await logTrace(env.DB, {
  message_id_header: messageIdHeader,
  direction: 'inbound',
  ...
  status: folder === 'spam' ? 'quarantined' : 'delivered',  // ✓ Valid
  ...
});
```

**Fix:**
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
  const VALID_DIRECTIONS: Record<TraceDirection, boolean> = { inbound: true, outbound: true };
  const VALID_STATUSES: Record<TraceStatus, boolean> = {
    delivered: true, bounced: true, rejected: true, quarantined: true, deferred: true, sent: true
  };

  if (!VALID_DIRECTIONS[trace.direction]) {
    console.error(`[TRACE_ERROR] Invalid direction: ${trace.direction}`);
    return false;
  }

  if (!VALID_STATUSES[trace.status]) {
    console.error(`[TRACE_ERROR] Invalid status: ${trace.status}`);
    return false;
  }

  try {
    await db.prepare(
      `INSERT INTO mail_trace (trace_id, message_id_header, direction, timestamp, envelope_from, envelope_to, header_from, subject, size_bytes, status, status_detail, spf_result, dkim_result, dmarc_result, spam_score, source_ip)
       VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId(),
      trace.message_id_header ?? null,
      trace.direction,
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
      error: error.message,
    });
    return false;
  }
}
```

---

### ⚠️ MAJOR ISSUES

#### 4.4 **Pagination Offset Vulnerability (Integer Overflow)**
**File:** [apps/web/src/routes/admin/trace/+page.server.ts](apps/web/src/routes/admin/trace/+page.server.ts#L11-12)  
**Severity:** MAJOR  
**Issue:** Page parameter not validated, could cause negative offsets or integer overflow

```typescript
const page = parseInt(url.searchParams.get('page') || '1', 10);  // ❌ No min/max validation
const pageSize = 100;
const offset = (page - 1) * pageSize;

// Example: page=-1 → offset = -100 (SQLite allows this, returns reverse order)
// Example: page=999999999 → offset = huge number (slow query or memory issues)
```

**Impact:**
- Negative page → unexpected query results
- Huge page number → DoS via expensive query
- No pagination bounds

**Fix:**
```typescript
const rawPage = url.searchParams.get('page');
const page = Math.max(1, Math.min(1000000, parseInt(rawPage || '1', 10) || 1));
const pageSize = 100;
const offset = (page - 1) * pageSize;

// Now page is guaranteed to be between 1 and 1,000,000
```

---

#### 4.5 **Timestamp Ordering Issues on Fast Email Processing**
**File:** [apps/email-worker/src/index.ts](apps/email-worker/src/index.ts#L220) and [+page.server.ts](apps/web/src/routes/admin/trace/+page.server.ts#L17)  
**Severity:** MAJOR  
**Issue:** Using `datetime('now')` provides only second-level precision. Multiple emails processed in the same second lose ordering.

```typescript
// Line 220 in email-worker
await logTrace(env.DB, {
  message_id_header: messageIdHeader,
  direction: 'inbound',
  ...
  status: folder === 'spam' ? 'quarantined' : 'delivered',
  status_detail: folder === 'spam' ? `DMARC ${auth.dmarc}` : 'OK',
});

// Trace query in +page.server.ts
traces = await env.DB.prepare(
  'SELECT * FROM mail_trace ... ORDER BY created_at DESC ...'
).all<MailTrace>();
```

**Issue:** If 100 emails arrive in same second, their order in the log is undefined.

**Impact:**
- Forensic analysis impossible
- Audit trail lacks causality
- Cannot determine sequence of events

**Fix:**
```typescript
// In db.ts traceEmail function
export async function traceEmail(
  db: D1Database,
  trace: { ... }
): Promise<void> {
  const now = new Date().toISOString();  // ✅ ISO with millisecond precision
  
  await db.prepare(
    `INSERT INTO mail_trace (trace_id, message_id_header, direction, timestamp, ...)
     VALUES (?, ?, ?, ?, ...)`
  ).bind(
    generateId(),
    trace.message_id_header ?? null,
    trace.direction,
    now,  // ✅ Full ISO timestamp
    ...
  ).run();
}

// In admin trace page
traces = await env.DB.prepare(
  'SELECT * FROM mail_trace ... ORDER BY timestamp DESC ...'
).all<MailTrace>();
```

---

#### 4.6 **No Permission Check on Trace Query**
**File:** [apps/web/src/routes/admin/trace/+page.server.ts](apps/web/src/routes/admin/trace/+page.server.ts#L1)  
**Severity:** MAJOR  
**Issue:** Page load has no authentication or authorization check

```typescript
export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  if (!env) return { traces: [] };
  // ❌ NO CHECK: if (!locals.user) throw error(401);
  // ❌ NO CHECK: if (locals.user.role !== 'manager') throw error(403);

  const search = url.searchParams.get('q');
  // ... rest of code queries all traces ...
```

**Impact:**
- Any authenticated user (even 'standard' role) can view full mail trace
- Privacy violation: users can search for emails they sent/received
- Compliance violation

**Fix:**
```typescript
export const load: PageServerLoad = async ({ platform, url, locals }) => {
  if (!locals.user) throw redirect(302, '/');
  if (locals.user.role !== 'manager') throw error(403, 'Only managers can view mail trace');

  const env = platform?.env;
  if (!env) throw error(500);

  const search = url.searchParams.get('q');
  // ... rest of code ...
};
```

---

### 🟡 MINOR ISSUES

#### 4.7 **No Column Name Mismatch in Schema**
**File:** [packages/shared/src/schema.sql](packages/shared/src/schema.sql) - `mail_trace` table  
**Severity:** MINOR  
**Issue:** Admin trace page queries `created_at` but schema defines `timestamp`

```typescript
// +page.server.ts line 17 (or elsewhere)
traces = await env.DB.prepare(
  'SELECT * FROM mail_trace ... ORDER BY created_at DESC ...'  // ❌ created_at doesn't exist
).all<MailTrace>();

// But schema has:
CREATE TABLE IF NOT EXISTS mail_trace (
  ...
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),  // ✅ This is the column
  ...
);
```

**Impact:**
- Query will fail with "no such column" error
- Admin trace page breaks

**Fix:** Update query to use `timestamp` instead of `created_at`

---

#### 4.8 **No Limit on Search Result Size in Worst Case**
**File:** [apps/web/src/routes/admin/trace/+page.server.ts](apps/web/src/routes/admin/trace/+page.server.ts#L13-18)  
**Severity:** MINOR  
**Issue:** While pagination is applied (LIMIT 100), the search query could match huge result sets and count them

```typescript
if (search) {
  const term = `%${search}%`;
  traces = await env.DB.prepare(
    'SELECT * FROM mail_trace WHERE envelope_from LIKE ? OR ... ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).bind(term, term, term, term, pageSize, offset).all<MailTrace>();
}
```

**Impact:**
- Searching for common patterns (e.g., "%") scans entire table
- Slow response times
- Database resource exhaustion

---

## SUMMARY TABLE

| Issue | Severity | File | Line | Fix Complexity |
|-------|----------|------|------|-----------------|
| No permission on policy publishing | CRITICAL | admin/policy/+page.server.ts | 17 | Low |
| Concurrent policy version race | CRITICAL | admin/policy/+page.server.ts | 29 | Medium |
| Policy signature validation missing | CRITICAL | policy/+page.server.ts | 43 | Medium |
| Unsafe user ID assertion | MAJOR | admin/policy/+page.server.ts | 35 | Low |
| No input validation on policy | MAJOR | admin/policy/+page.server.ts | 21 | Low |
| Schema column mismatch (body_text vs html_body) | MINOR | schema.sql | - | Low |
| Audit insert no error handling | CRITICAL | db.ts | 26 | Medium |
| No event type validation | MAJOR | db.ts | 18 | Low |
| No null validation in audit | MAJOR | db.ts | 18 | Low |
| Timestamp precision | MINOR | db.ts | 26 | Low |
| No permission on mailbox create | CRITICAL | admin/mailboxes/+page.server.ts | 23 | Low |
| No validation of mailbox type/address | CRITICAL | admin/mailboxes/+page.server.ts | 30 | Medium |
| No permission on mailbox assign | CRITICAL | admin/mailboxes/+page.server.ts | 44 | Low |
| Race condition in assignment check | MAJOR | admin/mailboxes/+page.server.ts | 62 | Low |
| Orphaned attachments on delete | MAJOR | api/messages/[id]/+server.ts | 60 | Medium |
| No audit on message deletion | MAJOR | api/messages/[id]/+server.ts | 55 | Low |
| Email validation missing | MINOR | admin/mailboxes/+page.server.ts | 49 | Low |
| SQL LIKE injection | CRITICAL | admin/trace/+page.server.ts | 13 | Medium |
| No error handling in logTrace | CRITICAL | email-worker/src/index.ts | 231 | Medium |
| No enum validation in trace | CRITICAL | email-worker/src/index.ts | 231 | Low |
| Pagination offset not validated | MAJOR | admin/trace/+page.server.ts | 11 | Low |
| Timestamp ordering issues | MAJOR | email-worker/src/index.ts | 220 | Low |
| No permission check on trace query | MAJOR | admin/trace/+page.server.ts | 1 | Low |
| Column name mismatch (created_at vs timestamp) | MINOR | admin/trace/+page.server.ts | 17 | Low |

---

## RECOMMENDATIONS - PRIORITY ORDER

### Phase 1: Critical (Fix Before Any Deployment)
1. ✅ Add role checks to all admin actions (policy publish, mailbox create, mailbox assign, trace query)
2. ✅ Add error handling to audit() and logTrace()
3. ✅ Validate policy version before signing
4. ✅ Validate mailbox type and email addresses
5. ✅ Fix SQL LIKE injection in trace search
6. ✅ Add enum validation to trace direction/status
7. ✅ Fix schema column mismatches

### Phase 2: Important (Fix Before Production)
1. ✅ Add transaction wrapping for policy publish
2. ✅ Fix race condition in mailbox assignment
3. ✅ Add error handling for R2 storage operations
4. ✅ Add audit logging for message deletion
5. ✅ Validate pagination offset parameter
6. ✅ Improve timestamp precision for forensics

### Phase 3: Nice to Have
1. Add input length validation
2. Add email address validation utility
3. Add comprehensive error messages
4. Add metrics/monitoring for audit/trace failures

---

## TESTING CHECKLIST

- [ ] Attempt policy publish as standard user (should fail 403)
- [ ] Publish policy twice concurrently (should succeed twice with different IDs)
- [ ] Sign a deleted/non-existent policy version (should fail validation)
- [ ] Audit query for non-existent event type (should return nothing)
- [ ] Create mailbox with invalid email (should reject)
- [ ] Assign mailbox as standard user (should fail 403)
- [ ] Delete message and verify R2 cleanup
- [ ] Search trace with SQL injection patterns ("%", "_", etc.)
- [ ] Request trace page without authentication (should redirect)
- [ ] Verify audit logs exist for all critical operations
- [ ] Check timestamp ordering in trace logs for rapid email sequence


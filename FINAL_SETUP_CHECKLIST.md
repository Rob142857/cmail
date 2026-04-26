# ✅ Final Setup Checklist

## 🔒 Email Worker Security
**Status**: ✅ Deployed with API key authorization (Bearer token)
- API Key: `cbd33480-1ced-4340-ae83-0c910d9410bf`
- All requests to `/send` now require `Authorization: Bearer cbd33480-1ced-4340-ae83-0c910d9410bf`
- This replaces CORS headers with proper server-side authentication

---

## 📧 Cloudflare Pages Environment Variables
You need to set these in Cloudflare Dashboard → cmail-web → Settings → Environment Variables:

### Add the following environment variables:
```
EMAIL_API_KEY = cbd33480-1ced-4340-ae83-0c910d9410bf
SYSTEM_EMAIL = desk@maatara.io
```

**Steps:**
1. Go to https://dash.cloudflare.com/
2. Pages → cmail-web → Settings → Environment Variables
3. Click "Add variable"
4. Add EMAIL_API_KEY
5. Add SYSTEM_EMAIL
6. Redeploy Pages (or changes take effect on next deployment)

---

## 📬 Create System Email Mailbox

Once deployed, sign in as admin and:

1. Go to **Admin → Mailboxes → Create new mailbox**
2. Fill in:
   - **Address**: `desk@maatara.io`
   - **Type**: Shared
   - **Display Name**: Support Desk / System Emails

3. Click Create

**If it fails:**
- Check browser console (F12) for error details
- Ensure you're logged in as a manager
- Verify email format is `desk@maatara.io` (lowercase, valid domain)

---

## 👤 User Email Assignment Architecture

**Important**: Users now have TWO email addresses:

1. **Sign-in email** (in `users` table):
   - Example: `robert@hotmail.com`
   - Used for OAuth login
   - Not the email they receive at

2. **System email** (in `mailboxes` table):
   - Example: `robert@maatara.io`
   - Their actual inbox in cmail
   - Where emails are delivered to
   - Assigned to user via `mailbox_assignments`

**To provision a user (manual steps via Admin UI):**
1. Admin → Users → Create User
   - Email: `robert@hotmail.com`
   - Display: Robert Evans
2. Admin → Mailboxes → Create Mailbox
   - Address: `robert@maatara.io`
   - Type: Personal
3. Admin → Mailboxes → Assign User
   - Mailbox: robert@maatara.io
   - User Email: robert@hotmail.com
   - Permissions: full

---

## 🧪 Test Invite Emails

1. Create a test user with "Send Invite" checkbox enabled
2. Check the user's inbox (at their OAuth email: robert@hotmail.com)
3. **Verify sender**: Email should come from `desk@maatara.io` ✅
4. Click sign-in links and verify OAuth works

---

## 🔧 Why Mailbox Creation Failed

**Possible causes we fixed:**
- ❌ ~~No permission check~~ → ✅ Now validates role='manager'
- ❌ ~~No format validation~~ → ✅ Now validates email regex
- ❌ ~~Silent failures~~ → ✅ Now returns detailed error messages
- ❌ ~~No type validation~~ → ✅ Now validates type is 'personal' or 'shared'

**If it still fails:**
1. Open DevTools (F12)
2. Network tab
3. Try creating mailbox
4. Click the POST request
5. Check Response tab for error message
6. Common errors:
   - "Only managers can create mailboxes" → Log in with manager account
   - "Invalid email address format" → Use format `name@maatara.io`
   - "Mailbox already exists" → Address is already taken

---

## 📋 Summary of Changes

| Component | Change | Benefit |
|-----------|--------|---------|
| **Email Worker** | Added Bearer token authorization (API key) | More secure than CORS headers |
| **Outbound Email** | API key required in request | Prevents unauthorized access |
| **Invite Emails** | Uses SYSTEM_EMAIL (desk@maatara.io) | Professional, branded sender |
| **Mailbox UI** | Better error messages | Easier debugging |
| **Environment** | EMAIL_API_KEY + SYSTEM_EMAIL vars | Clear configuration |

---

## 🚀 Next Steps

1. ✅ Deployment complete
2. ⏳ Set Pages environment variables (EMAIL_API_KEY, SYSTEM_EMAIL)
3. ⏳ Sign in as admin
4. ⏳ Create desk@maatara.io mailbox
5. ⏳ Create test user with invite enabled
6. ⏳ Verify invite email sender
7. ⏳ Test invite click-through and OAuth sign-in

---

## 💡 Configuration Reference

**Email Worker**
- URL: https://cmail-email-worker.rme-6e5.workers.dev/send
- Auth: `Authorization: Bearer cbd33480-1ced-4340-ae83-0c910d9410bf`

**System Email**
- Sender: desk@maatara.io
- Used for: Invites, password resets, notifications

**User Mailbox Pattern**
- Personal: `{firstname}@maatara.io` (full permissions)
- Shared: `desk@maatara.io`, `support@maatara.io` (assigned permissions)

---

**Questions?** Check SETUP_GUIDE.md for detailed explanations.

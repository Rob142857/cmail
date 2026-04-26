# cmail

Open-source email platform on Cloudflare. Google or Microsoft SSO, shared mailboxes, admin dashboard, policy gate — all running on Workers, D1, R2, and Email Routing.

**Hosting cost:** Cloudflare Pages + Email Routing + D1 + R2 fit comfortably inside Cloudflare's free tier for small orgs. The Workers Paid plan ($5/month) is only required if you want to use Cloudflare's native `send_email` binding (limited — see [Outbound providers](#outbound-providers)) or exceed the free Workers request quota. Outbound to arbitrary external recipients always requires a third-party relay (Resend or Postmark) — see the [Outbound providers](#outbound-providers) table for free-tier limits and pricing.

---

## Deploy in 5 minutes

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- Domain added to Cloudflare (Cloudflare must be your authoritative nameserver)
- [Node.js 20+](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- Google Cloud project and/or Microsoft Entra app registration (for SSO)

### 1. Clone and install

```sh
git clone https://github.com/Rob142857/cmail.git
cd cmail
pnpm install
pnpm setup           # creates local wrangler.toml from .example templates
```

> **Why `pnpm setup`?** The real `wrangler.toml` files are gitignored — they
> hold *your* tenant's D1 database IDs and `[vars]` like `MAIL_DOMAIN`.
> The committed `wrangler.toml.example` files are clean templates so anyone
> cloning the repo can plug in their own Cloudflare tenant without ever
> seeing or overwriting the maintainer's IDs.

### 2. Authenticate with Cloudflare

```sh
npx wrangler login
```

### 3. Create D1 database and R2 bucket

```sh
pnpm d1:create     # → copy the database_id from the output
pnpm r2:create
```

Paste the returned `database_id` into **both** `apps/web/wrangler.toml` and
`apps/email-worker/wrangler.toml`.

### 4. Run database migrations

```sh
pnpm db:migrate           # production
pnpm db:migrate:local     # local dev
```

### 5. Configure environment

**Two surfaces:**

| Where | What goes there | Format |
|---|---|---|
| `apps/web/wrangler.toml` `[vars]` | Public, non-secret: `APP_NAME`, `MAIL_DOMAIN`, `APP_URL` | committed-locally, gitignored |
| Cloudflare Pages secrets | Everything else (OAuth secrets, `SESSION_SECRET`, API keys, `BOOTSTRAP_ADMIN_EMAIL`) | `wrangler pages secret put` |

**Local dev** uses `.dev.vars` for the same secrets (gitignored):

```sh
cp .env.example apps/web/.dev.vars
# fill in values, then:
pnpm dev
```

**Production** — push every secret you'll need:

```sh
PROJECT=cmail-web    # or whatever your Pages project is called

npx wrangler pages secret put SESSION_SECRET --project-name $PROJECT
npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name $PROJECT
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name $PROJECT
# and/or:
npx wrangler pages secret put MICROSOFT_CLIENT_ID --project-name $PROJECT
npx wrangler pages secret put MICROSOFT_CLIENT_SECRET --project-name $PROJECT
npx wrangler pages secret put MICROSOFT_TENANT_ID --project-name $PROJECT
# outbound (pick one):
npx wrangler pages secret put RESEND_API_KEY --project-name $PROJECT
# first-run admin (delete after first sign-in):
npx wrangler pages secret put BOOTSTRAP_ADMIN_EMAIL --project-name $PROJECT
```

The same secrets must also be pushed to the email worker for inbound to log audit/trace correctly:

```sh
npx wrangler secret put SESSION_SECRET --config apps/email-worker/wrangler.toml
```

### 6. Configure Email Routing

In the Cloudflare dashboard:
1. Go to your domain → **Email** → **Email Routing**
2. Enable Email Routing
3. Under **Routing rules**, add a catch-all rule pointing to the `cmail-email-worker` Worker

Or via wrangler:
```sh
# Email routing is configured in apps/email-worker/wrangler.toml
pnpm deploy:email-worker
```

### 7. Set up DNS records

Add these DNS records for your mail domain:

| Type | Name | Content |
|------|------|---------|
| MX | @ | Route to Cloudflare Email Routing (auto-configured) |
| TXT | @ | `v=spf1 include:_spf.mx.cloudflare.net -all` (adjust if using external relay) |
| TXT | `_dmarc` | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;` |

DKIM records depend on your outbound provider — see [Outbound Providers](#outbound-providers).

### 8. Deploy

```sh
pnpm deploy
```

Your email platform is live at `https://mail.yourdomain.com`.

### 9. Create first admin

The simplest way: set `BOOTSTRAP_ADMIN_EMAIL` (in `.env` for local, or as a
Cloudflare Pages secret for production) to the email address of your OAuth
account. The first time that email signs in, the user is auto-provisioned as
a **manager** with a personal mailbox at `<localpart>@<MAIL_DOMAIN>`.

```sh
# Production
npx wrangler pages secret put BOOTSTRAP_ADMIN_EMAIL --project-name cmail-web
# (paste: you@gmail.com)
```

Once signed in, **unset** the secret so it can't accidentally bootstrap again:

```sh
npx wrangler pages secret delete BOOTSTRAP_ADMIN_EMAIL --project-name cmail-web
```

Alternatively, seed manually via SQL:

```sh
npx wrangler d1 execute cmail-db --remote --command "INSERT INTO users (id, email, display_name, role, status, created_at, updated_at) VALUES ('admin-001', 'you@gmail.com', 'Admin', 'manager', 'active', datetime('now'), datetime('now'));"
```

Sign in with that Google/Microsoft account and you'll have full admin access.

---

## Local development

```sh
pnpm dev
```

This starts SvelteKit dev server with local D1 and R2 emulation via Miniflare.

---

## Architecture

```
┌──────────────┐     ┌──────────────────────┐     ┌───────────┐
│   Internet   │────▶│  Cloudflare Email     │────▶│  Email    │
│   (inbound)  │     │  Routing (MX)         │     │  Worker   │
└──────────────┘     └──────────────────────┘     └─────┬─────┘
                                                        │
                                                        ▼
┌──────────────┐     ┌──────────────────────┐     ┌───────────┐
│   Browser    │────▶│  Cloudflare Pages     │────▶│  SvelteKit│
│   (users)    │     │  (CDN + SSR)          │     │  App      │
└──────────────┘     └──────────────────────┘     └─────┬─────┘
                                                        │
                                              ┌─────────┼─────────┐
                                              ▼         ▼         ▼
                                         ┌────────┐ ┌──────┐ ┌────────┐
                                         │   D1   │ │  R2  │ │Outbound│
                                         │(SQLite)│ │(blob)│ │Provider│
                                         └────────┘ └──────┘ └────────┘
```

---

## Auth providers

Configure one or both. Users see buttons for each enabled provider on the sign-in page.

### Google

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Authorized redirect URI: `https://MAIL_DOMAIN/auth/callback/google`
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

### Microsoft

1. Go to [Entra ID (Azure AD)](https://entra.microsoft.com/) → App registrations → New registration
2. Redirect URI: `https://MAIL_DOMAIN/auth/callback/microsoft` (Web)
3. Under Certificates & secrets → New client secret
4. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`
5. Use `common` for any Microsoft account, or your tenant ID for org-only

---

## Outbound providers

cmail auto-detects which outbound provider to use based on which env vars / bindings are configured. Priority order: **Cloudflare Email Worker → Resend → Postmark → none**.

| Provider | Env var / binding | Free tier | Paid pricing | Best for |
|----------|-------------------|-----------|--------------|----------|
| **Resend** | `RESEND_API_KEY` | 3,000 emails/month, 100/day, 1 verified domain | Pro $20/mo (50k emails); Scale $90/mo (100k); $1/1k overage | General outbound to any recipient. Recommended default for most orgs. |
| **Postmark** | `POSTMARK_API_KEY` | 100 emails/month (test mode only — requires approval before sending to unverified recipients) | $15/mo (10k emails); pay-as-you-go from $1.25/1k | Transactional / high-deliverability. Stricter onboarding. |
| **Cloudflare `send_email` binding** | `EMAIL` binding in `wrangler.toml` | Included with **Workers Paid** ($5/mo, 10M requests + 30M CPU-ms/month) | Same plan covers email sending — no per-message charge | **Internal replies only.** See limitation below. |

### ⚠️ Cloudflare `send_email` binding — important limitation

The Cloudflare-native `send_email` binding (used by `apps/email-worker`) can **only send to email addresses that have been verified as destination addresses in Cloudflare Email Routing** for your zone. It is *not* a general-purpose SMTP relay. In practice this means:

- ✅ Auto-replies, internal notifications, system messages to your own verified team addresses
- ❌ Sending to arbitrary external recipients (gmail.com, outlook.com, customer addresses, etc.)

For any real outbound flow you'll want **Resend** (or Postmark). The Workers Paid plan's $5/month is therefore not a substitute for an outbound relay — it just unlocks the Workers request quota and the binding for verified-destination sending.

### Recommended setup for testing & small orgs

- **Free tier (development / pilot):** Cloudflare free + Resend free (3,000 emails/month) = $0/month, supports up to ~100 outbound emails/day.
- **Production for small org (≤50 users):** Cloudflare free + Resend Pro ($20/month, 50,000 emails) = $20/month total.
- **High-volume / strict transactional:** Cloudflare free + Postmark ($15/month for 10k, scales by usage).

If no outbound provider is configured, cmail runs in **inbound + internal only** mode (users can receive external email but outbound is disabled — the compose UI shows a banner).

---

## Features

- **Google + Microsoft SSO** — configurable, one or both
- **Shared mailboxes** — role-based addresses (secretary@, treasurer@, etc.)
- **Admin dashboard** — user management, shared mailboxes, policy, audit log
- **Policy acceptance gate** — configurable fair-use policy users must sign before access
- **Inbound email** — Cloudflare Email Routing → Worker → D1/R2
- **Outbound email** — Resend, Postmark, or Cloudflare Email Service
- **Server-side signature injection** — locked org signature on all outbound
- **Full-text search** — across mailbox (D1 FTS5)
- **Audit log** — append-only, all admin actions logged
- **Mail trace** — metadata log for all inbound/outbound
- **Responsive** — mobile-first, works as PWA
- **Whitelabel** — fully brandable via env vars

---

## Configuration reference

All configuration is via environment variables / Cloudflare secrets. See `.env.example` for the full list.

---

## License

MIT

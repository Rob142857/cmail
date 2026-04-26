# cmail-firstrun

Private development and deployment workspace for cmail.

---

## Two-repo setup

| Repo | Visibility | Purpose |
|------|-----------|---------|
| **[Rob142857/cmail](https://github.com/Rob142857/cmail)** | Public | Open-source cmail codebase. All code, features, bug fixes, and MCP configs live here. No secrets, env files, or tenant-specific config are committed. |
| **[Rob142857/cmail-firstrun](https://github.com/Rob142857/cmail-firstrun)** | Private | Personal deployment workspace. Contains `.env` files, `wrangler.toml` configs with real Cloudflare tenant IDs, and this doc. Safe to commit secrets because the repo is private. |

### Git remotes (in cmail-firstrun)

| Remote | Points to | Used for |
|--------|-----------|----------|
| `origin` | `Rob142857/cmail-firstrun` | Push dev work, env configs, deployment notes |
| `upstream` | `Rob142857/cmail` | Pull latest code from the main open-source repo |

### Workflow

```
# Pull latest code from main cmail repo
git fetch upstream
git merge upstream/main

# Push to private fork
git push origin main

# Send code changes back to main repo (no secrets)
# Option A: cherry-pick clean commits into a cmail branch
# Option B: open a PR from a feature branch
```

### What's different in cmail-firstrun

- `.gitignore` allows `.env`, `.env.local`, `.dev.vars`, and `wrangler.toml` files (these are ignored in the main repo)
- `FIRSTRUN.md` (this file) is gitignored in the main repo
- Real Cloudflare tenant IDs, OAuth secrets, and API keys can be committed safely

---

## Cloudflare tenant

| | |
|---|---|
| **Account** | `6e5c976c644b6fe93de144341b688115` |
| **Domain** | `maatara.io` |
| **Dashboard** | https://dash.cloudflare.com/6e5c976c644b6fe93de144341b688115/maatara.io |

### Target deployment

| Service | URL |
|---------|-----|
| Web app (Pages) | `https://mail.maatara.io` (or subdomain TBD) |
| Email Worker | Inbound via Cloudflare Email Routing on `maatara.io` |
| D1 database | `cmail-db` (to be created) |
| R2 bucket | `cmail-storage` (to be created) |

---

## Setup checklist

- [ ] `npx wrangler login` — authenticate to Cloudflare
- [ ] `pnpm install` — install dependencies
- [ ] `pnpm setup` — create local `wrangler.toml` from templates
- [ ] `pnpm d1:create` — create D1 database, paste ID into both `wrangler.toml` files
- [ ] `pnpm r2:create` — create R2 bucket
- [ ] Update `wrangler.toml` vars: `MAIL_DOMAIN`, `APP_NAME`, `APP_URL`
- [ ] Configure OAuth provider (Google and/or Microsoft Entra)
- [ ] Set Cloudflare Pages secrets (SESSION_SECRET, OAuth creds, etc.)
- [ ] `pnpm db:migrate` — run schema migration
- [ ] Configure Email Routing catch-all → `cmail-email-worker`
- [ ] Set DNS records (MX, SPF, DMARC, DKIM)
- [ ] `pnpm deploy` — deploy to Cloudflare
- [ ] Set `BOOTSTRAP_ADMIN_EMAIL` → sign in → remove the secret

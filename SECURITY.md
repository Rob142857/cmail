# Security policy

cmail processes authentication data, message content, attachments, and administrative records. This pre-1.0 project has not been certified for any regulatory or assurance framework.

## Supported versions

Until versioned releases exist, security fixes target the latest commit on the default branch. Older commits, forks, and deployment-specific modifications are not supported by the project.

## Reporting a vulnerability

Use the repository host's private vulnerability-reporting feature when
available. On GitHub, open the repository's **Security** tab, choose
**Advisories**, then **Report a vulnerability**, or use the
[private reporting form](https://github.com/Rob142857/cmail/security/advisories/new)
after the repository owner enables it.

If private reporting is unavailable, ask the maintainers for a private contact channel — do not publish technical details. Do not open a public issue containing an exploit, secret, personal data, private message, tenant identifier, or production URL.

Include:

- the affected commit or version;
- the affected component and route;
- prerequisites and a minimal reproduction;
- expected and observed behavior;
- likely impact;
- suggested mitigation, if known;
- whether the issue is already public or actively exploited.

Maintainers aim to acknowledge a complete report within seven days. Investigation and remediation time depends on severity and complexity. Allow a coordinated fix and disclosure before publishing details.

## Scope

Reports are especially useful for:

- authentication, session, OAuth, or authorization bypasses;
- cross-mailbox data access;
- server-side request forgery, injection, or unsafe HTML handling;
- exposure of message content, attachments, secrets, or tenant metadata;
- inbound or outbound mail spoofing caused by application logic;
- privilege escalation in user, mailbox, policy, audit, trace, or settings tools;
- dependency vulnerabilities with a demonstrated path through cmail.

Provider outages, provider-account compromise, DNS misconfiguration, unsupported local changes, and social engineering without a product flaw are usually deployment concerns, not project vulnerabilities. Report privately if the boundary is unclear.

## Operator responsibilities

Every deployment should:

- use unique secrets and provider credentials;
- keep secrets in provider secret stores, never Git;
- restrict Cloudflare, identity-provider, and outbound-provider administrative access;
- configure OAuth callback URLs exactly;
- verify sender domains and publish appropriate SPF, DKIM, and DMARC records;
- monitor authentication, audit, trace, provider, and DNS events;
- define D1 and R2 backup and restore procedures;
- update dependencies and redeploy security fixes promptly;
- follow the [security checklist](docs/security-checklist.md).

If credentials are exposed, rotate or revoke them immediately. Removing a file from the latest commit is not enough when the value exists in Git history, build logs, caches, or deployed configuration.

Before publishing or mirroring the repository, run `pnpm release:check`. Its
history scan inspects reachable Git objects and reports affected paths without
printing secret values. A failing history check blocks release even when the
current working tree is clean.

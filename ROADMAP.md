# Roadmap

cmail is in its pre-1.0 stage. This roadmap communicates direction, not a
delivery promise or compatibility guarantee. Priorities are refined through
real deployment evidence, security reports, and focused community proposals.

## Current priorities

1. **Security and privacy** — continue adversarial review of authentication,
   mailbox authorization, HTML and attachment handling, public-data
   projections, auditability, retention, and abuse controls.
2. **Repeatable operations** — improve fresh deployment, upgrade, backup,
   restore, rollback, monitoring, and credential-rotation guidance.
3. **Mail reliability** — expand controlled end-to-end coverage for inbound,
   internal, and provider-backed outbound flows, including retries, rejection,
   and failure visibility.
4. **Administration** — mature user, mailbox, policy, organisation, audit, and
   trace workflows without making common tasks dependent on source changes.
5. **Accessible customisation** — keep branding, domain, identity providers,
   regional defaults, and organisation structure portable through configuration
   while improving keyboard, screen-reader, narrow-screen, and localisation
   behavior.

## Before 1.0

- Publish and exercise a documented upgrade and recovery process.
- Complete staging matrices for Google, Microsoft organisational accounts, and
  Microsoft personal accounts.
- Exercise Cloudflare Email Routing and both outbound-provider paths with
  controlled domains.
- Establish a clear compatibility and release policy.
- Close high-impact security, accessibility, and data-loss risks discovered by
  review or field testing.

## Explicit non-goals for the current release

- Operating a hosted SaaS service from this repository.
- Replacing a general-purpose SMTP, IMAP, or Exchange server.
- Claiming regulatory compliance or security certification on behalf of an
  operator.
- Embedding organisation-specific domains, identities, policies, or credentials
  in the public source tree.

Proposals are welcome through the repository's feature-request form. Explain
the user or operator problem, security and privacy consequences, and how the
change remains useful across different organisations. See
[CONTRIBUTING.md](CONTRIBUTING.md) before starting substantial work.

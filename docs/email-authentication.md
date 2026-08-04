# Email authentication and sender requirements

Last reviewed against official sources: **4 August 2026**.

This guide covers the Internet standards and mailbox-provider policies that
affect mail sent through cmail. Provider requirements change independently of
cmail, so re-check the linked primary sources before every production launch
and whenever sending volume or message purpose changes.

> [!IMPORTANT]
> cmail is designed for person-to-person, organisational, and transactional
> mail. It is **not currently a bulk-marketing or campaign platform**. It does
> not provide subscription and consent records, campaign preference management,
> RFC 8058 one-click unsubscribe, automated complaint and bounce suppression,
> deliverability warm-up, or feedback-loop operations. Do not use cmail for
> bulk marketing until those capabilities, provider controls, and an
> organisation-specific compliance review are in place.

## Standards, provider policy, and law are different

| Layer | What it controls | Who decides it |
|---|---|---|
| Internet standards | How SPF, DKIM, DMARC, and one-click unsubscribe interoperate | IETF RFCs |
| Receiver policy | What Gmail, Yahoo, Outlook, or another mailbox provider requires for delivery | Each provider |
| Legal and contractual duties | Consent, lawful basis, sender identification, unsubscribe wording and timing, privacy, retention, and records | Applicable jurisdictions, contracts, and organisational policy |

Passing SPF, DKIM, and DMARC does not prove that a message was solicited or
lawful. Likewise, implementing an RFC 8058 endpoint does not by itself satisfy
every unsubscribe or consent rule. This guide is operational documentation,
not legal advice. Assign an accountable owner to obtain jurisdiction-specific
privacy and communications advice before sending real mail.

## Current Internet standards

### SPF: RFC 7208

[RFC 7208](https://www.rfc-editor.org/info/rfc7208/) defines Sender Policy
Framework. SPF authorises hosts to use the SMTP `MAIL FROM` or `HELO` domain;
it does not authenticate the visible RFC 5322 `From:` address by itself.

For each domain that publishes SPF:

- inventory every legitimate sender before changing DNS;
- publish one SPF TXT record, merging authorised mechanisms rather than
  publishing multiple `v=spf1` records;
- keep evaluation within RFC 7208's ten DNS-lookup limit; and
- verify the actual envelope domain used by the provider, not only the visible
  sender address.

SPF can contribute to DMARC only when SPF passes and its authenticated domain
aligns with the visible `From:` domain.

### DKIM: RFC 6376 and RFC 8301

[RFC 6376](https://www.rfc-editor.org/info/rfc6376/) defines DomainKeys
Identified Mail signatures. A sender signs selected headers and the message
body; a receiver retrieves the selector's public key from DNS.

[RFC 8301](https://www.rfc-editor.org/info/rfc8301/) updates DKIM cryptographic
requirements. RSA-SHA256 is required, RSA-SHA1 must not be used, RSA keys must
be at least 1024 bits, and signers should use at least 2048 bits. Cloudflare
generates and manages its own DKIM keys; do not replace its dashboard-issued
record with a key copied from another deployment.

DKIM can contribute to DMARC only when the signature verifies and its `d=`
domain aligns with the visible `From:` domain.

### DMARC: RFC 9989, RFC 9990, and RFC 9991

[RFC 9989](https://www.rfc-editor.org/info/rfc9989/) became the current DMARC
Standards Track specification in May 2026. It obsoletes RFC 7489 and RFC 9091.
DMARC evaluates the RFC 5322 `From:` domain and passes when at least one of
these is true:

- SPF passes with an aligned authenticated domain; or
- DKIM passes with an aligned signing domain.

Relaxed alignment, the default, permits domains with the same organisational
domain. Strict alignment requires an exact domain match. A provider may require
both SPF and DKIM to pass as receiver policy even though DMARC itself needs one
aligned passing mechanism.

A cautious initial record is:

```dns
_dmarc.example.com. TXT "v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com"
```

Use a mailbox or reporting service that is secured, monitored, and able to
process reports. If the reporting destination is outside the policy's
organisational domain, the destination must publish the external-report
authorisation described in
[RFC 9990](https://www.rfc-editor.org/info/rfc9990/).

Monitor all legitimate mail streams at `p=none`, correct failures, then move to
`p=quarantine` and ultimately `p=reject` only when authorised mail consistently
passes alignment. Do not rely on `p=none` to protect a domain from spoofing.
For a general-purpose user-mail domain, RFC 9989 warns that `p=reject` can also
reject legitimate indirect mail from mailing lists and forwarders. Observe at
least a month at `p=none` and another month at `p=quarantine`, analyse indirect
mail, and accept the residual risk before considering `p=reject`. A dedicated
sending subdomain is often safer when a strict policy is required.

Important changes in the 2026 DMARC revision include:

- bounded DNS Tree Walk policy discovery in place of public-suffix-list-based
  discovery;
- the `np` policy for non-existent subdomains, `psd` for public suffix
  operators, and `t=y` testing signal;
- `pct`, `rf`, and `ri` are now historic, so new records must not use `pct` for
  staged enforcement; and
- aggregate reporting and message-specific failure reporting are specified
separately by RFC 9990 and
[RFC 9991](https://www.rfc-editor.org/info/rfc9991/).

The new `t=y` signal replaces the useful testing role formerly approximated by
`pct=0`; it is not percentage rollout. Receiver adoption of a new tag can lag,
so use controlled tests and reporting rather than assuming every receiver
honours it. Publish explicit DMARC records for important author subdomains when
their policy must not depend on organisational-domain discovery.

Failure reports requested with `ruf` can include message headers or content and
therefore personally identifiable or confidential information. Do not enable
failure reporting without an explicit privacy, access, retention, and recipient
review. Treat aggregate reports as operationally sensitive mail-flow data too.

### SMTP transport: MTA-STS and TLS-RPT

[RFC 8461](https://www.rfc-editor.org/info/rfc8461/) MTA-STS lets a receiving
domain require authenticated TLS delivery to its declared MX hosts.
[RFC 8460](https://www.rfc-editor.org/info/rfc8460/) TLS-RPT provides aggregate
reports about negotiation and policy failures. These protect SMTP transport;
they do not replace SPF, DKIM, DMARC, message encryption, or the organisation's
data-protection controls.

For a domain whose inbound MX is Cloudflare Email Routing, follow Cloudflare's
[current MTA-STS guide](https://developers.cloudflare.com/email-service/configuration/mta-sts/):

1. publish the dashboard-documented unproxied `_mta-sts` CNAME;
2. serve the policy only at
   `https://mta-sts.example.com/.well-known/mta-sts.txt` over valid HTTPS;
3. publish a monitored `_smtp._tls.example.com` TLS-RPT record, for example
   `v=TLSRPTv1; rua=mailto:tls-reports@example.com`; and
4. begin in `testing` mode, review reports for several weeks, then move to
   `enforce` only after every legitimate MX and certificate path is verified.

Do not copy Cloudflare's policy to a domain with different MX hosts. A wrong
`enforce` policy can stop legitimate inbound delivery. Treat TLS reports as
operationally sensitive and approve their destination, access, and retention.

### One-click unsubscribe: RFC 8058

[RFC 8058](https://www.rfc-editor.org/info/rfc8058/) defines the HTTPS POST
mechanism used for one-click unsubscribe. It requires suitable
`List-Unsubscribe` and `List-Unsubscribe-Post` headers on a DKIM-signed message.
It is a technical standard, not a universal requirement for every message.
Mailbox providers decide which message categories must provide it.

cmail does not currently generate or process RFC 8058 one-click unsubscribe.
That is one reason it must not be treated as bulk-marketing-ready.

## Configure Cloudflare Email Service

Cloudflare Email Sending is currently a public beta available on the Workers
Paid plan. The domain must use Cloudflare DNS. cmail's Pages runtime submits a
bounded request over its private `EMAIL_SERVICE` service binding; the email
Worker uses the native `EMAIL` send binding. The same Worker separately receives
inbound Email Routing events. It is not exposed on `workers.dev` or a public
HTTP route.

The native send returns an opaque Cloudflare tracking identifier through the
private binding, and production needs no outbound API token. That value is
stored separately for delivery reconciliation; it is not assumed to be the
wire RFC `Message-ID`, which the native binding does not expose. Local or
non-service-binding environments may configure the account-ID/API-token REST
fallback. Cloudflare's REST API reference includes an optional
`result.message_id`; cmail accepts it as the wire `Message-ID` only after strict
syntax validation and otherwise records the header as unknown.

When REST credentials are available, a mixed local/external message uses
Cloudflare's [`send_raw` endpoint](https://developers.cloudflare.com/api/resources/email_sending/methods/send_raw/)
with the external SMTP envelope separated from the complete visible `To` and
`Cc` headers. Without those credentials, the native binding sends the complete
recipient set and local recipients return through the configured Email Routing
path. This avoids duplicate delivery and preserves Reply All semantics.

Cloudflare's [postmaster reference](https://developers.cloudflare.com/email-service/reference/postmaster/)
documents its outbound authentication, Sender Rewriting Scheme for forwarded
mail, and Authenticated Received Chain handling. Those provider controls do not make a stale or
conflicting customer DNS record correct. cmail therefore cannot truthfully
display a permanent "standards compliant" badge: the operator must verify the
live DNS and received authentication results described below.

Read Cloudflare's current
[Email Sending setup](https://developers.cloudflare.com/email-service/get-started/send-emails/),
[domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/),
and [authentication guide](https://developers.cloudflare.com/email-service/concepts/email-authentication/)
before changing DNS.

### Understand the two record sets

Email Sending and Email Routing are configured independently:

| Function | DNS location | Cloudflare-managed purpose |
|---|---|---|
| Sending bounce MX | `cf-bounce.example.com` | Return-path and bounce handling |
| Sending SPF | `cf-bounce.example.com` | Authorise Cloudflare outbound servers; currently `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| Sending DKIM | `cf-bounce._domainkey.example.com` | Authenticate Cloudflare outbound messages |
| DMARC | `_dmarc.example.com` | Express policy for the visible sender domain |
| Routing MX | root domain | Deliver inbound mail to Cloudflare Email Routing |
| Routing SPF | root domain | Authorise Cloudflare forwarding; merge with any existing SPF record |
| Routing DKIM | `cf2024-1._domainkey.example.com` | Authenticate Cloudflare-routed mail |

The dashboard is authoritative for the exact values issued to an account.
Cloudflare Email Routing requires Cloudflare's root-domain MX records and cannot
share that inbound role with an unrelated external MX service. Sending and
Routing use distinct DKIM selectors; do not delete one while configuring the
other.

### Production setup

1. Inventory every service that sends or receives mail for the domain.
2. Onboard the outbound domain under **Compute → Email Service → Email
   Sending** and review every proposed record before accepting it.
3. Reconcile the proposed DMARC record with the domain's existing policy and
   report destinations. Never publish a second DMARC or SPF record alongside
   an existing one.
4. Verify the dashboard shows the sending bounce MX, SPF, DKIM, and DMARC
   records as configured.
5. Keep `OUTBOUND_PROVIDER=cloudflare`, the email Worker's native `EMAIL`
   binding, and the Pages application's private `EMAIL_SERVICE` binding as
   described in [Configuration](configuration.md#cloudflare-email-service).
6. Configure Email Routing separately and direct only approved addresses, or an
   explicitly approved catch-all, to the cmail email Worker.
7. Start with controlled test recipients and low, steady volume. Do not direct
   existing production mail to cmail until rollback and recovery are tested.

### DNS and message verification

Substitute the real domain in these read-only checks:

```sh
dig MX cf-bounce.example.com
dig TXT cf-bounce.example.com
dig TXT cf-bounce._domainkey.example.com
dig TXT _dmarc.example.com

# When Cloudflare Email Routing is enabled:
dig MX example.com
dig TXT example.com
dig TXT cf2024-1._domainkey.example.com
```

On Windows, `Resolve-DnsName -Type MX` and `Resolve-DnsName -Type TXT` provide
the equivalent checks. DNS propagation alone is not proof of alignment. Send a
controlled message to test accounts at the providers you need to support, then
inspect the received headers and confirm:

- `spf=pass` for the expected envelope domain;
- `dkim=pass` for the expected Cloudflare selector and signing domain;
- `dmarc=pass` for the visible `From:` domain;
- the visible sender, reply address, and return path are intentional; and
- TLS, forward DNS, reverse DNS, message format, and unsubscribe requirements
  imposed by the receiver are satisfied.

Repeat these checks after changing providers, domains, DNS, sender addresses,
or return-path behaviour. Monitor DMARC aggregate reports and provider
rejections rather than treating one successful test as permanent evidence.

## Current major-provider policies

These are delivery policies, not additions to the RFC protocol definitions.
They apply to mail received by the named provider and can change at any time.

### Google personal Gmail

Google's [Email sender guidelines](https://support.google.com/mail/answer/81126?hl=en)
apply to personal `gmail.com` and `googlemail.com` accounts.

All senders must currently use SPF or DKIM, TLS, valid forward and reverse DNS,
RFC 5322 message formatting, and keep the reported spam rate below 0.3%.

Google's [sender FAQ](https://support.google.com/mail/answer/14229414?hl=en)
classifies a primary domain that sends around 5,000 or more messages to personal
Gmail accounts in 24 hours as a bulk sender. Subdomains are aggregated and the
classification does not expire. Bulk senders must additionally:

- pass both SPF and DKIM;
- publish DMARC with at least `p=none`;
- align the visible `From:` domain with either SPF or DKIM;
- keep user-reported spam below 0.3% and preferably below 0.1%; and
- provide RFC 8058 one-click plus a visible unsubscribe link for marketing and
  promotional messages, processing requests within 48 hours.

Google excludes transactional messages from its one-click unsubscribe
requirement, but not from the applicable authentication and reputation rules.

### Yahoo and AOL

Yahoo's [Sender Best Practices](https://senders.yahooinc.com/best-practices/)
require all senders to use SPF or DKIM, valid forward and reverse DNS, RFC 5321
and RFC 5322 formatting, and a spam rate below 0.3%.

Yahoo-designated bulk senders must pass SPF and DKIM, publish and pass DMARC
with at least `p=none`, align the visible `From:` domain with either SPF or
DKIM, provide a visible unsubscribe option and functioning list-unsubscribe
header for marketing or subscribed messages, and honour unsubscribe requests
within two days. Yahoo's current official page does not publish Google's
5,000-message threshold; do not assume one provider's classification rule
applies to another.

### Microsoft consumer Outlook

Microsoft's [high-volume sender requirements](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730)
apply to domains sending more than 5,000 messages per day to consumer
`outlook.com`, `hotmail.com`, and `live.com` recipients. Those senders must pass
SPF and DKIM, publish DMARC with at least `p=none`, and align DMARC through SPF
or DKIM. Microsoft reports non-compliant traffic can be rejected with
`550 5.7.515`.

Microsoft separately recommends valid sender and reply addresses, functional
unsubscribe for marketing and bulk mail, consent-based sending, and list and
bounce hygiene. These recommendations do not turn cmail into a campaign system.

## Why cmail is not bulk-marketing-ready

cmail has safety limits for ordinary organisational mail, but it does not yet
provide the controls normally required for campaigns or subscription mail:

- evidence of opt-in, consent source, purpose, and withdrawal;
- audience segmentation, preference centres, and suppression precedence;
- RFC 8058 one-click unsubscribe endpoints and signed list headers;
- automated hard-bounce, complaint, abuse, and feedback-loop processing;
- campaign-specific rate control, reputation warm-up, and domain/IP separation;
- provider postmaster integrations and automated spam-rate gates; or
- jurisdiction-specific content, retention, and audit records.

Do not work around this boundary by raising cmail's recipient or hourly limits.
A future bulk feature needs a separate threat model, data model, user experience,
abuse controls, provider review, and legal review before release.

## Production checklist

- [ ] Every legitimate sender and inbound MX dependency is inventoried.
- [ ] Exactly one valid SPF record exists at each evaluated domain and remains
      within the RFC 7208 lookup limit.
- [ ] Provider-issued DKIM selectors resolve and controlled messages show
      `dkim=pass`.
- [ ] DMARC uses RFC 9989 syntax, has no historic `pct`, `rf`, or `ri` tags, and
      controlled messages show aligned `dmarc=pass`.
- [ ] If MTA-STS is enabled, its HTTPS policy matches every legitimate MX,
      TLS-RPT is monitored, and `enforce` was reached only after testing.
- [ ] Aggregate and any failure-report destinations have approved ownership,
      access, privacy, and retention controls.
- [ ] Cloudflare Email Sending and Email Routing record sets are both verified
      when both services are enabled.
- [ ] Google, Yahoo, Microsoft, and any other material receiver policies are
      re-checked for the deployment's volume and message categories.
- [ ] An accountable owner has confirmed that the deployment will not be used
      for bulk marketing with cmail's current feature set.
- [ ] Legal and privacy owners have approved the intended recipients, purpose,
      sender identity, content, records, and unsubscribe process.

Continue with [Deployment and verification](deployment.md) and complete the
[Security checklist](security-checklist.md) before production mail flow.

[← Documentation home](README.md)

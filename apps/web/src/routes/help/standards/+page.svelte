<script lang="ts">
  import { page } from '$app/state';

  // Status vocabulary. Colour is never the only signal — each chip is labelled.
  type Status = 'met' | 'operator' | 'delegated' | 'gap';
  type Row = { standard: string; rfc?: string; status: Status; detail: string };
  type Area = { eyebrow: string; title: string; intro: string; rows: Row[] };

  const appName = $derived(page.data?.appName || 'cmail');

  const STATUS_LABEL: Record<Status, string> = {
    met: 'Implemented',
    operator: 'Operator-configured',
    delegated: 'Delegated to transport',
    gap: 'Not implemented',
  };

  // Every "Implemented" row below was checked against this codebase. Anything
  // unverified belongs in `gaps`, not here.
  const areas: Area[] = [
    {
      eyebrow: 'Interoperability',
      title: 'Message format',
      intro: 'Mail leaves and arrives in the shapes every other mail system expects, so threads stay intact on the far side.',
      rows: [
        {
          standard: 'Internet Message Format',
          rfc: 'RFC 5322',
          status: 'met',
          detail: 'Message-IDs are validated as an addr-spec inside angle brackets. Message-ID, In-Reply-To and References are held within the 998-octet line limit, and a References chain that would overflow keeps its root plus the newest ancestors so threading survives.',
        },
        {
          standard: 'MIME',
          rfc: 'RFC 2045–2049',
          status: 'met',
          detail: 'Every outbound message carries a text/plain alternative alongside the HTML part, with attachments as separate MIME parts.',
        },
        {
          standard: 'Encoded header parameters',
          rfc: 'RFC 5987',
          status: 'met',
          detail: 'Attachment downloads send a UTF-8 filename* parameter with an ASCII fallback, so non-Latin filenames survive the round trip.',
        },
      ],
    },
    {
      eyebrow: 'Authentication',
      title: 'Proving who sent the message',
      intro: 'Outbound authentication is published by you at the DNS layer and applied by the sending transport. Inbound results are handled conservatively — see the gap register.',
      rows: [
        {
          standard: 'SPF',
          rfc: 'RFC 7208',
          status: 'operator',
          detail: 'You publish exactly one SPF record at each evaluated domain. The deployment guide covers the record set and the checks.',
        },
        {
          standard: 'DKIM',
          rfc: 'RFC 6376 + RFC 8301',
          status: 'delegated',
          detail: 'Cloudflare generates, manages and rotates the signing keys and signs on send. RFC 8301 requires RSA-SHA256, forbids RSA-SHA1, and sets a 1024-bit floor with 2048-bit recommended.',
        },
        {
          standard: 'DMARC',
          rfc: 'RFC 9989, 9990, 9991',
          status: 'operator',
          detail: 'DMARCbis became the Standards Track specification in May 2026, obsoleting RFC 7489. It drops the pct, rf and ri tags, adds np, psd and t, and replaces the Public Suffix List with a DNS tree-walk for organisational-domain discovery. Existing v=DMARC1 records stay valid.',
        },
        {
          standard: 'Authentication-Results handling',
          rfc: 'RFC 8601',
          status: 'operator',
          detail: 'Inbound SPF, DKIM and DMARC verdicts are recorded only from a boundary you name in INBOUND_AUTHSERV_ID, and only from the topmost record carrying that identifier. Results are validated against the RFC 8601 registry, commas inside comments and quoted strings cannot split a record, and a forged header from any other authserv-id is discarded. Leave the setting unset and nothing is recorded — which is the safe default, because an unattributed "dkim=pass" is sender-controlled.',
        },
        {
          standard: 'Authenticated Received Chain',
          rfc: 'RFC 8617',
          status: 'gap',
          detail: 'The boundary\'s own arc= verdict is parsed but not stored, and cmail performs no chain validation of its own. Mail relayed through a forwarder or mailing list cannot have a broken SPF or DKIM result reassessed here.',
        },
      ],
    },
    {
      eyebrow: 'Transport',
      title: 'Protecting the connection',
      intro: 'SMTP transport security is published in your DNS. Web transport is enforced by the application on every response.',
      rows: [
        {
          standard: 'MTA-STS',
          rfc: 'RFC 8461',
          status: 'operator',
          detail: 'Requires authenticated TLS delivery to your declared MX hosts. The guide directs you to begin in testing mode and move to enforce only once every MX and certificate path is verified — a wrong enforce policy can stop legitimate inbound mail.',
        },
        {
          standard: 'SMTP TLS Reporting',
          rfc: 'RFC 8460',
          status: 'operator',
          detail: 'Aggregate reports on TLS negotiation and policy failures. Treat the reports as operationally sensitive and approve their destination, access and retention.',
        },
        {
          standard: 'Web transport hardening',
          status: 'met',
          detail: 'HSTS, a hash-based Content-Security-Policy that permits no inline or third-party script and refuses remote fonts, X-Frame-Options, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy, Referrer-Policy, Permissions-Policy, no-store on authenticated responses, and X-Robots-Tag.',
        },
      ],
    },
    {
      eyebrow: 'Untrusted content',
      title: 'Handling mail as hostile input',
      intro: 'Inbound HTML is never trusted at any stage.',
      rows: [
        {
          standard: 'Allowlist sanitisation',
          status: 'met',
          detail: 'Message HTML is parsed and rewritten against an allowlist. Scripts, embedded objects and event handlers are removed, and inline styles are restricted to a fixed property set with url(), expression(), @import, -moz-binding and behavior rejected. Both parser input and retained output are byte-bounded.',
        },
        {
          standard: 'Sandboxed rendering',
          status: 'met',
          detail: 'The sanitised body renders inside a sandboxed frame carrying its own restrictive Content-Security-Policy, so even malformed mail reaches neither the application nor your session.',
        },
        {
          standard: 'Executable attachment blocking',
          status: 'met',
          detail: 'A shared blocked-extension list is applied on both inbound delivery and outbound send, so the boundary cannot be crossed in either direction.',
        },
      ],
    },
    {
      eyebrow: 'Access',
      title: 'Identity and session control',
      intro: 'There is no password to steal, and access is enforced on the server for every request.',
      rows: [
        {
          standard: 'OAuth 2.0 / OpenID Connect',
          status: 'met',
          detail: 'Sign-in delegates to Google or Microsoft Entra ID. No password is set, stored or transmitted, so your existing multi-factor and conditional-access rules continue to apply.',
        },
        {
          standard: 'Session integrity',
          status: 'met',
          detail: 'Session tokens are HMAC-SHA256 signed and stored only as a hash. Lifetime and concurrent sessions per person are configurable, and pausing or offboarding revokes every session immediately.',
        },
        {
          standard: 'Least-privilege delegation',
          status: 'met',
          detail: 'Mailbox access is granted per person, per mailbox, as Read, Send as or Full access, and is checked server-side on every request rather than in the interface.',
        },
      ],
    },
    {
      eyebrow: 'Governance',
      title: 'Evidence and retention',
      intro: 'The records an auditor asks for are produced as a by-product of ordinary operation.',
      rows: [
        {
          standard: 'Append-only audit log',
          status: 'met',
          detail: 'Every administrative action and authentication event is recorded with actor, event type, target, source address and timestamp. The interface offers no way to edit or delete an entry.',
        },
        {
          standard: 'Message trace',
          status: 'met',
          detail: 'Delivery metadata is recorded for every message in and out — envelope addresses, size, status and the relay response. Message content is never written to the trace.',
        },
        {
          standard: 'Configurable retention',
          status: 'met',
          detail: 'Deleted messages, attachments, trace records and audit records each carry their own retention period, enforced on a schedule rather than by hand.',
        },
        {
          standard: 'Versioned acceptable use policy',
          status: 'met',
          detail: 'Each published version is retained, and each acceptance is recorded against the person, version, timestamp and source address. Publishing a new version requires everyone to accept again.',
        },
        {
          standard: 'NIST SP 800-177 Rev. 1',
          status: 'operator',
          detail: 'Trustworthy Email recommends exactly this combination — SPF, DKIM and DMARC published by the domain owner, with TLS for transport. It is guidance for administrators, not a certification scheme, and the DNS-layer work belongs to you.',
        },
      ],
    },
  ];

  // Verified gaps. An unqualified compliance claim is worth nothing, so each
  // entry states the consequence and what would close it.
  const gaps = [
    {
      title: 'Inbound authentication results need INBOUND_AUTHSERV_ID before anything is recorded',
      why: 'An Authentication-Results header is only meaningful if it can be attributed to an MTA you trust — any sender can write "dkim=pass". RFC 8601 §5 requires a consumer to ignore records whose authserv-id is not its own. The parser therefore refuses to produce a verdict until the boundary is named.',
      effect: 'Until the setting is applied, the SPF, DKIM, DMARC and source-address columns in Investigate and Mail trace stay empty. Your DMARC policy is still enforced upstream by the receiving MX; it simply is not attributed per message here.',
      closes: 'Setting INBOUND_AUTHSERV_ID on the email Worker to the authserv-id your boundary stamps. Results then appear against every subsequent message.',
    },
    {
      title: 'No Authenticated Received Chain (RFC 8617)',
      why: 'ARC lets a receiver trust an earlier authentication result after a forwarder or mailing list has broken SPF or DKIM alignment. The boundary\'s arc= verdict is parsed, but cmail seals and validates no chain of its own.',
      effect: 'Legitimate mail relayed through a forwarder may fail authentication downstream with no chain to appeal to.',
      closes: 'Implementing ARC sealing and chain validation, which needs its own key management and cryptographic verification.',
    },
    {
      title: 'No one-click unsubscribe (RFC 8058)',
      why: 'This is deliberate. cmail is organisational mail, not bulk-marketing tooling, and it lacks consent evidence, suppression precedence, feedback-loop processing and campaign rate control.',
      effect: 'It must not be used for campaigns or subscription mail, and its recipient and hourly limits must not be raised to work around that boundary.',
      closes: 'A separate bulk feature with its own threat model, abuse controls, provider review and legal review.',
    },
    {
      title: 'DKIM2 is not implemented',
      why: 'DKIM2 is still an IETF draft. It binds a message to its intended recipient and records send time to defeat DKIM replay, and closes the forwarding-breakage and DSN-routing gaps.',
      effect: 'None today — no mailbox provider requires it yet. First deployments at major providers are projected for the end of 2026.',
      closes: 'Adoption once the specification is published and the sending transport supports it.',
    },
    {
      title: 'No independent certification',
      why: 'No audit has been carried out against ISO 27001, SOC 2 or an equivalent scheme.',
      effect: 'Everything on this page is an implementation fact you can verify in the source. None of it is an attestation by a third party.',
      closes: 'An audit commissioned by the organisation operating this deployment.',
    },
    {
      title: 'WCAG 2.2 AA is a target, not an audited result',
      why: 'The interface is keyboard-operable with visible focus, honours reduced-motion and Windows High Contrast, and never uses colour as the only signal.',
      effect: 'No formal conformance audit has been completed, so no conformance claim is made.',
      closes: 'An accessibility audit against WCAG 2.2 AA.',
    },
  ];
</script>

<svelte:head>
  <title>Standards and compliance · {appName} help</title>
</svelte:head>

<article class="standards">
  <header>
    <p class="eyebrow">Compliant email</p>
    <h1>Standards and compliance</h1>
    <p class="lede">
      {appName} implements the open standards that make email interoperable and the controls an
      organisation is expected to evidence. Every row marked <em>Implemented</em> was checked
      against the source you are running. Where something is not done, it is listed in the gap
      register at the end rather than left unsaid.
    </p>
    <p class="note">
      Standards, receiver policy and legal duty are three different things. Passing SPF, DKIM and
      DMARC does not prove a message was solicited or lawful. This page is operational
      documentation, not legal advice.
    </p>
  </header>

  {#each areas as area}
    <section aria-labelledby={`area-${area.eyebrow.replace(/\s+/g, '-').toLowerCase()}`}>
      <p class="eyebrow">{area.eyebrow}</p>
      <h2 id={`area-${area.eyebrow.replace(/\s+/g, '-').toLowerCase()}`}>{area.title}</h2>
      <p class="section-intro">{area.intro}</p>

      <ul class="rows">
        {#each area.rows as row}
          <li class={row.status}>
            <div class="row-head">
              <strong>{row.standard}</strong>
              {#if row.rfc}<span class="rfc">{row.rfc}</span>{/if}
              <span class="status status-{row.status}">{STATUS_LABEL[row.status]}</span>
            </div>
            <p>{row.detail}</p>
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  <section class="gap-register" aria-labelledby="area-gaps">
    <p class="eyebrow">Gap register</p>
    <h2 id="area-gaps">What is not done, and why</h2>
    <p class="section-intro">
      Each entry states the reason, the practical effect, and what would close it.
    </p>

    <ul class="gaps">
      {#each gaps as gap}
        <li>
          <h3>{gap.title}</h3>
          <dl>
            <div><dt>Why</dt><dd>{gap.why}</dd></div>
            <div><dt>Effect</dt><dd>{gap.effect}</dd></div>
            <div><dt>Closed by</dt><dd>{gap.closes}</dd></div>
          </dl>
        </li>
      {/each}
    </ul>
  </section>

  <aside class="closing">
    <div>
      <strong>Deploying or operating this yourself?</strong>
      <p>
        The DNS record sets, the MTA-STS rollout order, the provider requirements and the
        production checklist are in <code>docs/email-authentication.md</code> in the project
        repository. The acceptable use policy for this deployment is published in the app.
      </p>
    </div>
    <a class="btn" href="/policy">Read the usage policy</a>
  </aside>
</article>

<style>
  .standards { display: grid; gap: 34px; max-width: 860px; }
  header { max-width: 720px; }
  .eyebrow { margin: 0 0 6px; color: var(--primary); font-size: 11px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
  h1 { margin: 0; font-size: clamp(30px, 6vw, 46px); letter-spacing: -.035em; }
  .lede { margin-top: 12px; color: var(--text-muted); font-size: 17px; line-height: 1.65; }
  .lede em { color: var(--text); font-style: normal; font-weight: 600; }
  .note {
    margin-top: 14px;
    padding: 11px 14px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--warning);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.6;
  }

  section h2 { margin: 0; font-size: 22px; letter-spacing: -.02em; }
  .section-intro { margin: 8px 0 0; color: var(--text-muted); font-size: 14px; line-height: 1.6; max-width: 70ch; }

  .rows { margin: 16px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
  .rows li {
    padding: 15px 17px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
  }
  .rows li.met { border-left-color: var(--success); }
  .rows li.operator { border-left-color: var(--primary); }
  .rows li.delegated { border-left-color: var(--primary); }
  .rows li.gap { border-left-color: var(--warning); }

  .row-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .row-head strong { font-size: 14px; }
  .rfc { color: var(--text-muted); font-family: var(--font-mono); font-size: 11.5px; }
  .status {
    margin-left: auto;
    flex: 0 0 auto;
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--bg-subtle);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  .status-met { background: var(--success-soft); border-color: var(--success-border); color: var(--success-text); }
  .status-operator,
  .status-delegated { background: var(--primary-soft); border-color: var(--primary-border); color: var(--primary-text); }
  .status-gap { background: var(--warning-soft); border-color: var(--warning-border); color: var(--warning-text); }

  .rows li p { margin: 7px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.6; }

  .gaps { margin: 16px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; }
  .gaps > li {
    padding: 16px 18px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--warning);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
  }
  .gaps h3 { margin: 0 0 10px; font-size: 15px; }
  .gaps dl { display: grid; gap: 6px; margin: 0; }
  .gaps dl > div { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 10px; }
  .gaps dt { color: var(--text-faint); font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding-top: 2px; }
  .gaps dd { margin: 0; color: var(--text-muted); font-size: 13px; line-height: 1.6; }

  .closing {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 18px;
    align-items: center;
    padding: 18px 20px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--primary);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
  }
  .closing p { margin: 4px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.55; }
  .closing code { font-family: var(--font-mono); font-size: 11.5px; }

  @media (max-width: 680px) {
    .closing { grid-template-columns: 1fr; }
    .closing .btn { justify-self: start; }
    .status { margin-left: 0; }
    .gaps dl > div { grid-template-columns: 1fr; gap: 2px; }
  }
</style>

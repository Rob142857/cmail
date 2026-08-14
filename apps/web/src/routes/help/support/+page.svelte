<script lang="ts">
  import { page } from '$app/state';

  const supportEmail = $derived(page.data?.supportEmail || '');
</script>

<article class="guide">
  <header>
    <p class="eyebrow">Support process</p>
    <h1>Triage safely, then escalate with useful evidence</h1>
    <p>Use internally trained people as the first support level. Escalate a reproducible product defect through the organisation's agreed channel; do not put private mail or secrets in a case.</p>
  </header>

  <nav class="on-this-page" aria-label="On this page">
    <strong>On this page</strong><a href="#l1">Level 1</a><a href="#l2">Level 2</a><a href="#intake">Intake</a><a href="#scope">Scope</a><a href="#safety">Safety</a><a href="#alignment">Alignment</a>
  </nav>

  <section id="l1">
    <h2>Level 1: internally trained organisation people</h2>
    <p>L1 receives user reports, confirms impact, applies approved runbooks, and uses Mail trace and Audit log without exposing message content. L1 owns user communication and the organisation's incident, privacy, and change-management processes.</p>
    {#if supportEmail}
      <p><a class="btn btn-primary" href={`mailto:${supportEmail}?subject=cmail%20support%20request`}>Email organisation support</a></p>
    {:else}
      <p><strong>No Level 1 support address is published in this deployment.</strong> Ask a manager for the approved internal channel.</p>
    {/if}
  </section>

  <section id="l2">
    <h2>Level 2: RME Solutions Technology</h2>
    <p>Trained L1 people use the organisation's agreed RME Solutions Technology ticket or email channel to escalate a reproducible cmail product defect or request separately scoped assistance. State which it is. Keep that supplier channel in the organisation's controlled support runbook rather than publishing it to every user. RME Solutions Technology does not receive system, account, or data access unless the organisation separately authorises it under an appropriate arrangement.</p>
  </section>

  <section id="intake">
    <h2>Record enough to investigate</h2>
    <ol>
      <li>Record a case identifier, reporter, affected service or mailbox, first-observed UTC time, user impact, and any containment.</li>
      <li>Check active mailbox status, assignments, configuration, provider health, Mail trace, Audit log, and the relevant runbook.</li>
      <li>When practical, reproduce safely in staging or locally with synthetic data.</li>
      <li>Capture the deployed version, component, safe steps, expected and observed results, time window, and redacted trace or error identifiers.</li>
    </ol>
    <p>Use the organisation's own incident policy to decide urgency. This process does not create an SLA, guarantee response or resolution times, or certify the product or deployment.</p>
  </section>

  <section id="scope">
    <h2>Separate defects from quoted work</h2>
    <p>A product-bug escalation is a clear, reproducible behaviour in supported cmail code that conflicts with documented or expected functionality. Operational help expressly included in a separate support agreement follows that agreement. Detailed design, configuration, Cloudflare, identity-provider, DNS, provider, migration, recovery, bespoke integration, training, and non-reproducible troubleshooting outside the agreed scope are separately scoped or quoted work.</p>
    <p>If the boundary is unclear, mark the request as a scope review and provide the facts rather than presuming a defect or entitlement.</p>
  </section>

  <section id="safety">
    <h2>Keep support evidence safe</h2>
    <p>Never include message bodies, attachments, credentials, OAuth or session values, API keys, private URLs, database exports, unredacted logs, or unnecessary personal data in a ticket or email. Prefer timestamps, trace identifiers, commit IDs, redacted screenshots, and synthetic reproductions.</p>
    <div class="callout"><strong>Security and privacy incidents are urgent.</strong><p>Contain suspected compromise, unauthorised access, or data exposure and follow the organisation's incident process immediately. Suspected cmail vulnerabilities use the private security process, not ordinary support.</p></div>
  </section>

  <section id="alignment">
    <h2>Service-management alignment</h2>
    <p>This workflow maps to ITIL service desk, incident, service request, problem, change enablement, knowledge, service level, supplier, information-security, monitoring and continual-improvement practices. ISO/IEC 20000-1 is the principal service-management-system reference; ISO/IEC 27001/27002, ISO/IEC 27035 and ISO 22301 cover security, security incidents and continuity.</p>
    <p><a href="/help/standards">Review the full standards and assurance map</a>. Alignment is an operating target, not certification of cmail, RME Solutions Technology, or a deployment.</p>
  </section>
</article>

<style>
  @import '../getting-started/guide.css';
</style>

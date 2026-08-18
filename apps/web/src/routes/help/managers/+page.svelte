<script lang="ts">
  import { page } from '$app/state';
</script>

<article class="guide">
  <header>
    <p class="eyebrow">Manager handbook</p>
    <h1>Operate the mail environment safely</h1>
    <p>Checks for identity, shared mailboxes, mail flow, privacy, and offboarding.</p>
  </header>

  {#if page.data?.user?.role === 'manager'}
    <p><a class="btn btn-primary" href="/admin">Open the Management centre</a></p>
  {:else}
    <div class="callout"><strong>Manager access is required for changes.</strong><p>Anyone can read this guide, but only Manager-role accounts can use the Management centre.</p></div>
  {/if}

  <nav class="on-this-page" aria-label="On this page">
    <strong>On this page</strong><a href="#model">Management model</a><a href="#people">People</a><a href="#mailboxes">Mailboxes</a><a href="#operations">Operations</a><a href="#support">Support</a><a href="#evidence">Evidence</a><a href="#privacy">Directory privacy</a><a href="#offboard">Offboarding</a>
  </nav>

  <section id="model">
    <h2>The Management centre</h2>
    <p>Overview shows required configuration, optional capabilities, recent activity, and directory visibility. Treat red or action-needed checks as deployment blockers. Settings explains the effective config and Cloudflare secret state without revealing secret values.</p>
    <div class="area-grid">
      <div><strong>People</strong><span>Account lifecycle, sign-in provider, role, personal mailbox.</span></div>
      <div><strong>Mailboxes</strong><span>Shared addresses, delivery status, and mailbox delegation.</span></div>
      <div><strong>Organisation</strong><span>Layers, units, roles, positions, and public visibility.</span></div>
      <div><strong>Mail trace</strong><span>Inbound and outbound delivery diagnostics.</span></div>
      <div><strong>Usage policy</strong><span>Publish acknowledgement text and track the active version.</span></div>
      <div><strong>Audit log</strong><span>Review security and administrative events.</span></div>
    </div>
  </section>

  <section id="people">
    <h2>Onboard a person</h2>
    <ol>
      <li>Create the person with their exact Google or Microsoft sign-in email.</li>
      <li>Use Standard unless management access is needed, and add their personal mailbox.</li>
      <li>Select <strong>Send invitation</strong> now, or send it later. The single-use link expires after 72 hours.</li>
      <li>Grant shared mailbox access separately, using the least access that meets the role.</li>
      <li>They sign in via the invitation with the matching account, accept any published policy, and verify their mailbox and From addresses.</li>
    </ol>
    <p>A pending account has no sign-in identity until its invitation succeeds; email alone never authorises first sign-in. Resending rotates the token immediately, so only the newest link works. An identity already enrolled to another account is rejected, not reassigned. Paused blocks sign-in and revokes sessions but keeps data; Offboarded is the durable end state.</p>
  </section>

  <section id="mailboxes">
    <h2>Create and delegate a shared mailbox</h2>
    <ol>
      <li>Open <strong>Mailboxes</strong> and create a shared mailbox with a functional local part, such as support or accounts.</li>
      <li>Confirm the address and display name before routing external mail to it.</li>
      <li>Open Mailbox delegation and grant Read, Send as, or Full access.</li>
      <li>Have each delegate verify the mailbox appears and unavailable actions match their access level.</li>
      <li>Send a controlled inbound, internal, reply, and external test before announcing the address.</li>
    </ol>
    <div class="callout"><strong>Least privilege</strong><p>Read: view only. Send as: adds sending from the shared identity. Full access: adds folder, star, archive, trash, and restore control.</p></div>
    <p>Disabling a mailbox removes it from user navigation and stops sending and new inbound delivery. Stored data is retained. Remove obsolete delegate access before repurposing an address.</p>
  </section>

  <section id="operations">
    <h2>Diagnose mail safely</h2>
    <p>Mail trace shows direction, envelope metadata, status, provider response, and authentication results. Audit log shows administrative changes. Keep ticket notes free of message bodies, OAuth data, push endpoints, and credentials.</p>
    <ul>
      <li>Confirm the mailbox is active and correctly assigned.</li>
      <li>Check inbound routing and recipient status for missing received mail.</li>
      <li>Check the outbound provider, verified sender domain, and trace status for failed sends.</li>
      <li>See the source repository's operations and security checklists for backups, rotation, and incidents.</li>
    </ul>
  </section>

  <section id="support">
    <h2>Support and escalation</h2>
    <p>Trained L1 people handle first reports: check approved runbooks, Mail trace, and Audit log, communicate with the user, and follow the organisation's incident and privacy processes. Keep case notes free of message bodies, attachments, credentials, and session values.</p>
    <p>Escalate a real, reproducible cmail product defect to RME Solutions Technology through the organisation's agreed channel, with the deployed version, safe steps, expected and observed result, impact, and time window. Work outside that — design, configuration, provider or DNS changes — is separately scoped or quoted.</p>
    <div class="callout"><strong>Security and privacy take a separate path.</strong><p>Contain suspected compromise, unauthorised access, or data exposure and follow the organisation's incident process immediately. Suspected cmail vulnerabilities use the private security process, not ordinary support. <a href="/help/support">Read the full support process</a>.</p></div>
  </section>

  <section id="evidence">
    <h2>Prepare evidence for review</h2>
    <p><a href="/help/standards">Standards &amp; assurance</a> covers product capabilities, operator-configured controls, provider responsibilities, and known gaps — a shareable summary, not certification of this deployment.</p>
    <ul>
      <li>Record the deployed version, providers, DNS checks, identity-provider MFA settings, and the approved Cloudflare Email Preview setting.</li>
      <li>Keep protected exports or snapshots of Audit log and Mail trace with your organisation's backup and retention evidence.</li>
      <li>Record retention periods, whether retention jobs are enabled, legal-hold decisions, backup owners, and the latest restore-exercise date.</li>
      <li>Have an accountable owner review the evidence after material access, routing, provider, or retention changes.</li>
    </ul>
    <div class="callout"><strong>Audit log is application evidence, not immutable evidence storage.</strong><p>There is no protected audit export, legal hold, or tamper-evident store. Preserve required evidence through the deployment's own backup, access, and retention controls.</p></div>
  </section>

  <section id="privacy">
    <h2>Publish directory data by exception</h2>
    <p>The public directory needs two gates: the global directory switch and the position's Public visibility setting. A public position exposes only occupant name, title, and work email — all other account, reporting, role, permission, and personal data stays internal.</p>
    <ol>
      <li>Build layers, units, and roles without enabling public output.</li>
      <li>Create positions as Internal and review their work email and title.</li>
      <li>Mark only approved positions Public.</li>
      <li>Enable the global directory switch only after reviewing the public preview.</li>
    </ol>
  </section>

  <section id="offboard">
    <h2>Change access or offboard safely</h2>
    <ol>
      <li>Pause the account to immediately block sign-in and revoke sessions.</li>
      <li>Transfer operational ownership and review every shared mailbox assignment.</li>
      <li>Offboarding makes public positions internal; replace published occupant details only after appointing a successor.</li>
      <li>Preserve mail per policy and legal requirements; do not delete storage ad hoc.</li>
      <li>Offboard the account once the transition is complete, then review Audit log.</li>
      <li>Later mail gets the same generic SMTP rejection as any unavailable address; the sender may see a cmail-labelled delivery failure. cmail sends no auto-reply, protecting outbound quota and preventing backscatter.</li>
    </ol>
    <p>Review unavailable-recipient patterns in Cloudflare Email Routing and Worker metrics. cmail keeps no per-attempt trace here by design, since this path is attacker-controlled.</p>
  </section>
</article>

<style>
  @import '../getting-started/guide.css';
  .area-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 14px; }
  .area-grid div { display: flex; flex-direction: column; gap: 3px; padding: 13px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-surface); }
  .area-grid span { color: var(--text-muted); font-size: 12px; line-height: 1.5; }
  @media (max-width: 600px) { .area-grid { grid-template-columns: 1fr; } }
</style>

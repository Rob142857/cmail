<script lang="ts">
  import { page } from '$app/state';
</script>

<article class="guide">
  <header>
    <p class="eyebrow">Manager handbook</p>
    <h1>Operate the mail environment safely</h1>
    <p>A task-oriented map of the Management centre, with checks for identity, shared mailboxes, mail flow, privacy, and offboarding.</p>
  </header>

  {#if page.data?.user?.role === 'manager'}
    <p><a class="btn btn-primary" href="/admin">Open the Management centre</a></p>
  {:else}
    <div class="callout"><strong>Manager access is required for changes.</strong><p>This guide is readable by everyone, but the Management centre and its actions are enforced on the server for accounts with the Manager role.</p></div>
  {/if}

  <nav class="on-this-page" aria-label="On this page">
    <strong>On this page</strong><a href="#model">Management model</a><a href="#people">People</a><a href="#mailboxes">Mailboxes</a><a href="#operations">Operations</a><a href="#privacy">Directory privacy</a><a href="#offboard">Offboarding</a>
  </nav>

  <section id="model">
    <h2>Use the Management centre as the control plane</h2>
    <p>The Overview page surfaces required configuration, optional capabilities, recent activity, and directory visibility. Treat red or action-needed checks as deployment blockers. Configuration files and Cloudflare secrets remain the infrastructure control plane; the in-app Settings page explains their current effective state without revealing secret values.</p>
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
      <li>Create the person with the exact Google or Microsoft sign-in email.</li>
      <li>Use Standard unless management access is required, and provision the required personal mailbox on the organisation domain.</li>
      <li>Select <strong>Send invitation now</strong>, or use <strong>Send invitation</strong> afterward. This creates a hashed, single-use enrolment token that expires after 72 hours.</li>
      <li>Grant shared mailbox access separately, using the least capable level that meets the role.</li>
      <li>Ask the person to use the newest invitation with the matching Google or Microsoft UserInfo address, accept any published policy, and verify their mailbox and From addresses.</li>
    </ol>
    <p>A newly created account is pending and has no sign-in identity until its invitation succeeds; email alone never authorises first sign-in. Resending rotates the token immediately, so only the newest link works. An identity already enrolled to another account is rejected instead of being reassigned. Paused blocks sign-in and revokes active sessions while retaining data. Offboarded is the durable end state.</p>
  </section>

  <section id="mailboxes">
    <h2>Create and delegate a shared mailbox</h2>
    <ol>
      <li>Open <strong>Mailboxes</strong> and create a Shared mailbox using a functional local part such as support or accounts.</li>
      <li>Confirm the resulting address and display name before routing external mail to it.</li>
      <li>Open Mailbox delegation and grant Read, Send as, or Full access.</li>
      <li>Have each delegate verify the mailbox appears and that unavailable actions match their access level.</li>
      <li>Send a controlled inbound, internal, reply, and external test before announcing the address.</li>
    </ol>
    <div class="callout"><strong>Least privilege</strong><p>Read is observation only. Send as includes reading and sending from the shared identity. Full access adds shared folder, star, archive, trash, and restore control. These are bundled cmail access levels.</p></div>
    <p>Disabling a mailbox removes it from user navigation and stops sending and new inbound delivery. Existing stored data is retained. Remove obsolete delegate access before repurposing an address.</p>
  </section>

  <section id="operations">
    <h2>Diagnose mail without exposing content</h2>
    <p>Use Mail trace to follow direction, sender/recipient envelope metadata, status, provider response, and authentication results. Use Audit log to identify administrative changes. Keep ticket notes free of message bodies, OAuth data, push endpoints, and credentials.</p>
    <ul>
      <li>Confirm the mailbox is active and the person has the expected assignment.</li>
      <li>Check inbound routing and recipient status for missing received mail.</li>
      <li>Check the selected outbound provider, verified sender domain, and trace status for failed sends.</li>
      <li>Use the operations and security checklists in the source repository for backups, rotation, and incident handling.</li>
    </ul>
  </section>

  <section id="privacy">
    <h2>Publish directory data by exception</h2>
    <p>The public organisation directory has two gates: the global directory switch and the position's Public visibility setting. A public position can expose only occupant name, position title, and work email. All other account, reporting, role, permission, and personal data stays internal.</p>
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
      <li>Pause the account immediately when access must stop; this blocks sign-in and revokes sessions.</li>
      <li>Transfer operational ownership and review every shared mailbox assignment.</li>
      <li>Offboarding automatically makes their public positions internal; replace published occupant details only after appointing a successor.</li>
      <li>Preserve mail according to policy and legal requirements; do not delete storage ad hoc.</li>
      <li>Offboard the account when the transition is complete, then review Audit log.</li>
      <li>Expect later mail to receive the same generic SMTP rejection as any unavailable address. The sender's mail system may show a cmail-labelled delivery failure; cmail sends no auto-reply, which protects outbound quota and prevents backscatter.</li>
    </ol>
    <p>Review unavailable-recipient patterns in Cloudflare Email Routing and Worker metrics. cmail deliberately creates no durable per-attempt trace for this attacker-controlled path.</p>
  </section>
</article>

<style>
  @import '../getting-started/guide.css';
  .area-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 14px; }
  .area-grid div { display: flex; flex-direction: column; gap: 3px; padding: 13px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-surface); }
  .area-grid span { color: var(--text-muted); font-size: 12px; line-height: 1.5; }
  @media (max-width: 600px) { .area-grid { grid-template-columns: 1fr; } }
</style>

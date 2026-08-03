<script lang="ts">
  import { page } from '$app/state';
</script>

<article class="guide">
  <header>
    <p class="eyebrow">User guide</p>
    <h1>Start using {page.data?.appName || 'cmail'}</h1>
    <p>Everything you need for a safe first session, from identity sign-in to sending from the right address.</p>
  </header>

  <nav class="on-this-page" aria-label="On this page">
    <strong>On this page</strong>
    <a href="#sign-in">Sign in</a><a href="#mailboxes">Choose a mailbox</a><a href="#compose">Send mail</a><a href="#folders">Folders and actions</a><a href="#help">Get help</a>
  </nav>

  <section id="sign-in">
    <h2>1. Sign in with the invited account</h2>
    <p>For your first sign-in, open the newest invitation email within 72 hours and choose the Google or Microsoft button that manages the invited address. The single-use invitation securely connects that identity to your account; an older link stops working when a manager resends it. After enrolment, use that same provider every time. Microsoft sign-in may include a Microsoft 365 work or school identity, or an Outlook, Hotmail, or Live account when the organisation has enabled personal Microsoft accounts.</p>
    <p>If the link has expired, was already used, or you chose a different address, ask a manager to <strong>Send invitation</strong> again. Do not forward an invitation: it is a temporary sign-in capability intended only for its recipient.</p>
    <div class="callout"><strong>What sign-in does not do</strong><p>It verifies who you are. It does not grant this application access to your personal inbox, files, contacts, or search history.</p></div>
  </section>

  <section id="mailboxes">
    <h2>2. Choose the mailbox you are working in</h2>
    <p>The navigation separates <strong>Personal</strong> and <strong>Shared</strong> mailboxes. Choose one mailbox to see only its messages, or use <strong>All mailboxes</strong> for a combined view. Always check the mailbox label before taking an action.</p>
    <ul>
      <li>A personal mailbox represents your own organisational address.</li>
      <li>A shared mailbox represents a function or team such as Support, Accounts, or Enquiries.</li>
      <li>Unread counts are shown per mailbox and across all assigned mailboxes.</li>
    </ul>
  </section>

  <section id="compose">
    <h2>3. Check the From address before sending</h2>
    <p>Compose and reply show only active addresses for which you have Send as or Full access. Select the address that should represent the conversation. Recipients see the selected organisational address—not the Google or Microsoft identity used to sign in.</p>
    <ol>
      <li>Select <strong>Compose</strong>.</li>
      <li>Confirm <strong>From</strong>, then add To and optional Cc recipients.</li>
      <li>Add a clear subject, write the message, and attach only expected files.</li>
      <li>Review recipients and the From address once more before selecting <strong>Send</strong>.</li>
    </ol>
    <p>Draft text is saved shortly after you pause. Reply and Forward preserve the formatted original below your editable text, with remote images removed for privacy. <strong>Back to message</strong> waits for the latest save and confirms it after returning. Attachments remain only in the current tab, so cmail warns before leaving with files attached.</p>
    <p>Drafts are private to their creator, including drafts addressed from a shared mailbox. Other delegates see shared operational mail and the Sent copy after delivery, but not your unfinished draft.</p>
    <p>When forwarding, original attachments are not added automatically in this release. cmail shows their count so you can return to the message, download the intended files, and reattach them deliberately.</p>
  </section>

  <section id="folders">
    <h2>4. Use folders and message actions deliberately</h2>
    <p>Inbox, Sent, Drafts, Archive, Spam, and Trash are mailbox folders. In shared mailboxes, read state, stars, and folder moves are shared operational state: another delegate may see your changes.</p>
    <div class="term-grid">
      <div><strong>Read / unread</strong><span>Available with every access level.</span></div>
      <div><strong>Reply / forward</strong><span>Available when you can send from that mailbox.</span></div>
      <div><strong>Star / move / archive</strong><span>Require Full access.</span></div>
      <div><strong>Trash / restore</strong><span>Require Full access; restore returns mail to its appropriate folder.</span></div>
    </div>
  </section>

  <section id="help">
    <h2>5. Install, enable alerts, or ask for help</h2>
    <p>Use the <a href="/help/mobile">mobile guide</a> to install the web app and enable optional new-mail notifications. Use the <a href="/help/shared-mailboxes">shared mailbox guide</a> before working from a team address. If a mailbox or action is missing, ask a manager to check your assignment rather than sharing accounts.</p>
    {#if page.data?.supportEmail}<p><a class="btn btn-primary" href={`mailto:${page.data.supportEmail}`}>Contact {page.data?.orgName || 'organisation'} support</a></p>{/if}
  </section>
</article>

<style>
  :global(.guide) { display: grid; gap: 30px; }
  :global(.guide > header) { max-width: 760px; }
  :global(.guide .eyebrow) { margin: 0 0 6px; color: var(--primary); font-size: 11px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
  :global(.guide h1) { margin: 0; font-size: clamp(30px, 6vw, 44px); letter-spacing: -.035em; }
  :global(.guide > header > p:last-child) { margin-top: 12px; color: var(--text-muted); font-size: 17px; line-height: 1.65; }
  :global(.guide section) { scroll-margin-top: 92px; padding-top: 27px; border-top: 1px solid var(--border); }
  :global(.guide section h2) { margin: 0 0 10px; font-size: 23px; }
  :global(.guide section h3) { margin: 20px 0 7px; font-size: 16px; }
  :global(.guide section p), :global(.guide li) { color: var(--text-muted); font-size: 14px; line-height: 1.7; }
  :global(.guide section p + p) { margin-top: 10px; }
  :global(.guide ul), :global(.guide ol) { display: grid; gap: 7px; margin: 12px 0 0; padding-left: 23px; }
  :global(.guide strong) { color: var(--text); }
  :global(.on-this-page) { display: flex; flex-wrap: wrap; align-items: center; gap: 7px 14px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-surface); font-size: 12px; }
  :global(.on-this-page strong) { margin-right: 3px; }
  :global(.callout) { margin-top: 14px; padding: 14px 16px; border-left: 4px solid var(--primary); border-radius: 8px; background: var(--primary-soft); }
  :global(.callout p) { margin: 3px 0 0; font-size: 12px; }
  .term-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
  .term-grid div { display: flex; flex-direction: column; gap: 3px; padding: 13px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-surface); }
  .term-grid span { color: var(--text-muted); font-size: 12px; line-height: 1.5; }
  @media (max-width: 600px) { .term-grid { grid-template-columns: 1fr; } }
</style>

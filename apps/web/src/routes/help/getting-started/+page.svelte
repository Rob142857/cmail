<script lang="ts">
  import { page } from '$app/state';
</script>

<article class="guide">
  <header>
    <p class="eyebrow">User guide</p>
    <h1>Start using {page.data?.appName || 'cmail'}</h1>
    <p>How to sign in, pick a mailbox, and send mail safely.</p>
  </header>

  <nav class="on-this-page" aria-label="On this page">
    <strong>On this page</strong>
    <a href="#sign-in">Sign in</a><a href="#mailboxes">Choose a mailbox</a><a href="#compose">Send mail</a><a href="#folders">Folders and actions</a><a href="#help">Get help</a>
  </nav>

  <section id="sign-in">
    <h2>1. Sign in with the invited account</h2>
    <p>Open your invitation email within 72 hours and sign in with the Google or Microsoft button for the invited address. Use the same provider every time after that. Microsoft sign-in accepts a work or school account, or Outlook, Hotmail, or Live where the organisation allows personal Microsoft accounts.</p>
    <p>If the link expired, was already used, or you chose the wrong address, ask a manager to send a new invitation. Do not forward an invitation — it is only for its recipient.</p>
    <div class="callout"><strong>What sign-in does not do</strong><p>It verifies who you are. It does not grant this application access to your personal inbox, files, contacts, or search history.</p></div>
  </section>

  <section id="mailboxes">
    <h2>2. Choose the mailbox you are working in</h2>
    <p>Navigation separates <strong>Personal</strong> and <strong>Shared</strong> mailboxes. Pick one to see its messages, or use <strong>All mailboxes</strong> for a combined view. Check the mailbox label before acting.</p>
    <ul>
      <li>A personal mailbox is your own organisational address.</li>
      <li>A shared mailbox is a team address, such as Support or Accounts.</li>
      <li>Unread counts show per mailbox and across all assigned mailboxes.</li>
    </ul>
  </section>

  <section id="compose">
    <h2>3. Check the From address before sending</h2>
    <p>Compose and reply show only addresses you can send from. Pick the one that should represent the conversation — recipients see that address, not the identity you signed in with.</p>
    <ol>
      <li>Select <strong>Compose</strong>.</li>
      <li>Confirm <strong>From</strong>, then add To and optional Cc recipients.</li>
      <li>Add a subject, write the message, and attach files. Leave <strong>Importance</strong> at Normal unless the recipient genuinely needs High or Low.</li>
      <li>Check recipients and the From address again, then select <strong>Send</strong>.</li>
    </ol>
    <p>Drafts save automatically, even if you navigate back to the message. Reply, Reply all, and Forward keep the formatted original below your text, with remote images removed for privacy. Reply all drops your own address from the recipients — check To and Cc before sending, especially from a shared mailbox. Attachments stay in the current tab only; cmail warns before you leave with files attached.</p>
    <p>Importance does not speed up delivery, bypass spam checks, or guarantee attention — it is just shown by compatible email clients. New replies and forwards start at Normal.</p>
    <p>Drafts are private to their creator, even from a shared mailbox. Other delegates see shared mail and the Sent copy after delivery, but not your unfinished draft.</p>
    <p>Forwarding does not automatically attach original files or embedded images; return to the message and reattach the ones you want.</p>
  </section>

  <section id="folders">
    <h2>4. Folders and message actions</h2>
    <p>Folders: Inbox, Sent, Drafts, Archive, Spam, and Trash. In shared mailboxes, read state, stars, and folder moves are shared — other delegates may see your changes.</p>
    <div class="term-grid">
      <div><strong>Read / unread</strong><span>Any access level.</span></div>
      <div><strong>Reply / Reply all / Forward</strong><span>Needs Send as or Full access.</span></div>
      <div><strong>Star / move / archive</strong><span>Needs Full access.</span></div>
      <div><strong>Trash / restore</strong><span>Needs Full access; restore returns mail to its folder.</span></div>
    </div>
  </section>

  <section id="help">
    <h2>5. Install or get help</h2>
    <p>See the <a href="/help/mobile">mobile guide</a> to install the app, and the <a href="/help/shared-mailboxes">shared mailbox guide</a> before working from a team address. Missing a mailbox or action? Ask a manager to check your assignment — do not share accounts.</p>
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

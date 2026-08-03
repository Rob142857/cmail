<script lang="ts">
  import { page } from '$app/state';
</script>

<article class="guide">
  <header>
    <p class="eyebrow">Shared mailboxes</p>
    <h1>One address, a coordinated team</h1>
    <p>Shared mailboxes use familiar Exchange-style delegation terms while keeping access and message operations enforced by {page.data?.appName || 'cmail'} on the server.</p>
  </header>

  <div class="callout"><strong>A shared mailbox is not a shared password.</strong><p>Each delegate signs in with their own invited Google or Microsoft identity. Managers grant and revoke access per person.</p></div>

  <section>
    <h2>How the mailbox behaves</h2>
    <p>Mail sent to a shared address is stored once and appears for every active delegate. Folder, read/unread, and star state belong to the mailbox rather than to an individual delegate. This creates one operational view for the team.</p>
    <ul>
      <li>Opening or marking a message read changes its shared read state.</li>
      <li>Moving a message changes the folder for everyone with access.</li>
      <li>Messages sent from the shared address appear in that mailbox's Sent folder.</li>
      <li>Unfinished drafts remain private to their creator; the Sent copy becomes shared after delivery.</li>
    </ul>
  </section>

  <section>
    <h2>Mailbox delegation</h2>
    <div class="permission-table">
      <table>
        <caption class="sr-only">Shared mailbox access levels</caption>
        <thead><tr><th scope="col">Access level</th><th scope="col">Read</th><th scope="col">Send as</th><th scope="col">Organise</th></tr></thead>
        <tbody>
          <tr><th scope="row">Read</th><td>Yes</td><td>No</td><td>No</td></tr>
          <tr><th scope="row">Send as</th><td>Yes</td><td>Yes</td><td>No</td></tr>
          <tr><th scope="row">Full access</th><td>Yes</td><td>Yes</td><td>Yes</td></tr>
        </tbody>
      </table>
    </div>
    <p class="fine-print">cmail uses these three bundled access levels. “Send as” and “Full access” are familiar administrative terms, but this independent implementation is not a Microsoft Exchange server and its permission bundles are not a one-to-one Exchange permission model.</p>
  </section>

  <section>
    <h2>Choose the right From identity</h2>
    <p>When composing or replying, the From menu lists only active mailboxes from which you may send. A recipient sees the selected mailbox address. Your personal sign-in identity is not substituted into the From field.</p>
    <ol>
      <li>Open the shared mailbox or begin a new message.</li>
      <li>Choose the intended shared address in <strong>From</strong>.</li>
      <li>Check recipients, subject, content, and attachments.</li>
      <li>Send; the stored copy becomes part of the shared Sent history.</li>
    </ol>
  </section>

  <section>
    <h2>Safe team conventions</h2>
    <ul>
      <li>Agree who triages new messages and what read/unread means for your team.</li>
      <li>Use Archive or another agreed folder when work is complete.</li>
      <li>Drafts are private while unfinished, but use a proper case system for durable internal notes.</li>
      <li>Ask a manager to remove access immediately when responsibilities change.</li>
      <li>Use Mail trace for delivery diagnostics; do not expose message content in tickets or logs.</li>
    </ul>
  </section>

  <section>
    <h2>When an action is unavailable</h2>
    <p>A missing From address usually means you have Read access only, the mailbox is disabled, or the assignment changed. Disabled mailboxes disappear from user navigation and cannot send or accept new delivery until a manager enables them. Contact a manager rather than using another person's session.</p>
    {#if page.data?.supportEmail}<p><a class="btn" href={`mailto:${page.data.supportEmail}`}>Contact support</a></p>{/if}
  </section>
</article>

<style>
  @import '../getting-started/guide.css';
  .permission-table { margin: 16px 0 10px; overflow: hidden; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-surface); }
  .permission-table table { min-width: 520px; }
  .permission-table th, .permission-table td { padding: 10px 12px; color: var(--text-muted); font-size: 13px; text-align: center; }
  .permission-table th:first-child { text-align: left; }
  .permission-table thead th { color: var(--text); font-size: 11px; }
  .permission-table tbody th { color: var(--text); text-transform: none; letter-spacing: 0; background: transparent; }
  .fine-print { font-size: 12px !important; }
  @media (max-width: 560px) {
    .permission-table { overflow-x: auto; }
    .permission-table table { min-width: 520px; }
  }
</style>

<script lang="ts">
  import { page } from '$app/state';
</script>

<article class="guide">
  <header>
    <p class="eyebrow">Mobile access</p>
    <h1>Use {page.data?.appName || 'cmail'} on your device</h1>
    <p>{page.data?.appName || 'cmail'} is an installable web app. Add it to your Home Screen for a focused view and, where enabled, new-mail notifications.</p>
  </header>

  <div class="platform-grid">
    <section class="platform-card">
      <p class="platform-name">iPhone & iPad</p>
      <h2>Add from Safari</h2>
      <ol>
        <li>Open this site in <strong>Safari</strong> and sign in.</li>
        <li>Tap <strong>Share</strong> (or More, then Share).</li>
        <li>Choose <strong>Add to Home Screen</strong>.</li>
        <li>Turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</li>
        <li>Open the new Home Screen icon before enabling notifications.</li>
      </ol>
      <p class="source-link"><a href="https://support.apple.com/en-ca/guide/iphone/iphea86e5236/ios" rel="external noreferrer">Apple's Home Screen guide</a></p>
    </section>

    <section class="platform-card">
      <p class="platform-name">Android</p>
      <h2>Install from Chrome</h2>
      <ol>
        <li>Open this site in <strong>Chrome</strong> and sign in.</li>
        <li>Tap the three-dot <strong>More</strong> menu.</li>
        <li>Choose <strong>Install app</strong>, or <strong>Add to home screen</strong> if that is what Chrome offers instead.</li>
        <li>Open the new icon. An installed app opens on its own; a shortcut may open in Chrome.</li>
      </ol>
      <p class="source-link"><a href="https://support.google.com/chrome/answer/15085120?co=GENIE.Platform%3DAndroid&amp;hl=en" rel="external noreferrer">Google's Android Home Screen guide</a></p>
    </section>
  </div>

  <section>
    <h2>Native mail apps and connection settings</h2>
    <div class="connection-status">
      <div><strong>Web app</strong><span>Available now</span><p>Use this site in a supported browser, or install it as above.</p></div>
      <div><strong>Native mail clients</strong><span>Not available</span><p>No Exchange, Microsoft Graph, IMAP, POP, JMAP, or SMTP mailbox access. cmail cannot be added to Outlook, Apple Mail, Thunderbird, or another native mail client.</p></div>
    </div>
    <p class="connection-note">No server, port, encryption or protocol settings are available yet. If a future deployment supports a connection method, its settings will be published here by the operator.</p>
  </section>

  <section>
    <h2>Turn on new-mail notifications</h2>
    <p>If enabled, open the mail navigation and choose <strong>Turn on</strong> under New-mail alerts, then approve the permission prompt.</p>
    <ul>
      <li>iPhone and iPad need iOS/iPadOS 16.4 or newer, opened as a Home Screen web app.</li>
      <li>Enable alerts separately on every browser or installed device where you want them.</li>
      <li>Alerts omit sender, subject, mailbox, recipients, and message content.</li>
      <li>Covers personal and assigned shared mailboxes. Tapping an alert opens that message; access is checked again first.</li>
      <li>Focus, Do Not Disturb, battery controls, and OS settings can delay or suppress alerts.</li>
    </ul>
    <p class="source-link"><a href="https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/" rel="external noreferrer">WebKit's iOS Web Push guidance</a></p>
  </section>

  <section>
    <h2>Updates, recovery and offline use</h2>
    <p>{page.data?.appName || 'cmail'} checks for updates when it opens, regains focus or network access, or is restored — no background polling timer. When an update is ready, finish or save your work, then close and reopen the installed app, or refresh a browser tab. cmail never reloads an open page automatically.</p>
    <ul>
      <li>Mail, search, compose and sending need a network connection; nothing is kept for offline use.</li>
      <li>If the icon was removed, return to this site and install it again. Your account and session stay active.</li>
      <li>If the installed app will not load, check the connection, then reopen or refresh it. Ask support if the problem continues.</li>
    </ul>
  </section>

  <section>
    <h2>Troubleshooting</h2>
    <div class="troubleshooting">
      <div><strong>No Install option</strong><p>On iPhone or iPad, use Safari with Open as Web App enabled. On Android, look for Install app or Add to home screen in Chrome. Needs HTTPS — ask the operator to check the manifest and icons if missing.</p></div>
      <div><strong>No notification control</strong><p>The operator may not have configured Web Push, the browser may not support it, or an iPhone/iPad site may not be running from its Home Screen icon.</p></div>
      <div><strong>Notifications blocked</strong><p>Allow notifications in Chrome's site settings and Android's app settings, reopen the app, and check again. Focus, Do Not Disturb, and battery controls can still delay an allowed alert.</p></div>
      <div><strong>No alert after turning on</strong><p>There is no separate test button — turning notifications on is enough. Receiving mail is the real check: send yourself a message and wait a minute. Check permissions and Do Not Disturb before treating this as a delivery issue.</p></div>
      <div><strong>Mail unavailable offline</strong><p>Expected — cmail does not cache mail for offline use. Reconnect and refresh.</p></div>
    </div>
  </section>

  <section>
    <h2>Shared or managed devices</h2>
    <p>Do not install or enable notifications on a device you do not control. Sign out when finished — this also removes that browser's alert subscription. Removing the icon alone does not end the session; if a device is lost, a manager can pause or offboard the account to revoke sessions and alerts.</p>
    {#if page.data?.supportEmail}<p><a class="btn" href={`mailto:${page.data.supportEmail}`}>Ask for device setup help</a></p>{/if}
  </section>
</article>

<style>
  @import '../getting-started/guide.css';
  .platform-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .platform-card { padding: 20px !important; border: 1px solid var(--border) !important; border-radius: 12px; background: var(--bg-surface); }
  .platform-name { margin: 0 0 5px !important; color: var(--primary) !important; font-size: 11px !important; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
  .platform-card h2 { font-size: 20px !important; }
  .source-link { margin-top: 13px !important; font-size: 12px !important; }
  .troubleshooting { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
  .troubleshooting div { padding: 14px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-surface); }
  .troubleshooting p { margin-top: 4px; font-size: 12px !important; }
  .connection-status { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
  .connection-status div { padding: 14px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-surface); }
  .connection-status strong { display: block; }
  .connection-status span { display: inline-block; margin-top: 4px; color: var(--primary); font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .connection-status p, .connection-note { margin-top: 7px; font-size: 12px !important; }
  @media (max-width: 680px) { .platform-grid, .troubleshooting, .connection-status { grid-template-columns: 1fr; } }
</style>

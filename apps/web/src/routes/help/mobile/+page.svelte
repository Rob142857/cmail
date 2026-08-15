<script lang="ts">
  import { page } from '$app/state';
</script>

<article class="guide">
  <header>
    <p class="eyebrow">Mobile access</p>
    <h1>Use {page.data?.appName || 'cmail'} on your device</h1>
    <p>{page.data?.appName || 'cmail'} is an installable web app. Add it to your Home Screen for a focused mobile experience and, when the deployment enables it, optional privacy-minimised new-mail notifications.</p>
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
      <p class="source-link"><a href="https://support.apple.com/en-ca/guide/iphone/iphea86e5236/ios" rel="external noreferrer">Apple's current Home Screen instructions</a></p>
    </section>

    <section class="platform-card">
      <p class="platform-name">Android</p>
      <h2>Install from Chrome</h2>
      <ol>
        <li>Open this site in <strong>Chrome</strong> and sign in.</li>
        <li>Tap the three-dot <strong>More</strong> menu.</li>
        <li>Choose <strong>Install app</strong> when it is offered. If Chrome instead shows <strong>Add to home screen</strong>, create the shortcut.</li>
        <li>Open the new icon. An installed web app opens separately from the regular browser; a shortcut can open in Chrome.</li>
      </ol>
      <p class="source-link"><a href="https://support.google.com/chrome/answer/15085120?co=GENIE.Platform%3DAndroid&amp;hl=en" rel="external noreferrer">Google's current Android Home Screen instructions</a></p>
    </section>
  </div>

  <section>
    <h2>Native mail apps and connection settings</h2>
    <div class="connection-status">
      <div><strong>Web app</strong><span>Available now</span><p>Use this site in a supported browser, or install it from the device instructions above.</p></div>
      <div><strong>Native mail clients</strong><span>Not available</span><p>The current product does not provide Exchange, Microsoft Graph, IMAP, POP, JMAP or end-user SMTP mailbox access. It does not add mailboxes to Outlook, Apple Mail, Thunderbird, or another native mail client.</p></div>
    </div>
    <p class="connection-note">No server, port, encryption or protocol settings are currently available. If a future deployment supports a connection method, its exact settings and security requirements will be published here by the operator.</p>
  </section>

  <section>
    <h2>Turn on new-mail notifications</h2>
    <p>If your operator configured Web Push, open the mail navigation and choose <strong>Turn on</strong> under New-mail alerts. Approve the browser or operating-system permission when prompted. Permission is requested only after your action.</p>
    <ul>
      <li>On iPhone and iPad, Web Push requires iOS/iPadOS 16.4 or newer and the site must be opened as a Home Screen web app.</li>
      <li>Enable alerts separately on every browser or installed device where you want them.</li>
      <li>Alerts intentionally omit sender, subject, mailbox, recipients, and message content.</li>
      <li>Personal and assigned shared mailboxes are covered. Tapping an alert opens that message in its mailbox; current access is checked again before anything is shown.</li>
      <li>Focus, Do Not Disturb, battery controls, and operating-system settings can delay or suppress alerts.</li>
    </ul>
    <p class="source-link"><a href="https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/" rel="external noreferrer">WebKit's iOS and iPadOS Web Push guidance</a></p>
  </section>

  <section>
    <h2>Updates, recovery and offline use</h2>
    <p>{page.data?.appName || 'cmail'} checks for a new deployment when it opens, returns to the foreground, regains focus or network access, and when the page is restored. It does not use a background polling timer. When an update is ready, save or complete work, then close and reopen the installed app. In a browser tab, refresh after saving. cmail never reloads an open page automatically.</p>
    <ul>
      <li>Mail, search, compose and sending require a network connection. The app does not keep mailbox pages or message content for offline use.</li>
      <li>If the icon was removed, return to this site and install it again. Removing an icon does not close the account or revoke an existing session.</li>
      <li>If the installed app will not load, first check the connection, then reopen or refresh it. Ask support if the problem continues.</li>
    </ul>
  </section>

  <section>
    <h2>Troubleshooting</h2>
    <div class="troubleshooting">
      <div><strong>No Install option</strong><p>On iPhone or iPad, use Safari and make sure Open as Web App is enabled. On Android, look for Install app or Add to home screen in Chrome. Confirm the site uses HTTPS, then ask the operator to verify the web manifest and icons.</p></div>
      <div><strong>No notification control</strong><p>The operator may not have configured VAPID keys, the browser may not support Web Push, or an iPhone/iPad site may not be running from its Home Screen icon.</p></div>
      <div><strong>Notifications blocked</strong><p>Open Chrome's site settings and Android's app notification settings, allow notifications for this app/site, reopen it, and check the control again. Focus, Do Not Disturb, battery/data saving and vendor background-app controls can still delay an allowed alert.</p></div>
      <div><strong>Test an alert</strong><p>When New-mail alerts are on, select Send test alert. “Accepted” means the push service accepted the request, not that Android displayed it. Check permissions and battery/Do Not Disturb controls before treating this as a mail-delivery issue.</p></div>
      <div><strong>Mail unavailable offline</strong><p>This is expected. cmail deliberately does not cache mailbox pages or message content for offline use. Reconnect and refresh.</p></div>
    </div>
  </section>

  <section>
    <h2>Shared or managed devices</h2>
    <p>Do not install or enable notifications on a device you do not control. Sign out when finished; the app also attempts to remove that browser's alert subscription before ending the session. Removing an icon does not necessarily revoke the server session; managers can revoke sessions and every registered alert endpoint by pausing or offboarding the account when a device is lost.</p>
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

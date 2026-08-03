<script lang="ts">
  import { page } from '$app/state';
</script>

<article class="guide">
  <header>
    <p class="eyebrow">Mobile setup</p>
    <h1>Install {page.data?.appName || 'cmail'} on your device</h1>
    <p>The installed web app opens from your Home Screen and can receive optional, privacy-minimised new-mail notifications when the deployment has enabled them.</p>
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
        <li>Choose <strong>Add to home screen</strong>, then <strong>Install</strong>.</li>
        <li>Follow the prompts and open the installed app.</li>
      </ol>
      <p class="source-link"><a href="https://support.google.com/chrome/answer/9658361/use-progressive-web-apps-android?co=GENIE.Platform%3DAndroid&amp;hl=en-GB" rel="external noreferrer">Google's current Android instructions</a></p>
    </section>
  </div>

  <section>
    <h2>Turn on new-mail notifications</h2>
    <p>If your operator configured Web Push, open the mail navigation and choose <strong>Turn on</strong> under New-mail alerts. Approve the browser or operating-system permission when prompted. Permission is requested only after your action.</p>
    <ul>
      <li>On iPhone and iPad, Web Push requires iOS/iPadOS 16.4 or newer and the site must be opened as a Home Screen web app.</li>
      <li>Enable alerts separately on every browser or installed device where you want them.</li>
      <li>Alerts intentionally omit sender, subject, mailbox, recipients, and message content.</li>
      <li>Focus, Do Not Disturb, battery controls, and operating-system settings can delay or suppress alerts.</li>
    </ul>
    <p class="source-link"><a href="https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/" rel="external noreferrer">WebKit's iOS and iPadOS Web Push guidance</a></p>
  </section>

  <section>
    <h2>Troubleshooting</h2>
    <div class="troubleshooting">
      <div><strong>No Install option</strong><p>Use Safari on Apple devices or current Chrome on Android, confirm the site uses HTTPS, and ask the operator to verify the web manifest and icons.</p></div>
      <div><strong>No notification control</strong><p>The operator may not have configured VAPID keys, the browser may not support Web Push, or an iPhone/iPad site may not be running from its Home Screen icon.</p></div>
      <div><strong>Notifications blocked</strong><p>Open the device's notification or site settings, allow notifications for this app/site, reopen it, and check the control again.</p></div>
      <div><strong>Mail unavailable offline</strong><p>This is expected. cmail deliberately does not cache mailbox pages or message content for offline use. Reconnect and refresh.</p></div>
    </div>
  </section>

  <section>
    <h2>Shared or managed devices</h2>
    <p>Do not install or enable notifications on a device you do not control. Sign out when finished. Removing an icon does not necessarily revoke the server session; managers can revoke sessions by pausing or offboarding the account when a device is lost.</p>
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
  @media (max-width: 680px) { .platform-grid, .troubleshooting { grid-template-columns: 1fr; } }
</style>

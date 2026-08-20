# Mobile app and notifications

cmail is an installable Progressive Web App (PWA) — a website that behaves like an app once installed, with its own icon and window. A Home Screen shortcut can open in the browser instead; both give you quick access. cmail does not download or store mail for offline use — reading, searching, composing, and sending all need a network connection.

New-mail alerts are optional. They only work when your operator has turned on Web Push, your browser and device support it, and you allow notifications for that browser or app. You need to set this up separately on every device. Alerts cover your active personal and shared mailboxes. Tapping an alert opens the message, and your access is checked again at that point.

## iPhone and iPad

Web Push needs iOS or iPadOS 16.4 or newer, and cmail installed to your Home Screen. A cmail page open as a normal Safari tab cannot receive push notifications on these systems.

### Install cmail

1. Open the organisation's cmail URL in Safari and sign in.
2. Open Safari's **Share** or **More**, then choose **Add to Home Screen**.
3. Turn on **Open as Web App** when that option is shown.
4. Select **Add**.
5. Return to the Home Screen and open cmail from its new icon.

These steps follow Apple's current [web-app installation guide](https://support.apple.com/en-ca/guide/iphone/iphea86e5236/ios). Apple sometimes changes these labels between iOS releases.

### Turn on new-mail alerts

1. Open cmail from the Home Screen icon, not from a Safari tab.
2. Sign in and open the mail navigation.
3. Under **New-mail alerts**, select **Turn on**.
4. Select **Allow** in the system permission prompt.

Apple only shows the permission prompt right after you tap the button yourself — it cannot appear on its own. Web Push for Home Screen apps started in iOS and iPadOS 16.4; see [WebKit's write-up](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) for details.

To manage permission later, go to **Settings > Notifications** and select the installed cmail app's name. Focus modes, notification summaries, and other device settings can still silence or delay an allowed alert.

## Android

These steps use Google Chrome. Other Android browsers may use different labels, or offer different levels of PWA and notification support.

### Install cmail

1. Open the organisation's cmail URL in Chrome and sign in.
2. Open **More** beside the address bar.
3. Choose **Install app** when Chrome offers it. If it instead offers **Add to home screen**, create the shortcut.
4. Open cmail from its new icon. An installed app opens in its own window; a shortcut opens inside Chrome.

These steps follow Google's current [Android Home Screen guide](https://support.google.com/chrome/answer/15085120?co=GENIE.Platform%3DAndroid&hl=en).

### Turn on new-mail alerts

1. Open the installed cmail app and open the mail navigation.
2. Under **New-mail alerts**, select **Turn on**.
3. Allow notifications when Chrome or Android asks.

Both Chrome's site permission and Android's app notification permission need to allow this; see Chrome's [Android notification guide](https://support.google.com/chrome/answer/3220216?co=GENIE.Platform%3DAndroid&hl=en-GB). Battery optimisation, data saver, Do Not Disturb, and manufacturer-specific background restrictions can all delay notifications. If alerts do not appear, check both permissions, then allow background activity for Chrome (or the installed app) if your device offers that setting.

## Turn alerts off

Select **Turn off** under **New-mail alerts** on that device. This removes the subscription from cmail and cancels it locally. You can also revoke notification permission in your device or browser settings.

Subscriptions are per browser and device, so turning alerts off on one device does not affect another. If a device is lost or no longer under your control, ask a manager or operator to revoke your account sessions and follow your organisation's lost-device process. Do not rely on hiding notifications alone.

## Updates and recovery

cmail checks for updates when it opens, comes to the foreground, regains focus or network access, and when the page is restored — not on a constant background timer. When it finds a new version, a banner asks you to finish or save your work, then close and reopen the app. In a browser tab, save your work and refresh instead. cmail never reloads an open page on its own, and there is no separate app-store update process. If the installed app will not load, check your network, then reopen or refresh it. Ask support if the problem continues.

Removing a Home Screen icon does not sign you out or end your session. To restore it, go back to the organisation's cmail URL and repeat the install steps.

## Stay signed in

An installed cmail app stays signed in as long as you keep using it — opening it regularly quietly extends your session, so there's no fixed day when it signs you out on its own. It only signs out if you sign out yourself, don't open it for an extended period your operator has configured, or a manager pauses or offboards your account — those end access right away, on every device, no matter how recently you used it.

## Troubleshooting

### The New-mail alerts control is missing

- On iPhone or iPad, check that the system is 16.4 or newer and that you opened cmail from its Home Screen icon.
- Check that you are signed in and viewing Mail.
- Try a current browser that supports Web Push.
- Ask the operator to confirm the same VAPID setup (the security keys used for push notifications) is in place on both the web app and the inbound email Worker.

### The control says Blocked by browser

Your browser or device has blocked the permission. Re-enable notifications for the cmail site or app in your settings, then reload or reopen cmail. Selecting **Turn on** again will not override a system block.

### The control says On but no alert appears

1. Turning notifications on is enough — there is no separate test button. The real check is receiving mail: send yourself a message (or have a colleague send one) and wait a minute for the alert.
2. Check Chrome's site permission, Android's app notification permission, Focus, Do Not Disturb, notification summaries, battery/data restrictions, and any manufacturer background-app controls.
3. Open cmail and select **Refresh**. If the message is there, the problem is with notifications, not mail delivery.
4. If the message is missing, ask a manager to check Mail trace and mailbox status. If the message is there but alerts still fail, ask the operator to confirm the Web Push (VAPID) setup is present on both the web app and the mail-delivery Worker — the two runtimes are configured independently.

Push services can expire or replace subscriptions over time. Opening cmail re-checks your current subscription and re-registers it with the server. Notifications are a convenience, not an archive, a delivery receipt, or a substitute for checking your mailbox.

## Privacy on mobile devices

cmail notifications show the message sender and subject on your lock screen, the same as most mail apps. A future setting may let you hide this on the lock screen, but that option does not exist yet. Use a passcode, biometric lock, and sensible lock-screen settings, and avoid turning on alerts on shared devices.

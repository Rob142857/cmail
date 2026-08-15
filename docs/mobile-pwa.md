# Mobile app and notification guide

cmail is an installable Progressive Web App (PWA). When the browser offers an
install flow, it requests an app icon and standalone window. A Home Screen
shortcut can instead open in the browser; both provide quick access. cmail does
not download or synchronise mail for offline use. It deliberately keeps mail
out of browser caches, so reading, searching, composing, and sending require a
network connection.

New-mail alerts are optional. They appear only when the operator has configured
Web Push, the browser and operating system support it, and you grant permission
on that specific browser or installed app. Repeat the setup on every device
where you want alerts. Alerts cover active personal and assigned shared
mailboxes. Tapping one opens the message in its mailbox, where access is
checked again; the alert itself contains no sender, subject, mailbox address,
or message text.

## iPhone and iPad

Web Push requires iOS or iPadOS 16.4 or newer and a Home Screen web app. A cmail
page open only as a normal browser tab cannot enable push notifications on
these systems.

### Install cmail

1. Open the organisation's cmail URL in Safari and sign in.
2. Open Safari's **Share** or **More**, then choose **Add to Home Screen**.
3. Turn on **Open as Web App** when that option is shown.
4. Select **Add**.
5. Return to the Home Screen and open cmail from its new icon.

These steps follow Apple's current
[web-app installation guide](https://support.apple.com/en-ca/guide/iphone/iphea86e5236/ios).
Apple may adjust labels between operating-system releases.

### Turn on new-mail alerts

1. Open cmail from the Home Screen icon, not from a Safari tab.
2. Sign in and open the mail navigation.
3. Under **New-mail alerts**, select **Turn on**.
4. Select **Allow** in the system permission prompt.

Apple requires the permission request to follow a direct action such as
selecting the button. Web Push for Home Screen web apps was introduced in iOS
and iPadOS 16.4; the platform behavior is documented by
[WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

Manage later permissions in **Settings > Notifications**, then select the name
used for the installed cmail app. Focus modes, notification summaries, and
device notification settings can silence or delay an allowed alert.

## Android

The following steps use Google Chrome. Other Android browsers can use different
labels or may offer different PWA and notification support.

### Install cmail

1. Open the organisation's cmail URL in Chrome and sign in.
2. Open **More** beside the address bar.
3. Choose **Install app** when Chrome offers it. If it instead offers **Add to
   home screen**, create the shortcut.
4. Open cmail from its new icon. An installed web app opens separately from
   the regular browser; a shortcut can open in Chrome.

These steps follow Google's current
[Android Home Screen guide](https://support.google.com/chrome/answer/15085120?co=GENIE.Platform%3DAndroid&hl=en).

### Turn on new-mail alerts

1. Open the installed cmail app and open the mail navigation.
2. Under **New-mail alerts**, select **Turn on**.
3. Allow notifications when Chrome or Android asks.

Chrome site permissions and Android app notifications both need to allow the
alert. Chrome documents current site controls in its
[Android notification guide](https://support.google.com/chrome/answer/3220216?co=GENIE.Platform%3DAndroid&hl=en-GB).
Battery optimisation, data saving, Do Not Disturb, and vendor-specific
background restrictions can delay notifications.

## Turn alerts off

Select **Turn off** under **New-mail alerts** on that device. This removes the
current browser subscription from cmail and unsubscribes it locally. You can
also revoke notification permission in the operating-system or browser
settings.

Because subscriptions are per browser and device, turning alerts off on one
device does not change another. If a device is lost or no longer controlled,
ask a manager or operator to revoke account sessions and follow the
organisation's device-loss process; do not rely only on hiding notifications.

## Updates and recovery

cmail checks for updated application files while it is open. Reopen the app or
refresh the page to receive a new release; there is no separate app-store
update process. If the installed app will not load, check the network, reopen
or refresh it, and then ask support if the problem continues.

Removing a Home Screen icon does not close the account or revoke an existing
session. Return to the organisation's cmail URL and repeat the relevant install
steps to restore the icon.

## Troubleshooting

### The New-mail alerts control is missing

- On iPhone or iPad, confirm the system is 16.4 or newer and that cmail was
  launched from its Home Screen icon.
- Confirm you are signed in and viewing Mail.
- Try a current browser with Web Push support.
- Ask the operator to confirm that the same complete VAPID configuration is
  deployed to the web application and inbound email Worker.

### The control says Blocked by browser

The permission was denied at browser or operating-system level. Re-enable
notifications for the cmail site or installed app in settings, then reload or
reopen cmail. Repeatedly selecting **Turn on** cannot override a system block.

### The control says On but no alert appears

1. Keep a network connection and send a controlled test message to an active
   mailbox assigned to you.
2. Check Focus, Do Not Disturb, notification summaries, battery restrictions,
   and system notification settings.
3. Open cmail and use **Refresh**. If the message is present, the problem is the
   notification path rather than mail delivery.
4. If the message is absent, ask a manager to check Mail trace and mailbox
   status. If it is present but alerts still fail, ask the operator to inspect
   Web Push configuration and endpoint delivery.

Push services can expire or replace subscriptions. Opening cmail lets it check
the current browser subscription and register that endpoint with the server
again. Notifications are not a compliance archive, delivery receipt, or
substitute for checking the mailbox.

## Privacy on mobile devices

cmail notifications contain only the application name and generic new-mail
text. The app does not put sender, subject, mailbox, or body content in its push
payload. The device still reveals that the organisation's mail app received an
alert, so use device passcodes, supported biometric protection, and appropriate
lock-screen settings. Avoid enabling alerts on shared devices.

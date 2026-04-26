// Invite email templates — onboarding into the host organisation, not into "an app"

export interface InviteEmailOptions {
  email: string;
  displayName: string;
  appName: string;             // product name (e.g. "cmail") — only used in subtle footer
  appUrl: string;              // sign-in URL base (e.g. https://mail.maatara.io)
  senderName: string;          // person extending the invite
  systemEmail?: string;
  mailboxAddress?: string;
  // Organisation context (preferred — the email is now framed as an org onboarding)
  orgName?: string;            // e.g. "Ma'atara Organisation"
  orgShortName?: string;       // e.g. "Ma'atara"
  orgUrl?: string;             // e.g. https://maatara.io
  supportEmail?: string;       // e.g. desk@maatara.io
  landingUrl?: string;         // e.g. https://cmail.maatara.io  (shown in footer)
  policyUrl?: string;          // acceptable use / fair-usage policy
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function generateInviteEmail(options: InviteEmailOptions): { subject: string; html: string; text: string } {
  const {
    email, displayName, appName, appUrl, senderName, mailboxAddress,
    orgName, orgShortName, orgUrl, supportEmail, landingUrl, policyUrl,
  } = options;

  const org = orgName || 'our organisation';
  const orgShort = orgShortName || orgName || 'the organisation';
  const greeting = displayName ? displayName.split(/\s+/)[0] : email;
  const subject = `${senderName} has invited you to ${org}`;

  const policyCtaHtml = policyUrl
    ? `<a href="${escapeHtml(policyUrl)}" class="btn btn-secondary" target="_blank" rel="noopener">Review the email usage policy</a>`
    : '';
  const policyCtaText = policyUrl ? `\nReview the acceptable-use policy: ${policyUrl}\n` : '';

  const mailboxBlockHtml = mailboxAddress
    ? `<div class="info-card mailbox-card"><div class="label">Your ${escapeHtml(orgShort)} mailbox</div><div class="mailbox">${escapeHtml(mailboxAddress)}</div><div class="muted">Mail addressed to this address will appear in your inbox after you sign in.</div></div>`
    : '';
  const mailboxBlockText = mailboxAddress
    ? `\nYour ${orgShort} mailbox: ${mailboxAddress}\n   Messages sent here will appear in your inbox after you sign in.\n`
    : '';

  const orgLine = orgUrl
    ? `<a href="${escapeHtml(orgUrl)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(org)}</a>`
    : escapeHtml(org);

  const supportLine = supportEmail
    ? `<p class="muted small">Questions? Contact <a href="mailto:${escapeHtml(supportEmail)}" style="color:#2563eb;">${escapeHtml(supportEmail)}</a>.</p>`
    : '';
  const supportLineText = supportEmail ? `Questions? Contact ${supportEmail}.\n` : '';

  const landingFooter = landingUrl
    ? `<a href="${escapeHtml(landingUrl)}" style="color:#9ca3af;text-decoration:none;">${escapeHtml(appName)}</a>`
    : escapeHtml(appName);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #111827; background: #f7f8fa; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 0 auto; padding: 32px 20px; }
    .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px; box-shadow: 0 1px 2px rgba(15,23,42,0.04); }
    .org-header { text-align: center; margin-bottom: 24px; }
    .org-name { font-size: 18px; font-weight: 600; color: #111827; letter-spacing: -0.01em; }
    .org-tag { font-size: 13px; color: #6b7280; margin-top: 4px; }
    h1 { font-size: 22px; font-weight: 600; color: #111827; margin: 0 0 16px; letter-spacing: -0.01em; }
    p { margin: 12px 0; color: #374151; }
    .muted { color: #6b7280; }
    .small { font-size: 13px; }
    .cta-row { margin: 28px 0 8px; text-align: center; }
    .btn { display: inline-block; padding: 11px 22px; background: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 14px; margin: 4px; }
    .btn-secondary { background: #ffffff; color: #2563eb !important; border: 1px solid #d1d5db; }
    .info-card { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin: 18px 0; font-size: 14px; }
    .info-card .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 4px; }
    .mailbox-card { border-left: 3px solid #2563eb; }
    .mailbox-card .mailbox { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; color: #111827; margin: 2px 0 6px; }
    .divider { border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    .footer { text-align: center; color: #9ca3af; font-size: 12px; padding: 20px 0 0; }
    .footer a { color: #9ca3af; }
    @media (max-width: 480px) {
      .card { padding: 22px; border-radius: 8px; }
      h1 { font-size: 20px; }
      .btn { display: block; margin: 8px 0; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="org-header">
      <div class="org-name">${orgLine}</div>
      <div class="org-tag">Email onboarding</div>
    </div>

    <div class="card">
      <h1>Welcome, ${escapeHtml(greeting)}</h1>

      <p><strong>${escapeHtml(senderName)}</strong> has invited you to join <strong>${escapeHtml(org)}</strong>. Your organisational email account is ready — sign in below to access it.</p>

      ${mailboxBlockHtml}

      <div class="cta-row">
        <a href="${escapeHtml(appUrl)}/auth/login/microsoft" class="btn">Sign in with Microsoft</a>
        <a href="${escapeHtml(appUrl)}/auth/login/google" class="btn">Sign in with Google</a>
      </div>

      <p class="muted small" style="text-align:center;margin-top:0;">Use the same address you received this email at: <strong>${escapeHtml(email)}</strong>.<br>Choose Microsoft for Outlook/Office accounts, Google for Gmail/Workspace.</p>

      ${policyUrl ? `<hr class="divider"><div class="cta-row" style="margin:0;">${policyCtaHtml}</div><p class="muted small" style="text-align:center;">Please review the acceptable-use policy before sending mail.</p>` : ''}

      <hr class="divider">

      <p class="muted small"><strong>Privacy:</strong> ${escapeHtml(orgShort)} only manages organisational communication sent through this account. Your personal inbox, files, and search history are not accessed.</p>
      ${supportLine}
    </div>

    <div class="footer">
      <p>${supportEmail ? `Sent by <a href="mailto:${escapeHtml(supportEmail)}" style="color:#9ca3af;">${escapeHtml(supportEmail)}</a> on behalf of ${escapeHtml(org)}.` : `Sent on behalf of ${escapeHtml(org)}.`}</p>
      <p>If you weren't expecting this, you can safely ignore it.</p>
      <p style="margin-top:14px;">Powered by ${landingFooter}</p>
    </div>
  </div>
</body>
</html>`;

  const text = `${org} — Email onboarding

Welcome, ${greeting}.

${senderName} has invited you to join ${org}. Your organisational email account is ready — sign in below to access it.
${mailboxBlockText}
Sign in:
  Microsoft: ${appUrl}/auth/login/microsoft
  Google:    ${appUrl}/auth/login/google

Use the same address this email was sent to: ${email}
(Microsoft for Outlook/Office, Google for Gmail/Workspace.)
${policyCtaText}
Privacy: ${orgShort} only manages organisational communication sent through this account. Your personal inbox, files, and search history are not accessed.

${supportLineText}If you weren't expecting this invitation, you can safely ignore it.

—
${supportEmail ? `Sent by ${supportEmail} on behalf of ${org}.` : `Sent on behalf of ${org}.`}
Powered by ${appName}${landingUrl ? ` (${landingUrl})` : ''}`;

  return { subject, html, text };
}

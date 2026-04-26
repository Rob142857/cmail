// Invite email templates for new users

export interface InviteEmailOptions {
  email: string;
  displayName: string;
  appName: string;
  appUrl: string;
  senderName: string;
  systemEmail?: string;
  mailboxAddress?: string;
}

export function generateInviteEmail(options: InviteEmailOptions): { subject: string; html: string; text: string } {
  const { email, displayName, appName, appUrl, senderName, mailboxAddress } = options;

  const subject = `You're invited to ${appName}`;
  const mailboxBlockHtml = mailboxAddress
    ? `<div class="provider-info" style="background: #ecfdf5; border-left: 4px solid #059669; color: #065f46;"><strong>Your mailbox</strong><br><span style="font-family: monospace; font-size: 15px;">${mailboxAddress}</span><br><span style="font-size: 13px;">Mail addressed to this address will appear in your ${appName} inbox after you sign in.</span></div>`
    : '';
  const mailboxBlockText = mailboxAddress
    ? `\nYour mailbox: ${mailboxAddress}\n   Mail sent to this address will appear in your ${appName} inbox after you sign in.\n`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    .logo { font-size: 24px; font-weight: bold; color: #2563eb; }
    .content { background: #f8f9fa; padding: 30px; border-radius: 8px; margin-bottom: 20px; }
    .content h2 { color: #1a1a1a; margin-top: 0; }
    .content p { margin: 12px 0; color: #555; }
    .cta-section { text-align: center; margin: 30px 0; }
    .btn { 
      display: inline-block;
      padding: 12px 32px;
      background: #2563eb;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      margin: 0 8px;
    }
    .btn:hover { background: #1d4ed8; }
    .btn-secondary {
      background: #6b7280;
    }
    .btn-secondary:hover { background: #4b5563; }
    .provider-info { background: #f3f4f6; padding: 16px; border-radius: 6px; margin: 20px 0; font-size: 14px; color: #666; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #999; font-size: 12px; }
    .footnote { margin-top: 20px; padding: 16px; background: #fff8dc; border-left: 4px solid #d97706; color: #92400e; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">${appName}</div>
    </div>

    <div class="content">
      <h2>Welcome to ${appName}!</h2>
      
      <p>Hi ${displayName || email},</p>
      
      <p><strong>${senderName}</strong> has invited you to join <strong>${appName}</strong> — a secure email platform for organisations.</p>
      
      <p>To get started, sign in with your email address below:</p>
    </div>

    <div class="cta-section">
      <p><strong>Choose your sign-in provider:</strong></p>
      <a href="${appUrl}/auth/login/microsoft" class="btn">Sign in with Microsoft</a>
      <a href="${appUrl}/auth/login/google" class="btn">Sign in with Google</a>
    </div>

    ${mailboxBlockHtml}

    <div class="provider-info">
      <strong>Which provider should I choose?</strong>
      <ul style="margin: 8px 0; padding-left: 20px;">
        <li><strong>Microsoft:</strong> Use if your email is @hotmail, @live, @outlook, or a corporate Microsoft account</li>
        <li><strong>Google:</strong> Use if your email is @gmail or a corporate Google Workspace account</li>
      </ul>
      <p style="margin: 8px 0;">You can use any provider as long as you sign in with <strong>${email}</strong>.</p>
    </div>

    <div class="footnote">
      <strong>Security note:</strong> ${appName} uses your email address to verify your identity. We don't access your personal inbox, files, or search history. Only organisational communication through ${appName} will be managed here.
    </div>

    <div class="footer">
      <p>${appName} — Secure email for your organisation</p>
      <p>If you did not expect this invitation, you can safely ignore this email.</p>
      <p style="margin-top: 16px; color: #ccc;">© 2026 ${appName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `Welcome to ${appName}!

Hi ${displayName || email},

${senderName} has invited you to join ${appName} — a secure email platform for organisations.

To get started, sign in with your email address. Choose your sign-in provider:

- Microsoft: ${appUrl}/auth/login/microsoft
  (Use if your email is @hotmail, @live, @outlook, or a corporate Microsoft account)

- Google: ${appUrl}/auth/login/google
  (Use if your email is @gmail or a corporate Google Workspace account)

You can use any provider as long as you sign in with ${email}.
${mailboxBlockText}
Security note: ${appName} uses your email address to verify your identity. We don't access your personal inbox, files, or search history. Only organisational communication through ${appName} will be managed here.

If you did not expect this invitation, you can safely ignore this email.

---
${appName} — Secure email for your organisation
© 2026 ${appName}. All rights reserved.`;

  return { subject, html, text };
}

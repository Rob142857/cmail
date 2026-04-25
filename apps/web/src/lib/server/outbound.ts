// Outbound email provider abstraction
// Auto-detects: Cloudflare Email Service > Resend > Postmark > disabled

export interface OutboundEmail {
  from: string;
  to: string | string[];
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface OutboundResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

type ProviderName = 'cloudflare' | 'resend' | 'postmark' | 'none';

export function detectProvider(env: Record<string, unknown>): ProviderName {
  // Cloudflare Email Service native binding takes priority
  if (env.EMAIL && typeof (env.EMAIL as Record<string, unknown>).send === 'function') return 'cloudflare';
  if (env.RESEND_API_KEY) return 'resend';
  if (env.POSTMARK_API_KEY) return 'postmark';
  return 'none';
}

export function getProviderInfo(env: Record<string, unknown>): { name: ProviderName; label: string } {
  const name = detectProvider(env);
  const labels: Record<ProviderName, string> = {
    cloudflare: 'Cloudflare Email Service',
    resend: 'Resend',
    postmark: 'Postmark',
    none: 'Disabled (internal only)',
  };
  return { name, label: labels[name] };
}

export async function sendEmail(email: OutboundEmail, env: Record<string, unknown>): Promise<OutboundResult> {
  const provider = detectProvider(env);

  switch (provider) {
    case 'cloudflare':
      return sendViaCloudflare(email, env);
    case 'resend':
      return sendViaResend(email, env.RESEND_API_KEY as string);
    case 'postmark':
      return sendViaPostmark(email, env.POSTMARK_API_KEY as string);
    case 'none':
      return { success: false, provider: 'none', error: 'No outbound provider configured' };
  }
}

// ─── Cloudflare Email Service ────────────────────────────
async function sendViaCloudflare(email: OutboundEmail, env: Record<string, unknown>): Promise<OutboundResult> {
  try {
    // Dynamic import for mimetext — used to construct raw MIME
    const { createMimeMessage } = await import('mimetext');
    const { EmailMessage } = await import('cloudflare:email') as { EmailMessage: new (from: string, to: string, raw: string) => { readonly from: string; readonly to: string } };

    const recipients = Array.isArray(email.to) ? email.to : [email.to];
    const results: OutboundResult[] = [];

    for (const recipient of recipients) {
      const msg = createMimeMessage();
      msg.setSender(email.from);
      msg.setRecipient(recipient);
      msg.setSubject(email.subject);
      if (email.text) msg.addMessage({ contentType: 'text/plain', data: email.text });
      msg.addMessage({ contentType: 'text/html', data: email.html });
      if (email.replyTo) msg.setHeader('Reply-To', email.replyTo);
      if (email.headers) {
        for (const [k, v] of Object.entries(email.headers)) {
          msg.setHeader(k, v);
        }
      }

      const message = new EmailMessage(email.from, recipient, msg.asRaw());
      await (env.EMAIL as { send: (m: unknown) => Promise<void> }).send(message);
      results.push({ success: true, provider: 'cloudflare' });
    }

    return { success: true, provider: 'cloudflare', messageId: crypto.randomUUID() };
  } catch (e) {
    return { success: false, provider: 'cloudflare', error: (e as Error).message };
  }
}

// ─── Resend ──────────────────────────────────────────────
async function sendViaResend(email: OutboundEmail, apiKey: string): Promise<OutboundResult> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: email.from,
        to: Array.isArray(email.to) ? email.to : [email.to],
        cc: email.cc,
        subject: email.subject,
        html: email.html,
        text: email.text,
        reply_to: email.replyTo,
        headers: email.headers,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, provider: 'resend', error: `Resend API error (${res.status}): ${text}` };
    }

    const data = await res.json() as { id: string };
    return { success: true, provider: 'resend', messageId: data.id };
  } catch (e) {
    return { success: false, provider: 'resend', error: (e as Error).message };
  }
}

// ─── Postmark ────────────────────────────────────────────
async function sendViaPostmark(email: OutboundEmail, apiKey: string): Promise<OutboundResult> {
  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': apiKey,
      },
      body: JSON.stringify({
        From: email.from,
        To: Array.isArray(email.to) ? email.to.join(',') : email.to,
        Cc: email.cc?.join(','),
        Subject: email.subject,
        HtmlBody: email.html,
        TextBody: email.text,
        ReplyTo: email.replyTo,
        MessageStream: 'outbound',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, provider: 'postmark', error: `Postmark API error (${res.status}): ${text}` };
    }

    const data = await res.json() as { MessageID: string };
    return { success: true, provider: 'postmark', messageId: data.MessageID };
  } catch (e) {
    return { success: false, provider: 'postmark', error: (e as Error).message };
  }
}

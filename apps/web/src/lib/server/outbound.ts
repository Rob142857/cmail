// Outbound email provider abstraction
// Auto-detects: Cloudflare Worker > Resend > Postmark > disabled

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

type ProviderName = 'cloudflare-worker' | 'resend' | 'postmark' | 'none';

export function detectProvider(env: Record<string, unknown>): ProviderName {
  // Cloudflare Worker relay (has EMAIL_WORKER_URL env var)
  if (env.EMAIL_WORKER_URL && env.EMAIL_API_KEY) return 'cloudflare-worker';
  if (env.RESEND_API_KEY) return 'resend';
  if (env.POSTMARK_API_KEY) return 'postmark';
  return 'none';
}

export function getProviderInfo(env: Record<string, unknown>): { name: ProviderName; label: string } {
  const name = detectProvider(env);
  const labels: Record<ProviderName, string> = {
    'cloudflare-worker': 'Cloudflare Email Worker',
    resend: 'Resend',
    postmark: 'Postmark',
    none: 'Disabled (internal only)',
  };
  return { name, label: labels[name] };
}

export async function sendEmail(email: OutboundEmail, env: Record<string, unknown>): Promise<OutboundResult> {
  const provider = detectProvider(env);

  switch (provider) {
    case 'cloudflare-worker':
      return sendViaCloudflareWorker(email, env);
    case 'resend':
      return sendViaResend(email, env.RESEND_API_KEY as string);
    case 'postmark':
      return sendViaPostmark(email, env.POSTMARK_API_KEY as string);
    case 'none':
      return { success: false, provider: 'none', error: 'No outbound provider configured' };
  }
}

// ─── Cloudflare Worker Relay ────────────────────────────
async function sendViaCloudflareWorker(email: OutboundEmail, env: Record<string, unknown>): Promise<OutboundResult> {
  try {
    const workerUrl = env.EMAIL_WORKER_URL as string;
    const apiKey = env.EMAIL_API_KEY as string;
    if (!apiKey) {
      return { success: false, provider: 'cloudflare-worker', error: 'EMAIL_API_KEY not configured' };
    }
    if (!workerUrl) {
      return { success: false, provider: 'cloudflare-worker', error: 'EMAIL_WORKER_URL not configured' };
    }
    const res = await fetch(`${workerUrl}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: email.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    console.log('[WORKER] Response:', res.status, res.statusText);

    if (!res.ok) {
      const text = await res.text();
      return { success: false, provider: 'cloudflare-worker', error: `Worker API error (${res.status}): ${text}` };
    }

    const data = await res.json() as { success: boolean };
    return { success: data.success ?? true, provider: 'cloudflare-worker', messageId: crypto.randomUUID() };
  } catch (e) {
    return { success: false, provider: 'cloudflare-worker', error: (e as Error).message };
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

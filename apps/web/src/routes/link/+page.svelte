<script lang="ts">
  import Icon from '$lib/ui/Icon.svelte';

  let { data } = $props();

  const explanation = $derived(
    data.risk === 'punycode'
      ? 'This address uses internationalised characters. Those can be chosen to look almost identical to a familiar brand — a Cyrillic "а" in place of a Latin "a", for example.'
      : 'The text of this link named one website, but the link points somewhere else. That is the most common way a phishing message disguises its destination.',
  );
</script>

<svelte:head>
  <title>Check this link · {data.appName || 'cmail'}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main id="main-content" class="link-page" tabindex="-1">
  <section class="card link-card" aria-labelledby="link-heading">
    <div class="risk-mark" aria-hidden="true"><Icon name="warning" size={22} /></div>
    <p class="eyebrow">Link check</p>
    <h1 id="link-heading">Check this link before you continue</h1>
    <p class="intro">{explanation}</p>

    <div class="destination">
      <p class="destination-label" id="destination-host-label">This link actually goes to</p>
      <p class="destination-host" aria-labelledby="destination-host-label">{data.host}</p>
      <p class="destination-full">{data.href}</p>
    </div>

    {#if data.insecure}
      <p class="notice" role="note">
        This link is not encrypted (<code>http://</code>). Anything you type on that page can be
        read in transit.
      </p>
    {/if}

    <div class="actions">
      <a class="btn btn-outline" href="/mail">Back to mail</a>
      <a
        class="btn btn-primary"
        href={data.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
      >Continue anyway</a>
    </div>

    <p class="safety-note">
      cmail never asks for your password by email. If this link claims to be a sign-in page for a
      service you use, open that service directly instead of following it.
    </p>
  </section>
</main>

<style>
  .link-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .link-card { width: min(100%, 520px); padding: 32px; }
  .risk-mark {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    margin-bottom: 14px;
    border-radius: 50%;
    background: var(--warning-soft);
    color: var(--warning);
  }
  .eyebrow {
    margin: 0 0 5px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: .06em;
  }
  h1 { margin: 0; font-size: 23px; }
  .intro { margin: 9px 0 20px; color: var(--text-muted); line-height: 1.55; }

  .destination {
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }
  .destination-label {
    margin: 0 0 4px;
    font-size: 11.5px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: var(--text-muted);
  }
  .destination-host {
    margin: 0 0 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 17px;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  /* The full URL is shown, never truncated — a hidden tail is where the
     misdirection usually lives. */
  .destination-full {
    margin: 0;
    max-height: 8.5em;
    overflow-y: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .notice {
    margin: 16px 0 0;
    padding: 11px 12px;
    border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
    border-radius: var(--radius);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: 13px;
    line-height: 1.45;
  }
  .notice code { font-size: .92em; }

  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
  .actions .btn { flex: 1 1 auto; text-align: center; }

  .safety-note {
    margin: 20px 0 0;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--warning-soft);
    color: var(--text);
    font-size: 12px;
    line-height: 1.45;
  }
</style>

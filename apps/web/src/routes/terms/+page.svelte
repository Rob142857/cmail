<script lang="ts">
  import { page } from '$app/state';

  const name = $derived(page.data?.orgName || page.data?.appName || 'This organisation');
  const appName = $derived(page.data?.appName || 'cmail');
  const supportEmail = $derived(page.data?.supportEmail || '');
</script>

<svelte:head>
  <title>Service terms · {appName}</title>
  <meta name="description" content={`Service information and terms for ${appName}.`} />
</svelte:head>

<main id="main-content" class="notice" tabindex="-1">
  <a class="back" href="/">← Back to sign in</a>
  <article class="card">
    <p class="eyebrow">Public information</p>
    <h1>Service terms</h1>
    <p>{appName} is an organisational email service operated by {name}.</p>

    <h2>Access</h2>
    <p>Access is provided to people who have been invited and enrolled by the organisation. Each person signs in using their own identity-provider account; shared access is granted through mailbox assignments, not shared passwords.</p>

    <h2>Use of the service</h2>
    <p>Use the service for authorised organisational communication and follow the organisation’s current usage policies and instructions. The organisation may publish an in-service usage policy that users must accept before mailbox access.</p>

    <h2>Third-party services</h2>
    <p>Google or Microsoft sign-in, and the hosting, routing, storage and delivery services selected for this deployment, are provided under their respective terms and policies.</p>

    <h2>Contact</h2>
    {#if supportEmail}
      <p>For service questions, contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>
    {:else}
      <p>For service questions, contact the organisation operating this deployment.</p>
    {/if}

    <p class="fine-print">These public service terms describe the application at a high level. They do not replace any applicable agreement, organisational policy or legal requirement.</p>
  </article>
</main>

<style>
  .notice { width: min(100% - 32px, 760px); margin: 0 auto; padding: 40px 0 64px; }
  .back { display: inline-block; margin-bottom: 18px; color: var(--text-muted); font-size: 13px; }
  article { padding: 30px; }
  .eyebrow { margin: 0 0 6px; color: var(--primary); font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  h1 { margin: 0 0 14px; font-size: 28px; }
  h2 { margin: 28px 0 8px; font-size: 17px; }
  p { color: var(--text-muted); line-height: 1.65; }
  h1 + p { color: var(--text); font-size: 16px; }
  a { color: var(--primary); }
  .fine-print { margin-top: 28px; padding-top: 18px; border-top: 1px solid var(--border); font-size: 12px; }
  @media (max-width: 600px) { .notice { width: min(100% - 24px, 760px); padding-top: 20px; } article { padding: 20px; } }
</style>

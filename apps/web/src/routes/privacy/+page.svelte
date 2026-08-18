<script lang="ts">
  import { page } from '$app/state';

  const name = $derived(page.data?.orgName || page.data?.appName || 'This organisation');
  const appName = $derived(page.data?.appName || 'cmail');
  const supportEmail = $derived(page.data?.supportEmail || '');
</script>

<svelte:head>
  <title>Privacy notice · {appName}</title>
  <meta name="description" content={`Privacy information for ${appName}.`} />
</svelte:head>

<main id="main-content" class="notice" tabindex="-1">
  <a class="back" href="/">← Back to sign in</a>
  <article class="card">
    <p class="eyebrow">Public information</p>
    <h1>Privacy notice</h1>
    <p>This notice explains the information handled when you use {appName}, the organisational email service operated by {name}.</p>

    <h2>Identity and sign-in</h2>
    <p>{appName} authenticates invited users via Google or Microsoft. It requests the <code>openid</code>, <code>email</code> and <code>profile</code> scopes and receives a stable account identifier, an email address and a name. Google may also return a profile-picture claim, but cmail does not store it. Microsoft supplies a provider-asserted email address without a separate <code>email_verified</code> claim.</p>
    <p>The service stores the identity provider and stable account identifier needed to bind future sign-ins to the invited account. It may store the email address and name when provisioning or completing that account. OAuth access and refresh tokens are not retained. These identity details are used for authentication and access control, not advertising or sale. The service does not request access to a personal inbox, Drive, contacts, files or search history.</p>

    <h2>Mail service information</h2>
    <p>The service handles the mailbox addresses, messages, attachments, contacts and settings needed to provide assigned personal and shared mailboxes. It also records session, security and audit information needed to operate and protect the service.</p>

    <h2>Service providers</h2>
    <p>Google or Microsoft processes the sign-in request. The account binding is stored in the deployment’s hosting environment and shared only with the providers needed to operate the service. The deployment operator selects and configures the hosting, storage, mail-routing and delivery providers. Their own terms and privacy information apply to their services.</p>

    <h2>Questions about this deployment</h2>
    {#if supportEmail}
      <p>For privacy or account questions, contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>
    {:else}
      <p>For privacy or account questions, contact the organisation operating this deployment.</p>
    {/if}

    <p class="fine-print">The organisation operating this deployment is responsible for its own privacy decisions, notices, retention settings and applicable legal obligations. This notice describes the service’s current product behaviour and should be reviewed when the deployment configuration changes.</p>
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

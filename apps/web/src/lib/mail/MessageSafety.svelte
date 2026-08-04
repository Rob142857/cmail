<script lang="ts">
  import Icon from '$lib/ui/Icon.svelte';
  import type { Message } from '@cmail/shared/types';
  import type { LinkRisk } from '@cmail/shared/link-risk';

  /** Only what the banner renders. Full hrefs stay on the server. */
  type LinkFinding = { risk: LinkRisk; host: string };

  let {
    message,
    riskyLinks = [] as LinkFinding[],
  }: { message: Message; riskyLinks?: LinkFinding[] } = $props();

  // Only inbound mail carries these signals. Drafts and sent items would show
  // a permanent, meaningless "first contact" on every new correspondent.
  const inbound = $derived(message.direction === 'inbound');
  const quarantined = $derived(inbound && message.folder === 'spam');
  const firstContact = $derived(inbound && message.sender_first_contact === 1);
  const disguised = $derived(riskyLinks.filter((link) => link.risk === 'mismatch'));
  const homograph = $derived(riskyLinks.filter((link) => link.risk === 'punycode'));
  const hasLinkRisk = $derived(inbound && riskyLinks.length > 0);

  function hostList(links: LinkFinding[]): string {
    const hosts = [...new Set(links.map((link) => link.host))];
    return hosts.length > 3
      ? `${hosts.slice(0, 3).join(', ')} and ${hosts.length - 3} more`
      : hosts.join(', ');
  }
</script>

{#if quarantined || firstContact || hasLinkRisk}
  <div class="safety" role="note" aria-label="Message safety">
    {#if quarantined}
      <div class="bar bar-danger">
        <span class="bar-icon"><Icon name="junk" size={16} /></span>
        <span class="bar-text">
          <strong>This message was filed as junk.</strong>
          It scored at or above the quarantine threshold for this organisation. Nothing was
          deleted — move it to the inbox if it is legitimate.
        </span>
      </div>
    {/if}

    {#if hasLinkRisk}
      <div class="bar bar-warning">
        <span class="bar-icon"><Icon name="warning" size={16} /></span>
        <span class="bar-text">
          {#if disguised.length}
            <strong>
              {disguised.length === 1 ? 'A link in this message is disguised.' : `${disguised.length} links in this message are disguised.`}
            </strong>
            The text names one website but the link goes to <code>{hostList(disguised)}</code>.
          {/if}
          {#if homograph.length}
            <strong class:spaced={disguised.length > 0}>
              {homograph.length === 1 ? 'A link uses look-alike characters.' : `${homograph.length} links use look-alike characters.`}
            </strong>
            <code>{hostList(homograph)}</code> can be made to resemble a familiar brand.
          {/if}
          Following one of these opens a check page showing the real destination first.
        </span>
      </div>
    {/if}

    {#if firstContact}
      <div class="bar bar-info">
        <span class="bar-icon"><Icon name="people" size={16} /></span>
        <span class="bar-text">
          <strong>First message from this sender.</strong>
          You have not corresponded with <code>{message.from_address}</code> before. Treat
          requests for payment, credentials, or urgency with extra care.
        </span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .safety { display: flex; flex-direction: column; gap: 8px; margin: 0 0 14px; }

  .bar {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 13px;
    line-height: 1.5;
  }
  .bar-icon { display: flex; flex: 0 0 auto; margin-top: 1px; }
  .bar-text { min-width: 0; overflow-wrap: anywhere; }
  .bar-text strong { font-weight: 650; }
  .bar-text strong.spaced::before { content: ' '; }
  .bar code { font-size: .92em; overflow-wrap: anywhere; }

  /* Severity reads from colour and order: junk first, then link risk, then the
     purely informational first-contact note. */
  .bar-danger {
    border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
    background: var(--danger-soft);
    color: var(--danger);
  }
  .bar-warning {
    border-color: color-mix(in srgb, var(--warning) 35%, var(--border));
    background: var(--warning-soft);
    color: var(--text);
  }
  .bar-warning .bar-icon { color: var(--warning); }
  .bar-info {
    background: var(--primary-soft);
    border-color: var(--primary-border);
    color: var(--text);
  }
  .bar-info .bar-icon { color: var(--primary); }
</style>

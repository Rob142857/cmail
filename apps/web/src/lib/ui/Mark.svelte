<!--
  Mark — the cmail app symbol.

  A Fluent-proportioned rounded square carrying an open envelope drawn in one
  continuous stroke, with a cyan status dot breaking the top-right corner.
  The dot is the same one that tittles the "i" in the wordmark.

  `tone="onDark"` swaps the tile for a translucent plate so the mark sits
  correctly on the brand-coloured suite header without a hard edge.
-->
<script>
  /** @type {{ size?: number, tone?: 'brand' | 'onDark', id?: string, class?: string }} */
  let { size = 28, tone = 'brand', id = 'mk', class: klass = '' } = $props();
</script>

<svg
  class={klass}
  width={size}
  height={size}
  viewBox="0 0 64 64"
  role="img"
  aria-label="cmail"
  focusable="false"
  style="display: block;"
>
  <defs>
    <linearGradient id="{id}-tile" x1="0" y1="0" x2="0.85" y2="1">
      <stop offset="0%" stop-color="#2b88d8" />
      <stop offset="55%" stop-color="#0078d4" />
      <stop offset="100%" stop-color="#005a9e" />
    </linearGradient>
    <linearGradient id="{id}-gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.26" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
    </linearGradient>
  </defs>

  {#if tone === 'onDark'}
    <rect x="0" y="0" width="64" height="64" rx="15" fill="#ffffff" fill-opacity="0.13" />
  {:else}
    <rect x="0" y="0" width="64" height="64" rx="15" fill="url(#{id}-tile)" />
    <path d="M0 15A15 15 0 0 1 15 0h34a15 15 0 0 1 15 15v13H0z" fill="url(#{id}-gloss)" />
  {/if}

  <!-- envelope: body then flap, single weight, open apertures -->
  <g fill="none" stroke="#ffffff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 25.5v20.2a2.8 2.8 0 0 0 2.8 2.8h32.4a2.8 2.8 0 0 0 2.8-2.8V25.5" />
    <path d="M13 25.5 30.3 38a2.9 2.9 0 0 0 3.4 0L51 25.5" />
    <path d="M13 25.5 30.3 13a2.9 2.9 0 0 1 3.4 0L51 25.5" />
  </g>

  <!-- status dot — the wordmark's tittle. Placed clear of the flap so it
       never needs a knockout ring, which would seam against the plate. -->
  <circle cx="51" cy="13" r="6" fill="#50e6ff" />
</svg>

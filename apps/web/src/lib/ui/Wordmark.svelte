<!--
  Wordmark — "cmail" drawn as geometric monoline letterforms.

  The letters are constructed, not typeset: every curve is a circle of the
  same radius as the x-height, every stem is the same weight, and the whole
  thing is one stroke width. That means it renders pixel-identically on every
  OS with no webfont (our CSP forbids remote fonts anyway) and stays crisp
  from a 16px favicon to a billboard.

  The tittle over the "i" is the one piece of colour — the same cyan dot that
  sits on the app mark, so the symbol and the word are visibly the same
  family. Everything else inherits `currentColor`.

  Grid:  baseline y=56 · x-height top y=22 · ascender y=8 · stroke 6.5
-->
<script>
  /**
   * @type {{
   *   height?: number,
   *   accent?: string,
   *   gradient?: boolean,
   *   class?: string,
   *   id?: string,
   * }}
   */
  let { height = 26, accent = '#50e6ff', gradient = false, class: klass = '', id = 'wm' } = $props();

  const W = 169;
  const H = 64;
  const width = $derived(Math.round((height * W) / H));
  const paint = $derived(gradient ? `url(#${id}-grad)` : 'currentColor');
</script>

<svg
  class={klass}
  width={width}
  height={height}
  viewBox="0 0 169 64"
  role="img"
  aria-label="cmail"
  focusable="false"
  style="display: block; overflow: visible;"
>
  {#if gradient}
    <defs>
      <!-- userSpaceOnUse is required: the stems are zero-width paths, and an
           objectBoundingBox gradient on a zero-width box is degenerate, which
           makes those glyphs disappear entirely. -->
      <!-- Derived from --primary so a whitelabel deployment's own brand colour
           carries through the wordmark rather than being overridden by it. -->
      <linearGradient id="{id}-grad" gradientUnits="userSpaceOnUse" x1="0" y1="8" x2="169" y2="56">
        <stop offset="0%" stop-color="color-mix(in srgb, var(--primary) 84%, black)" />
        <stop offset="62%" stop-color="var(--primary)" />
        <stop offset="100%" stop-color="color-mix(in srgb, var(--primary) 74%, white)" />
      </linearGradient>
    </defs>
  {/if}
  <g
    fill="none"
    stroke={paint}
    stroke-width="6.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <!-- c — an x-height circle opened at ±38° -->
    <path d="M33.65 28.53 A17 17 0 1 0 33.65 49.47" />
    <!-- m — one stem, two shoulders of equal radius -->
    <path d="M47 56 V32 A10 10 0 0 1 67 32 V56 M67 32 A10 10 0 0 1 87 32 V56" />
    <!-- a — the same x-height circle, with the stem tangent to its right -->
    <circle cx="117.5" cy="39" r="17" />
    <path d="M134.5 22 V56" />
    <!-- i -->
    <path d="M150 22 V56" />
    <!-- l -->
    <path d="M165.5 8 V56" />
  </g>
  <!-- the tittle: the mark's accent dot, reused -->
  <circle cx="150" cy="11" r="3.75" fill={accent} />
</svg>

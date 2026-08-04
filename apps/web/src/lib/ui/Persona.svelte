<!--
  Persona — initials avatar.

  The colour is derived from the address, so the same correspondent always
  gets the same swatch and the list becomes scannable by colour before it is
  read. Palette is a muted Fluent set chosen to hold AA contrast against
  white text in light mode and against near-black in dark mode.
-->
<script>
  /**
   * @type {{
   *   name?: string,
   *   email?: string,
   *   size?: 'sm' | 'md' | 'lg' | 'xl',
   *   title?: string,
   * }}
   */
  let { name = '', email = '', size = 'md', title = '' } = $props();

  // Fluent-ish persona palette: [background, foreground]
  const PALETTE = [
    ['#a4262c', '#fff'], ['#ca5010', '#fff'], ['#986f0b', '#fff'],
    ['#0b6a0b', '#fff'], ['#038387', '#fff'], ['#005b70', '#fff'],
    ['#0f6cbd', '#fff'], ['#4f52b2', '#fff'], ['#8764b8', '#fff'],
    ['#77004d', '#fff'], ['#b146c2', '#fff'], ['#005e50', '#fff'],
  ];

  /** @param {string} s */
  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  /** Strip "Display Name <addr>" down to whichever part reads best. */
  const label = $derived.by(() => {
    const raw = (name || email || '').trim();
    const m = raw.match(/^\s*"?(.*?)"?\s*<([^>]+)>\s*$/);
    return (m ? m[1] || m[2] : raw) || '?';
  });

  const initials = $derived.by(() => {
    const cleaned = label.replace(/[^\p{L}\p{N} .@_-]/gu, ' ').trim();
    if (!cleaned) return '?';
    // An address: use the first two letter-runs of the local part.
    if (cleaned.includes('@') && !cleaned.includes(' ')) {
      const local = cleaned.split('@')[0];
      const parts = local.split(/[._-]+/).filter(Boolean);
      return (parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2)).toUpperCase();
    }
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  });

  const swatch = $derived(PALETTE[hash((email || label).toLowerCase()) % PALETTE.length]);
</script>

<span
  class="persona persona-{size}"
  style="background: {swatch[0]}; color: {swatch[1]};"
  title={title || label}
  aria-hidden="true"
>{initials}</span>

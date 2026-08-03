<script lang="ts">
  type IconName = 'home' | 'people' | 'mail' | 'org' | 'policy' | 'audit' | 'trace' | 'settings' | 'back' | 'menu';

  let { name, size = 18 } = $props<{ name: IconName; size?: number }>();
</script>

<svg
  aria-hidden="true"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  {#if name === 'home'}
    <path d="m3 10 9-7 9 7" />
    <path d="M5 9v11h14V9M9 20v-7h6v7" />
  {:else if name === 'people'}
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  {:else if name === 'mail'}
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  {:else if name === 'org'}
    <rect x="8" y="2.5" width="8" height="5" rx="1" />
    <rect x="2.5" y="16.5" width="7" height="5" rx="1" />
    <rect x="14.5" y="16.5" width="7" height="5" rx="1" />
    <path d="M12 7.5v4M6 16.5v-2h12v2" />
  {:else if name === 'policy'}
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  {:else if name === 'audit'}
    <path d="M9 4H5v17h14V4h-4" />
    <rect x="9" y="2" width="6" height="4" rx="1" />
    <path d="m9 13 2 2 4-5" />
  {:else if name === 'trace'}
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2M3 12H1M23 12h-2" />
  {:else if name === 'settings'}
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21H9.6v-.08A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H2V9.6h.5A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V2h4v.5A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1 .4h.5v4H21a1.7 1.7 0 0 0-1.6 1.1Z" />
  {:else if name === 'back'}
    <path d="m15 18-6-6 6-6" />
  {:else}
    <path d="M4 7h16M4 12h16M4 17h16" />
  {/if}
</svg>

<!--
  Multi-select country picker for the organisation's approved sign-in
  countries (Admin > Settings). A searchable checkbox list plus removable
  chips for the current selection; submits one hidden input per chosen code
  under `name`, so the server reads it with `formData.getAll(name)`.
-->
<script lang="ts">
  import { COUNTRIES, countryName } from './countries';

  let {
    name = 'sign_in_countries',
    id = 'sign-in-countries',
    selected = [],
  }: {
    name?: string;
    id?: string;
    selected?: string[];
  } = $props();

  let chosen = $state<string[]>([...selected]);
  let query = $state('');

  const chosenSet = $derived(new Set(chosen));
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((country) => country.name.toLowerCase().includes(q) || country.code.toLowerCase() === q);
  });

  function toggle(code: string): void {
    chosen = chosenSet.has(code) ? chosen.filter((c) => c !== code) : [...chosen, code];
  }
</script>

<div class="country-picker">
  <input
    type="text"
    bind:value={query}
    placeholder="Search countries"
    aria-label="Search countries"
    aria-controls="{id}-list"
    autocomplete="off"
  />

  <div class="country-list" id="{id}-list" role="group" aria-label="Approved sign-in countries">
    {#each filtered as country (country.code)}
      <label class="country-option">
        <input type="checkbox" checked={chosenSet.has(country.code)} onchange={() => toggle(country.code)} />
        <span class="country-option-name">{country.name}</span>
        <span class="country-option-code">{country.code}</span>
      </label>
    {:else}
      <p class="empty">No countries match "{query}".</p>
    {/each}
  </div>

  {#if chosen.length}
    <div class="chips" aria-label="Selected countries">
      {#each chosen as code (code)}
        <span class="chip">
          {countryName(code)}
          <button type="button" onclick={() => toggle(code)} aria-label="Remove {countryName(code)}">×</button>
        </span>
      {/each}
    </div>
  {:else}
    <p class="hint">No restriction — sign-in is allowed from every country.</p>
  {/if}

  {#each chosen as code (code)}
    <input type="hidden" {name} value={code} />
  {/each}
</div>

<style>
  .country-picker { display: grid; gap: 8px; }
  .country-list {
    display: grid;
    gap: 1px;
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-surface);
    padding: 4px;
  }
  .country-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 13px;
  }
  .country-option:hover { background: var(--bg-hover); }
  .country-option input[type='checkbox'] { flex: 0 0 auto; }
  .country-option-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .country-option-code { flex: 0 0 auto; color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; }
  .empty { padding: 10px 8px; color: var(--text-muted); font-size: 12px; }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px 3px 10px;
    border: 1px solid var(--primary-border);
    border-radius: var(--radius-pill);
    background: var(--primary-soft);
    color: var(--primary-text);
    font-size: 12px;
    font-weight: 600;
  }
  .chip button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    min-height: 0;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  .chip button:hover { background: color-mix(in srgb, var(--primary) 24%, transparent); }
  .hint { color: var(--text-muted); font-size: 12px; }
</style>

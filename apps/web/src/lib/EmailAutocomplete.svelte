<!--
  EmailAutocomplete – typeahead for internal email addresses, optionally
  augmented with one mailbox's own recipient suggestion history (Outlook-
  style "who this mailbox has written to or heard from").
  Props:
    value       – bound two-way string value
    name        – form field name
    id          – element id
    placeholder – input placeholder
    required    – HTML required
    multi       – allow comma-separated list (To/CC mode)
    types       – optional contact types to include (for example ['user']);
                  applies to the org directory only, not mailbox history
    oninput     – optional callback when value changes
    mailbox     – optional mailbox address. When set, suggestions merge in
                  that mailbox's history via /api/contacts?mailbox=<address>
                  (re-fetched, and cached per address, whenever this changes)
-->
<script>
  import { matchContacts } from './contact-match';

  /** @type {{ value: string, name?: string, id?: string, placeholder?: string, required?: boolean, multi?: boolean, types?: string[], oninput?: () => void, mailbox?: string }} */
  let { value = $bindable(''), name = '', id = '', placeholder = '', required = false, multi = false, types = [], oninput, mailbox = '' } = $props();

  /** @type {Array<{ email: string; name: string; type: string }>} */
  let directory = $state([]);
  /** @type {import('./contact-match').ContactEntry[]} */
  let history = $state([]);
  let loaded = $state(false);
  let loadedKey = $state(/** @type {string | null} */ (null));
  /** @type {Map<string, import('./contact-match').ContactEntry[]>} */
  const historyCache = new Map();
  let open = $state(false);
  let activeIdx = $state(-1);

  /** @type {HTMLInputElement | null} */
  let inputEl = $state(null);
  /** @type {HTMLUListElement | null} */
  let listEl = $state(null);

  /** @param {{ address?: unknown; display_name?: unknown; times_used?: unknown; last_used_at?: unknown }} row */
  function toContactEntry(row) {
    return {
      address: String(row?.address || ''),
      name: String(row?.display_name || ''),
      timesUsed: Number(row?.times_used) || 0,
      lastUsedAt: String(row?.last_used_at || ''),
    };
  }

  async function ensureLoaded() {
    const key = mailbox || '';
    if (loaded && loadedKey === key) return;
    if (key && historyCache.has(key)) {
      // Directory data is org-wide (not mailbox-specific), so the copy from
      // whichever fetch loaded it last remains valid; only history varies.
      history = historyCache.get(key) || [];
      loaded = true;
      loadedKey = key;
      return;
    }
    loaded = true;
    loadedKey = key;
    try {
      const res = await fetch(key ? `/api/contacts?mailbox=${encodeURIComponent(key)}` : '/api/contacts');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        directory = data;
        history = [];
      } else {
        directory = data.directory || [];
        const entries = (data.history || []).map(toContactEntry);
        history = entries;
        if (key) historyCache.set(key, entries);
      }
    } catch { /* offline – no suggestions */ }
  }

  /** Extract the current token being typed (after last comma in multi mode) */
  function currentToken() {
    if (!multi) return value.trim().toLowerCase();
    const parts = value.split(',');
    return (parts[parts.length - 1] || '').trim().toLowerCase();
  }

  /** @type {import('./contact-match').ContactEntry[]} */
  let filtered = $derived.by(() => {
    const q = currentToken();
    if (!q || q.length < 1) return [];
    const directoryEntries = directory
      .filter(c => types.length === 0 || types.includes(c.type))
      .map(c => ({ address: c.email, name: c.name, timesUsed: 0, lastUsedAt: '' }));
    return matchContacts([...history, ...directoryEntries], q, 8);
  });

  /** @param {import('./contact-match').ContactEntry} contact */
  function pick(contact) {
    if (multi) {
      const parts = value.split(',').map(s => s.trim()).filter(Boolean);
      parts.pop(); // remove the partial token
      parts.push(contact.address);
      value = parts.join(', ') + ', ';
    } else {
      value = contact.address;
    }
    open = false;
    activeIdx = -1;
    oninput?.();
    // Re-focus so user can keep typing
    inputEl?.focus();
  }

  function handleInput() {
    ensureLoaded();
    open = true;
    activeIdx = -1;
    oninput?.();
  }

  function handleFocus() {
    ensureLoaded();
    if (currentToken()) open = true;
  }

  function handleBlur() {
    // Delay to allow click on suggestion to fire first
    setTimeout(() => { open = false; }, 180);
  }

  /** @param {KeyboardEvent} e */
  function handleKeydown(e) {
    if (!open || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = (activeIdx + 1) % filtered.length;
      scrollActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = activeIdx <= 0 ? filtered.length - 1 : activeIdx - 1;
      scrollActive();
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      pick(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      open = false;
      activeIdx = -1;
    }
  }

  function scrollActive() {
    if (!listEl) return;
    const item = listEl.children[activeIdx];
    if (item) item.scrollIntoView({ block: 'nearest' });
  }
</script>

<div class="ac-wrap">
  <input
    type="text"
    {name}
    {id}
    {placeholder}
    {required}
    bind:value
    bind:this={inputEl}
    oninput={handleInput}
    onfocus={handleFocus}
    onblur={handleBlur}
    onkeydown={handleKeydown}
    autocomplete="off"
    role="combobox"
    aria-expanded={open && filtered.length > 0}
    aria-autocomplete="list"
    aria-controls="{id}-list"
    aria-activedescendant={activeIdx >= 0 ? `${id}-option-${activeIdx}` : undefined}
  />
  {#if open && filtered.length > 0}
    <ul class="ac-list" id="{id}-list" role="listbox" bind:this={listEl}>
      {#each filtered as c, i}
        <li
          id="{id}-option-{i}"
          role="option"
          aria-selected={i === activeIdx}
          class:active={i === activeIdx}
          onmousedown={() => pick(c)}
        >
          <span class="ac-label">{c.name ? `${c.name} — ${c.address}` : c.address}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ac-wrap {
    position: relative;
    width: 100%;
  }
  .ac-wrap input {
    width: 100%;
  }
  .ac-list {
    position: absolute;
    z-index: 50;
    top: 100%;
    left: 0;
    right: 0;
    margin: 2px 0 0;
    padding: 4px 0;
    list-style: none;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius, 6px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    max-height: 220px;
    overflow-y: auto;
  }
  .ac-list li {
    display: flex;
    align-items: center;
    padding: 7px 12px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text);
  }
  .ac-list li:hover,
  .ac-list li.active {
    background: var(--bg-hover);
  }
  .ac-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

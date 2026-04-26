<!--
  EmailAutocomplete – typeahead for internal email addresses.
  Props:
    value       – bound two-way string value
    name        – form field name
    id          – element id
    placeholder – input placeholder
    required    – HTML required
    multi       – allow comma-separated list (To/CC mode)
    oninput     – optional callback when value changes
-->
<script>
  /** @type {{ value: string, name?: string, id?: string, placeholder?: string, required?: boolean, multi?: boolean, oninput?: () => void }} */
  let { value = $bindable(''), name = '', id = '', placeholder = '', required = false, multi = false, oninput } = $props();

  /** @type {Array<{ email: string; name: string; type: string }>} */
  let contacts = $state([]);
  let loaded = $state(false);
  let open = $state(false);
  let activeIdx = $state(-1);

  /** @type {HTMLInputElement | null} */
  let inputEl = $state(null);
  /** @type {HTMLUListElement | null} */
  let listEl = $state(null);

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    try {
      const res = await fetch('/api/contacts');
      if (res.ok) contacts = await res.json();
    } catch { /* offline – no suggestions */ }
  }

  /** Extract the current token being typed (after last comma in multi mode) */
  function currentToken() {
    if (!multi) return value.trim().toLowerCase();
    const parts = value.split(',');
    return (parts[parts.length - 1] || '').trim().toLowerCase();
  }

  /** @type {Array<{ email: string; name: string; type: string }>} */
  let filtered = $derived.by(() => {
    const q = currentToken();
    if (!q || q.length < 1) return [];
    return contacts.filter(c =>
      c.email.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q)
    ).slice(0, 8);
  });

  /** @param {{ email: string; name: string; type: string }} contact */
  function pick(contact) {
    if (multi) {
      const parts = value.split(',').map(s => s.trim()).filter(Boolean);
      parts.pop(); // remove the partial token
      parts.push(contact.email);
      value = parts.join(', ') + ', ';
    } else {
      value = contact.email;
    }
    open = false;
    activeIdx = -1;
    oninput?.();
    // Re-focus so user can keep typing
    inputEl?.focus();
  }

  /** @param {Event} e */
  function handleInput(e) {
    ensureLoaded();
    open = true;
    activeIdx = -1;
    oninput?.();
  }

  /** @param {FocusEvent} e */
  function handleFocus(e) {
    ensureLoaded();
    if (currentToken()) open = true;
  }

  /** @param {FocusEvent} e */
  function handleBlur(e) {
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
  />
  {#if open && filtered.length > 0}
    <ul class="ac-list" id="{id}-list" role="listbox" bind:this={listEl}>
      {#each filtered as c, i}
        <li
          role="option"
          aria-selected={i === activeIdx}
          class:active={i === activeIdx}
          onmousedown={() => pick(c)}
        >
          <span class="ac-email">{c.email}</span>
          {#if c.name}
            <span class="ac-name">{c.name}</span>
          {/if}
          {#if c.type === 'shared'}
            <span class="ac-badge">shared</span>
          {/if}
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
    background: var(--bg-card, #fff);
    border: 1px solid var(--border, #d1d5db);
    border-radius: var(--radius, 6px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    max-height: 220px;
    overflow-y: auto;
  }
  .ac-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  .ac-list li:hover,
  .ac-list li.active {
    background: var(--bg-hover, #f3f4f6);
  }
  .ac-email {
    font-weight: 500;
  }
  .ac-name {
    color: var(--text-muted, #6b7280);
    font-size: 12px;
  }
  .ac-badge {
    margin-left: auto;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--accent-soft, #dbeafe);
    color: var(--accent, #2563eb);
    font-weight: 600;
  }
</style>

<!--
  Manager-only mailbox assignee picker. Suggestions are fetched on demand and
  the form receives only the immutable cmail user id after an explicit pick.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';

  interface MailboxAssignee {
    userId: string;
    displayName: string;
    mailboxAddress: string;
  }

  type SearchState = 'idle' | 'waiting' | 'loading' | 'ready' | 'error';

  let {
    endpoint = '/admin/mailboxes/assignees',
    excludedUserIds = [],
    name = 'user_id',
    id = '',
    placeholder = 'Start typing a name or mailbox address',
    required = false,
  }: {
    endpoint?: string;
    excludedUserIds?: string[];
    name?: string;
    id?: string;
    placeholder?: string;
    required?: boolean;
  } = $props();

  let query = $state('');
  let selected = $state<MailboxAssignee | null>(null);
  let results = $state<MailboxAssignee[]>([]);
  let searchState = $state<SearchState>('idle');
  let open = $state(false);
  let activeIndex = $state(-1);
  let input = $state<HTMLInputElement | null>(null);
  let list = $state<HTMLUListElement | null>(null);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let requestSequence = 0;

  const availableResults = $derived(results.filter(
    (candidate) => !excludedUserIds.includes(candidate.userId),
  ));

  function isMailboxAssignee(value: unknown): value is MailboxAssignee {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.userId === 'string'
      && typeof candidate.displayName === 'string'
      && typeof candidate.mailboxAddress === 'string';
  }

  function optionId(candidate: MailboxAssignee): string {
    return `${id}-option-${encodeURIComponent(candidate.userId)}`;
  }

  function clearScheduledSearch(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    controller?.abort();
    controller = null;
    requestSequence += 1;
  }

  function updateValidity(): void {
    if (!input) return;
    input.setCustomValidity(!selected && query.trim()
      ? 'Choose a person from the results list.'
      : '');
  }

  async function runSearch(searchQuery: string): Promise<void> {
    const sequence = ++requestSequence;
    const searchController = new AbortController();
    controller?.abort();
    controller = searchController;
    searchState = 'loading';
    open = true;

    try {
      const separator = endpoint.includes('?') ? '&' : '?';
      const response = await fetch(
        `${endpoint}${separator}q=${encodeURIComponent(searchQuery)}`,
        {
          headers: { Accept: 'application/json' },
          signal: searchController.signal,
        },
      );
      if (!response.ok) throw new Error('assignee search failed');
      const payload: unknown = await response.json();
      if (!Array.isArray(payload) || !payload.every(isMailboxAssignee)) {
        throw new Error('invalid assignee search response');
      }
      if (sequence !== requestSequence || query.trim() !== searchQuery) return;
      results = payload.slice(0, 8);
      activeIndex = -1;
      searchState = 'ready';
    } catch {
      if (searchController.signal.aborted || sequence !== requestSequence) return;
      results = [];
      activeIndex = -1;
      searchState = 'error';
    } finally {
      if (sequence === requestSequence) controller = null;
    }
  }

  function scheduleSearch(event: Event): void {
    query = (event.currentTarget as HTMLInputElement).value;
    clearScheduledSearch();
    selected = null;
    results = [];
    activeIndex = -1;
    updateValidity();

    const searchQuery = query.trim().slice(0, 100);
    if (!searchQuery) {
      open = false;
      searchState = 'idle';
      return;
    }

    open = true;
    searchState = 'waiting';
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runSearch(searchQuery);
    }, 225);
  }

  function select(candidate: MailboxAssignee): void {
    clearScheduledSearch();
    selected = candidate;
    query = candidate.mailboxAddress;
    results = [];
    searchState = 'idle';
    open = false;
    activeIndex = -1;
    updateValidity();
    input?.focus();
  }

  function onFocus(): void {
    if (!selected && query.trim()) open = true;
  }

  function onBlur(): void {
    setTimeout(() => { open = false; }, 160);
  }

  function validateSelection(): void {
    updateValidity();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      open = false;
      activeIndex = -1;
      return;
    }
    if (!open || availableResults.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % availableResults.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = activeIndex <= 0 ? availableResults.length - 1 : activeIndex - 1;
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      select(availableResults[activeIndex]);
      return;
    }
    if (activeIndex >= 0) list?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  onDestroy(clearScheduledSearch);
</script>

<div class="picker">
  {#if selected}<input type="hidden" {name} value={selected.userId} />{/if}
  <div class="control">
    <input
      bind:this={input}
      {id}
      type="text"
      bind:value={query}
      maxlength="100"
      {placeholder}
      {required}
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open && availableResults.length > 0}
      aria-controls={`${id}-list`}
      aria-activedescendant={activeIndex >= 0 && availableResults[activeIndex]
        ? optionId(availableResults[activeIndex])
        : undefined}
      aria-describedby={`${id}-hint`}
      aria-busy={searchState === 'loading'}
      oninput={scheduleSearch}
      onfocus={onFocus}
      onblur={onBlur}
      onkeydown={onKeydown}
      oninvalid={validateSelection}
    />

    {#if open && availableResults.length > 0}
      <ul bind:this={list} id={`${id}-list`} role="listbox">
        {#each availableResults as candidate, index (candidate.userId)}
          <li
            id={optionId(candidate)}
            role="option"
            aria-selected={index === activeIndex}
            class:active={index === activeIndex}
            onmousedown={(event) => {
              event.preventDefault();
              select(candidate);
            }}
          >
            <span class="identity">
              <strong>{candidate.displayName || candidate.mailboxAddress}</strong>
              <small>{candidate.mailboxAddress}</small>
            </span>
          </li>
        {/each}
      </ul>
    {:else if open && searchState === 'loading'}
      <p class="search-status" role="status">Searching personal mailboxes…</p>
    {:else if open && searchState === 'ready'}
      <p class="search-status" role="status">No eligible personal mailboxes found.</p>
    {:else if open && searchState === 'error'}
      <p class="search-status search-error" role="status">Search is unavailable. Try again.</p>
    {/if}
  </div>
  <small id={`${id}-hint`}>Search active or pending people by name or their personal mailbox address.</small>
</div>

<style>
  .picker { display: grid; gap: 5px; }
  .control { position: relative; }
  .control > input { width: 100%; }
  .control ul, .search-status { position: absolute; z-index: 50; top: 100%; left: 0; right: 0; margin: 2px 0 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-surface); box-shadow: 0 8px 20px rgb(0 0 0 / .14); }
  .control ul { max-height: 250px; padding: 4px 0; overflow-y: auto; list-style: none; }
  .control li { padding: 8px 10px; cursor: pointer; }
  .control li:hover, .control li.active { background: var(--primary-soft); }
  .identity { display: grid; gap: 1px; }
  .identity strong { font-size: 12px; }
  .identity small, .picker > small { color: var(--text-muted); font-size: 10px; line-height: 1.35; }
  .search-status { padding: 8px 10px; color: var(--text-muted); font-size: 11px; }
  .search-error { color: var(--danger); }
</style>

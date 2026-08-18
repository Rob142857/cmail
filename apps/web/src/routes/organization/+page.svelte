<script lang="ts">
  let { data } = $props();
  let query = $state('');
  const filtered = $derived.by(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data.entries;
    return data.entries.filter((entry) =>
      [entry.occupantDisplayName, entry.positionTitle, entry.workEmail]
        .some((value) => value.toLowerCase().includes(normalized)));
  });
</script>

<svelte:head>
  <title>Organisation directory · {data.appName || 'cmail'}</title>
  <meta name="description" content={`Public position directory for ${data.orgName || 'this organisation'}.`} />
</svelte:head>

<main id="main-content" class="directory-page" tabindex="-1">
  <header class="directory-header">
    <a class="brand" href="/">
      <img src={data.brandIconUrl || '/icon.svg'} alt="" width="30" height="30" />
      <span>{data.orgName || data.appName || 'Organisation'}</span>
    </a>
    <div class="header-links">
      {#if data.orgUrl}<a href={data.orgUrl} rel="external">Website</a>{/if}
      <a class="btn" href="/">Sign in</a>
    </div>
  </header>

  <section class="directory-content" aria-labelledby="directory-title">
    <div class="heading">
      <p class="eyebrow">Public information</p>
      <h1 id="directory-title">Organisation directory</h1>
      <p>Only published positions appear here — no internal structure or personal details.</p>
    </div>

    {#if !data.enabled}
      <div class="card empty-state">
        <h2>The public directory is not available</h2>
        <p>This organisation hasn't enabled its public directory.</p>
      </div>
    {:else if data.entries.length === 0}
      <div class="card empty-state">
        <h2>No public positions are listed</h2>
        <p>No positions currently meet the publication requirements.</p>
      </div>
    {:else}
      <div class="directory-tools">
        <div class="search-control">
          <label for="directory-search">Search</label>
          <input id="directory-search" type="search" bind:value={query} placeholder="Name, position or work email" maxlength="120" />
        </div>
        <p aria-live="polite">{filtered.length} {filtered.length === 1 ? 'position' : 'positions'}</p>
      </div>

      {#if filtered.length}
        <ul class="directory-grid">
          {#each filtered as entry (`${entry.workEmail}-${entry.positionTitle}`)}
            <li class="card">
              <span class="avatar" aria-hidden="true">{entry.occupantDisplayName.slice(0, 1).toUpperCase()}</span>
              <div>
                <h2>{entry.occupantDisplayName}</h2>
                <p>{entry.positionTitle}</p>
                <a href={`mailto:${entry.workEmail}`}>{entry.workEmail}</a>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="card empty-state">
          <h2>No matching positions</h2>
          <p>Try a different name, title, or work email.</p>
          <button type="button" onclick={() => query = ''}>Clear search</button>
        </div>
      {/if}
    {/if}
  </section>

  <footer>
    <span>Public fields: name, position, and work email only.</span>
    <a href="/policy">Usage policy</a>
  </footer>
</main>

<style>
  .directory-page { width: min(1120px, calc(100% - 32px)); min-height: 100vh; min-height: 100dvh; margin: 0 auto; display: flex; flex-direction: column; }
  .directory-header { min-height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--border); }
  .brand { min-width: 0; display: flex; align-items: center; gap: 10px; color: var(--text); font-weight: 700; text-decoration: none; }
  .brand span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .header-links { display: flex; align-items: center; gap: 14px; font-size: 13px; }
  .directory-content { flex: 1; padding: 64px 0 70px; }
  .heading { max-width: 720px; }
  .eyebrow { margin: 0; color: var(--primary); font-size: 11px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
  h1 { margin: 5px 0 10px; font-size: clamp(30px, 5vw, 48px); }
  .heading > p:last-child { color: var(--text-muted); font-size: 16px; }
  .directory-tools { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin: 34px 0 16px; }
  .search-control { width: min(100%, 520px); display: grid; gap: 6px; }
  .search-control label { font-size: 13px; font-weight: 650; }
  .directory-tools > p { color: var(--text-muted); font-size: 13px; white-space: nowrap; }
  .directory-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
  .directory-grid li { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 13px; padding: 18px; }
  .avatar { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; background: var(--primary-soft); color: var(--primary); font-weight: 750; }
  .directory-grid h2 { margin: 0; font-size: 16px; }
  .directory-grid p { margin: 2px 0 5px; color: var(--text-muted); font-size: 13px; }
  .directory-grid a { overflow-wrap: anywhere; font-size: 13px; }
  .empty-state { margin-top: 30px; padding: 42px 24px; text-align: center; }
  .empty-state h2 { font-size: 20px; }
  .empty-state p { margin: 6px auto 16px; color: var(--text-muted); }
  footer { min-height: 66px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 12px; }
  @media (max-width: 700px) {
    .directory-content { padding: 42px 0 52px; }
    .directory-grid { grid-template-columns: 1fr; }
    .directory-tools { align-items: stretch; flex-direction: column; gap: 8px; }
    .header-links > a:first-child:not(.btn) { display: none; }
    footer { align-items: flex-start; flex-direction: column; justify-content: center; padding: 14px 0; }
  }
</style>

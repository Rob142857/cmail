<script lang="ts">
  import Icon from '$lib/ui/Icon.svelte';
  import SignatureEditor from '$lib/SignatureEditor.svelte';

  let { data, form } = $props();
  let search = $state('');
  const organisation = $derived(data.organisationSignature);
  const filteredUsers = $derived((data.users || []).filter((user: { email: string; displayName: string }) => {
    const query = search.trim().toLowerCase();
    return !query || `${user.displayName || ''} ${user.email}`.toLowerCase().includes(query);
  }));

  function signatureState(user: { personalSignature: { html: string; locked: boolean } | null }): string {
    if (user.personalSignature?.locked) return 'Admin managed';
    if (user.personalSignature?.html) return 'User managed';
    return 'Not configured';
  }
</script>

<section class="admin-page" aria-labelledby="signatures-heading">
  <header class="page-header">
    <div>
      <p class="eyebrow">Mail</p>
      <h1 id="signatures-heading">Email signatures</h1>
      <p>Apply a consistent organisation footer and manage personal signatures where policy requires it.</p>
    </div>
  </header>

  {#if form?.error}<div class="notice notice-error" role="alert">{form.error}</div>{/if}
  {#if form?.success}<div class="notice notice-success" role="status">{form.success}</div>{/if}

  <section class="order-banner" aria-labelledby="signature-policy-heading">
    <Icon name="shieldCheck" size={21} />
    <div>
      <h2 id="signature-policy-heading">Reliable signature order</h2>
      <p>cmail appends the sender’s personal signature first, then the optional organisation signature. Both sit below the new message and above quoted conversation history.</p>
    </div>
    <span class="order-pill">Personal → Organisation</span>
  </section>

  <section class="card organisation-card" aria-labelledby="organisation-signature-heading">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Organisation-wide</p>
        <h2 id="organisation-signature-heading">Organisation signature</h2>
        <p>Use this for approved branding, contact details, or a legal notice. Users cannot alter it while composing.</p>
      </div>
      <span class="state-badge" class:state-on={organisation?.enabled}>
        {organisation?.enabled ? 'Enabled' : 'Not applied'}
      </span>
    </div>

    <form method="POST" action="?/updateOrganisationSignature">
      <SignatureEditor
        id="organisation-signature"
        name="html"
        value={organisation?.html || ''}
        label="Organisation content"
        description="This content is centrally managed and rendered beneath every personal signature."
        placeholder="Add approved organisation details, branding text, or a legal notice…"
      />
      <div class="org-actions">
        <label class="switch-row">
          <input type="checkbox" name="enabled" checked={organisation?.enabled || false} />
          <span class="switch" aria-hidden="true"></span>
          <span><strong>Append to outgoing mail</strong><small>Turn off to retain this content without sending it.</small></span>
        </label>
        <button type="submit" class="btn btn-primary">Save organisation signature</button>
      </div>
    </form>
  </section>

  <section class="people-section" aria-labelledby="personal-signatures-heading">
    <div class="section-heading people-heading">
      <div>
        <p class="eyebrow">Per person</p>
        <h2 id="personal-signatures-heading">Personal signatures</h2>
        <p>People can manage their own signature unless you set and lock it here.</p>
      </div>
      <div class="search-box">
        <Icon name="search" size={15} />
        <label class="sr-only" for="signature-search">Search people</label>
        <input id="signature-search" type="search" bind:value={search} placeholder="Search name or email" />
      </div>
    </div>

    <div class="results-meta" aria-live="polite">
      <span>{filteredUsers.length} {filteredUsers.length === 1 ? 'person' : 'people'}</span>
      <span>{(data.users || []).filter((user: { personalSignature: { locked: boolean } | null }) => user.personalSignature?.locked).length} admin managed</span>
    </div>

    {#if filteredUsers.length}
      <div class="signature-list">
        {#each filteredUsers as user (user.id)}
          <details class="person-card">
            <summary>
              <span class="avatar" aria-hidden="true">{(user.displayName || user.email).slice(0, 1).toUpperCase()}</span>
              <span class="person-name"><strong>{user.displayName || 'Unnamed account'}</strong><small>{user.email}</small></span>
              <span
                class="person-state"
                class:state-locked={user.personalSignature?.locked}
                class:state-set={user.personalSignature?.html && !user.personalSignature?.locked}
              >
                {#if user.personalSignature?.locked}<Icon name="lock" size={12} />{/if}
                {signatureState(user)}
              </span>
              <span class="chevron" aria-hidden="true"></span>
            </summary>
            <div class="person-body">
              <div class="management-note">
                <Icon name="info" size={16} />
                <p>Saving here replaces this person’s personal signature. Lock it when the exact wording is required by policy; unlock it to return control to the person.</p>
              </div>
              <form method="POST" action="?/updateUserSignature">
                <input type="hidden" name="user_id" value={user.id} />
                <SignatureEditor
                  id={`signature-${user.id}`}
                  name="html"
                  value={user.personalSignature?.html || ''}
                  label={`Personal signature for ${user.displayName || user.email}`}
                  description="This still appears above the organisation signature."
                />
                <div class="person-actions">
                  <label class="lock-control">
                    <input type="checkbox" name="is_locked" checked={user.personalSignature?.locked || false} />
                    <span><strong>Lock personal signature</strong><small>Only managers can make further changes while locked.</small></span>
                  </label>
                  <button type="submit" class="btn btn-primary">Save for {user.displayName || user.email}</button>
                </div>
              </form>
            </div>
          </details>
        {/each}
      </div>
    {:else}
      <div class="empty-state">
        <Icon name="people" size={24} />
        <h3>No people found</h3>
        <p>Try a different name or email address.</p>
      </div>
    {/if}
  </section>
</section>

<style>
  .admin-page { max-width: 1050px; margin: 0 auto; }
  .page-header { margin-bottom: 16px; }
  .page-header h1, .section-heading h2 { margin: 3px 0 5px; }
  .page-header h1 { font-size: var(--fs-title-2); }
  .page-header p:last-child, .section-heading > div > p:last-child { margin: 0; color: var(--text-muted); font-size: 13px; }
  .notice { margin-bottom: 14px; }
  .eyebrow { margin: 0; color: var(--primary-text); font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  .order-banner { display: flex; align-items: center; gap: 13px; margin-bottom: 16px; padding: 14px 16px; border: 1px solid var(--primary-border); border-radius: var(--radius-lg); background: var(--primary-soft); color: var(--primary-text); }
  .order-banner > :global(svg) { flex: 0 0 auto; }
  .order-banner div { flex: 1; }
  .order-banner h2 { margin: 0 0 2px; font-size: 14px; }
  .order-banner p { margin: 0; color: var(--text-muted); font-size: 11.5px; }
  .order-pill { flex: 0 0 auto; padding: 5px 9px; border: 1px solid var(--primary-border); border-radius: var(--radius-pill); background: var(--bg-surface); font-size: 10.5px; font-weight: 650; }
  .organisation-card { margin-bottom: 26px; padding: 20px; }
  .section-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 16px; }
  .section-heading h2 { font-size: var(--fs-subtitle); }
  .state-badge { flex: 0 0 auto; padding: 4px 9px; border-radius: var(--radius-pill); background: var(--bg-active); color: var(--text-muted); font-size: 10.5px; font-weight: 650; }
  .state-badge.state-on { background: var(--success-soft); color: var(--success); }
  .org-actions, .person-actions { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-top: 17px; }
  .switch-row, .lock-control { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  .switch-row > input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .switch { position: relative; width: 36px; height: 20px; flex: 0 0 auto; border-radius: var(--radius-pill); background: var(--border-strong); transition: background var(--dur-fast) var(--ease); }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: var(--shadow-2); transition: transform var(--dur-fast) var(--ease); }
  .switch-row > input:checked + .switch { background: var(--primary); }
  .switch-row > input:checked + .switch::after { transform: translateX(16px); }
  .switch-row > input:focus-visible + .switch { outline: 2px solid var(--primary); outline-offset: 2px; }
  .switch-row strong, .switch-row small, .lock-control strong, .lock-control small { display: block; }
  .switch-row strong, .lock-control strong { font-size: 12px; }
  .switch-row small, .lock-control small { color: var(--text-muted); font-size: 10.5px; }
  .people-section { margin-top: 4px; }
  .people-heading { align-items: flex-end; }
  .search-box { display: flex; align-items: center; width: min(310px, 100%); padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-muted); }
  .search-box:focus-within { border-color: var(--primary); box-shadow: 0 0 0 1px var(--focus-inner), 0 0 0 3px var(--primary-border); }
  .search-box input { min-height: 34px; padding: 0 0 0 8px; border: 0; background: transparent; box-shadow: none; font-size: 12px; }
  .search-box input:focus { border: 0; box-shadow: none; }
  .signature-list { display: flex; flex-direction: column; gap: 8px; }
  .person-card { overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-surface); box-shadow: var(--shadow-2); }
  .person-card > summary { display: flex; align-items: center; gap: 11px; min-height: 62px; padding: 9px 14px; cursor: pointer; list-style: none; }
  .person-card > summary::-webkit-details-marker { display: none; }
  .person-card > summary:hover { background: var(--bg-hover); }
  .avatar { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%; background: var(--primary-soft); color: var(--primary-text); font-size: 13px; font-weight: 700; }
  .person-name { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; }
  .person-name strong, .person-name small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .person-name strong { font-size: 12.5px; }
  .person-name small { color: var(--text-muted); font-size: 10.5px; }
  .person-state { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: var(--radius-pill); background: var(--bg-active); color: var(--text-muted); font-size: 10px; font-weight: 650; }
  .person-state.state-set { background: var(--success-soft); color: var(--success); }
  .person-state.state-locked { background: var(--warning-soft); color: var(--warning); }
  .chevron { width: 7px; height: 7px; margin: 0 4px; border-right: 1.5px solid var(--text-muted); border-bottom: 1.5px solid var(--text-muted); transform: rotate(45deg); transition: transform var(--dur-fast) var(--ease); }
  .person-card[open] .chevron { transform: rotate(225deg); }
  .person-body { padding: 16px 18px 18px 63px; border-top: 1px solid var(--border); background: var(--bg-subtle); }
  .management-note { display: flex; gap: 8px; margin-bottom: 14px; color: var(--primary-text); }
  .management-note p { margin: 0; color: var(--text-muted); font-size: 11px; }
  .lock-control > input { width: 16px; height: 16px; flex: 0 0 auto; accent-color: var(--primary); }
  .empty-state { display: grid; justify-items: center; padding: 42px 20px; border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); color: var(--text-muted); text-align: center; }
  .empty-state h3 { margin: 8px 0 2px; font-size: 14px; }
  .empty-state p { margin: 0; font-size: 12px; }

  @media (max-width: 720px) {
    .section-heading, .people-heading, .org-actions, .person-actions { align-items: flex-start; flex-direction: column; }
    .order-pill { display: none; }
    .search-box { width: 100%; }
    .person-body { padding: 15px; }
  }
  @media (max-width: 520px) {
    .person-state { display: none; }
    .organisation-card { padding: 15px; }
  }
</style>

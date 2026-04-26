<script>
  let { data, form } = $props();
</script>

<div>
  <h2 style="margin-bottom: 16px;">ICT Policy Management</h2>

  {#if form?.error}
    <div class="badge badge-error" style="display: block; padding: 8px; margin-bottom: 12px;">{form.error}</div>
  {/if}
  {#if form?.success}
    <div class="badge badge-info" style="display: block; padding: 8px; margin-bottom: 12px;">{form.success}</div>
  {/if}

  <details class="card" style="margin-bottom: 16px;">
    <summary style="cursor: pointer; font-weight: 600;">+ Publish New Policy Version</summary>
    <form method="POST" action="?/publish" style="margin-top: 12px;">
      <div style="margin-bottom: 8px;">
        <label style="font-size: 12px; display: block;">Version Label</label>
        <input type="text" name="version_label" required placeholder="e.g. v1.2" />
      </div>
      <div style="margin-bottom: 8px;">
        <label style="font-size: 12px; display: block;">Policy HTML Body</label>
        <textarea name="html_body" required rows="10" placeholder="<h3>ICT Usage Policy</h3><p>...</p>"></textarea>
      </div>
      <button type="submit" class="btn btn-primary">Publish</button>
    </form>
  </details>

  <div style="display: grid; gap: 12px;">
    {#each data.policies as policy}
      <details class="card">
        <summary style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; list-style: none;">
          <strong>{policy.version_label}</strong>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="badge badge-info">{policy.signature_count} signatures</span>
            <span style="font-size: 12px; color: var(--text-muted);">
              Published {new Date(policy.published_at.includes('T') ? policy.published_at : policy.published_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <span style="font-size: 12px; color: var(--accent);">View ▾</span>
          </div>
        </summary>
        <div style="max-height: 400px; overflow-y: auto; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius); margin-top: 12px; background: var(--bg-hover);">
          {@html policy.body_text}
        </div>
      </details>
    {/each}
  </div>
</div>

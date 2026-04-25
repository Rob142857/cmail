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
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong>{policy.version_label}</strong>
          <div style="display: flex; gap: 8px;">
            <span class="badge badge-info">{policy.signature_count} signatures</span>
            <span style="font-size: 12px; color: var(--text-muted);">
              Published {new Date(policy.published_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>

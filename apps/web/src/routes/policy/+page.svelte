<script>
  let { data, form } = $props();
</script>

<div style="max-width: 720px; margin: 40px auto; padding: 0 16px;">
  <div class="card">
    <h2 style="margin-bottom: 8px;">ICT Usage Policy</h2>
    <p style="color: var(--text-muted); margin-bottom: 16px;">
      You must read and accept the current policy before accessing your mailbox.
    </p>
    <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">
      Version: {data.policy.version_label} — Published {new Date(data.policy.published_at).toLocaleDateString()}
    </p>

    <div style="max-height: 400px; overflow-y: auto; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 16px; background: var(--bg-hover);">
      {@html data.policy.body_text}
    </div>

    {#if form?.error}
      <div class="badge badge-error" style="margin-bottom: 12px; display: block; padding: 8px;">{form.error}</div>
    {/if}

    <form method="POST">
      <input type="hidden" name="policy_version_id" value={data.policy.id} />
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px; cursor: pointer;">
        <input type="checkbox" name="accept" value="1" required />
        <span>I have read and accept this ICT usage policy</span>
      </label>
      <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center;">
        Accept & Continue
      </button>
    </form>
  </div>
</div>

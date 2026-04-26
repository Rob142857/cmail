<script>
  let { data, form } = $props();
</script>

<div class="policy-wrap">
  <div class="card policy-card">
    <h2 class="policy-title">ICT Usage Policy</h2>

    {#if data.policy}
      <p class="policy-meta">
        Version {data.policy.version_label} · Published {new Date(data.policy.published_at).toLocaleDateString()}
      </p>

      <div class="policy-body">
        {@html data.policy.body_text}
      </div>

      {#if !data.user}
        <!-- Public / unauthenticated visitor — read-only -->
        <div class="policy-info">
          <p>You're viewing this policy as a guest. <a href="/">Sign in</a> to accept and access your mailbox.</p>
        </div>
      {:else if data.alreadySigned}
        <div class="policy-info signed">
          <p>✓ You have already accepted this policy version. <a href="/mail">Go to mailbox</a></p>
        </div>
      {:else}
        {#if form?.error}
          <div class="badge badge-error policy-error">{form.error}</div>
        {/if}

        <p class="policy-lede">
          You must read and accept the current policy before accessing your mailbox.
        </p>

        <form method="POST" class="policy-form">
          <input type="hidden" name="policy_version_id" value={data.policy.id} />
          <label class="policy-accept">
            <input type="checkbox" name="accept" value="1" required />
            <span>I have read and accept this ICT usage policy.</span>
          </label>
          <button type="submit" class="btn btn-primary policy-submit">
            Accept &amp; Continue
          </button>
        </form>
      {/if}
    {:else}
      <p class="policy-lede">No policy has been published yet.</p>
    {/if}
  </div>
</div>

<style>
  .policy-wrap {
    max-width: 720px;
    margin: 40px auto;
    padding: 0 16px;
  }
  .policy-card {
    padding: 24px;
  }
  .policy-title {
    margin: 0 0 6px;
  }
  .policy-lede {
    color: var(--text-muted);
    margin: 0 0 4px;
  }
  .policy-meta {
    font-size: 13px;
    color: var(--text-muted);
    margin: 0 0 16px;
  }
  .policy-body {
    max-height: 50vh;
    overflow-y: auto;
    padding: 16px 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-hover);
    margin-bottom: 20px;
    line-height: 1.55;
  }
  .policy-body :global(h3) {
    margin: 0 0 12px;
    font-size: 18px;
  }
  .policy-body :global(h4) {
    margin: 18px 0 6px;
    font-size: 15px;
  }
  .policy-body :global(p) {
    margin: 0 0 10px;
  }
  .policy-body :global(ul) {
    margin: 0 0 10px;
    padding-left: 22px;
  }
  .policy-body :global(li) {
    margin-bottom: 4px;
  }
  .policy-body :global(code) {
    background: rgba(255,255,255,0.08);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12.5px;
  }
  .policy-body :global(em) {
    color: var(--text-muted);
  }

  .policy-error {
    display: block;
    padding: 8px 12px;
    margin-bottom: 12px;
  }
  .policy-info {
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-hover);
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .policy-info p { margin: 0; }
  .policy-info a { color: var(--accent, #6aa8ff); }
  .policy-info.signed { border-color: #1e6e44; background: #0d3d24; color: #c4f5d8; }

  .policy-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .policy-accept {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-hover);
    line-height: 1.4;
  }
  .policy-accept input[type="checkbox"] {
    margin: 2px 0 0;
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    cursor: pointer;
  }
  .policy-accept span {
    flex: 1 1 auto;
  }
  .policy-submit {
    width: 100%;
    justify-content: center;
    padding: 12px 16px;
    font-size: 15px;
  }

  @media (max-width: 600px) {
    .policy-wrap {
      margin: 16px auto;
      padding: 0 12px;
    }
    .policy-card {
      padding: 16px;
    }
    .policy-body {
      max-height: 55vh;
      padding: 12px 14px;
    }
  }
</style>

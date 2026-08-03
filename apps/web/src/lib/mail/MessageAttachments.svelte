<script>
  let { attachments = [] } = $props();

  /** @param {number} size */
  function formatAttachmentSize(size) {
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(0.1, size / 1024).toFixed(1)} KB`;
  }
</script>

{#if attachments.length > 0}
  <section class="attachments" aria-labelledby="attachments-title">
    <div class="attachment-heading">
      <h2 id="attachments-title">Attachments ({attachments.length})</h2>
      <p>cmail does not malware-scan attachments. Only open files you trust.</p>
    </div>
    <div class="attachment-list">
      {#each attachments as attachment}
        <a class="attachment" href="/api/attachment/{attachment.id}">
          <span class="attachment-name">{attachment.filename}</span>
          <span>{attachment.content_type || 'Unknown file type'} · {formatAttachmentSize(attachment.size_bytes)}</span>
        </a>
      {/each}
    </div>
  </section>
{/if}

<style>
  .attachments { padding:12px; margin-bottom:12px; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg-hover); }
  .attachment-heading { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:9px; }
  .attachment-heading h2 { font-size:14px; }
  .attachment-heading p { color:var(--text-muted); font-size:12px; }
  .attachment-list { display:flex; gap:8px; flex-wrap:wrap; }
  .attachment { display:flex; flex-direction:column; align-items:flex-start; gap:2px; max-width:100%; padding:7px 9px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-surface); font-size:13px; }
  .attachment-name { max-width:100%; color:var(--text); font-weight:600; overflow-wrap:anywhere; }
  .attachment > span:last-child { color:var(--text-muted); font-size:11px; overflow-wrap:anywhere; }

  @media (max-width:560px) {
    .attachment-heading { align-items:flex-start; flex-direction:column; }
  }
</style>

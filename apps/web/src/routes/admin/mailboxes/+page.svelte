<script>
  import EmailAutocomplete from '$lib/EmailAutocomplete.svelte';
  let { data, form } = $props();
</script>

<div>
  <h2 style="margin-bottom: 16px;">Mailboxes</h2>

  {#if form?.error}
    <div class="badge badge-error" style="display: block; padding: 8px; margin-bottom: 12px;">{form.error}</div>
  {/if}
  {#if form?.success}
    <div class="badge badge-info" style="display: block; padding: 8px; margin-bottom: 12px;">{form.success}</div>
  {/if}

  <details class="card" style="margin-bottom: 16px;">
    <summary style="cursor: pointer; font-weight: 600;">+ Create Mailbox</summary>
    <form method="POST" action="?/create" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: end;">
      <div>
        <label style="font-size: 12px; display: block;">Address</label>
        <input type="email" name="address" required placeholder="shared@example.com" />
      </div>
      <div>
        <label style="font-size: 12px; display: block;">Display Name</label>
        <input type="text" name="display_name" placeholder="Optional" />
      </div>
      <div>
        <label style="font-size: 12px; display: block;">Type</label>
        <select name="type">
          <option value="shared">Shared</option>
          <option value="personal">Personal</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary">Create</button>
    </form>
  </details>

  <div style="display: grid; gap: 16px;">
    {#each data.mailboxes as mb}
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            <strong>{mb.display_name || mb.address}</strong>
            <span style="color: var(--text-muted); font-size: 13px;"> ({mb.address})</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <span class="badge">{mb.type}</span>
            <span class="badge badge-info">{mb.message_count} msgs</span>
          </div>
        </div>
        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">
          Assigned: {mb.assigned_users || 'None'}
        </div>
        <form method="POST" action="?/assign" style="display: flex; gap: 8px; align-items: end; font-size: 13px;">
          <input type="hidden" name="mailbox_id" value={mb.id} />
          <div style="flex: 1; min-width: 180px;">
            <EmailAutocomplete name="user_email" id="user_email_{mb.id}" placeholder="user@example.com" />
          </div>
          <select name="permissions" style="font-size: 13px;">
            <option value="read">Read</option>
            <option value="send-as">Send As</option>
            <option value="full">Full</option>
          </select>
          <button type="submit" style="font-size: 13px; padding: 4px 12px;">Assign</button>
        </form>
      </div>
    {/each}
  </div>
</div>

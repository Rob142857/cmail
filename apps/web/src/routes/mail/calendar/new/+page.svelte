<script>
  import { enhance } from '$app/forms';
  import EmailAutocomplete from '$lib/EmailAutocomplete.svelte';

  let { data, form } = $props();
  const d = $derived(data);
  const backHref = $derived(d.preferredMailboxId ? `/mail/calendar?mailbox=${encodeURIComponent(d.preferredMailboxId)}` : '/mail/calendar');

  let allDay = $state(false);
  let submitting = $state(false);
  let attendees = $state('');
  let startTime = $state('');
  let endTime = $state('');
  let endTouched = $state(false);

  /** @param {string} time @param {number} minutes */
  function addMinutes(time, minutes) {
    if (!/^\d{2}:\d{2}$/.test(time)) return '';
    const [h, m] = time.split(':').map(Number);
    const total = ((h * 60 + m + minutes) % (24 * 60) + 24 * 60) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  /** @param {Event & { currentTarget: HTMLInputElement }} event */
  function onStartTimeInput(event) {
    startTime = event.currentTarget.value;
    if (!endTouched) endTime = addMinutes(startTime, 30);
  }

  /** @param {Event & { currentTarget: HTMLInputElement }} event */
  function onEndTimeInput(event) {
    endTime = event.currentTarget.value;
    endTouched = true;
  }
</script>

<svelte:head><title>New meeting · {d.appName || 'cmail'}</title></svelte:head>

<section class="calendar-new-page">
  <header class="page-header">
    <div class="heading-group">
      <h1>New meeting</h1>
      <p>Times are entered in {d.timeZoneLabel || 'UTC'}.</p>
    </div>
    <a class="btn" href={backHref}>Cancel</a>
  </header>

  {#if form?.error}<p class="form-error-banner" role="alert">{form.error}</p>{/if}

  {#if d.mailboxes.length === 0}
    <div class="card empty-state">
      <h2>No mailbox to organise from</h2>
      <p>You need Send as or Full access to a mailbox to create a meeting.</p>
    </div>
  {:else}
    <form
      method="POST"
      action="?/create"
      class="card"
      use:enhance={() => {
        submitting = true;
        return async ({ update }) => {
          submitting = false;
          await update();
        };
      }}
    >
      <fieldset disabled={submitting}>
        <div class="field">
          <label for="from">From</label>
          <select name="from" id="from" required>
            {#each d.mailboxes as mb}
              <option value={mb.address} selected={mb.id === d.preferredMailboxId}>{mb.display_name ? `${mb.display_name} <${mb.address}>` : mb.address}</option>
            {/each}
          </select>
        </div>

        <div class="field">
          <label for="title">Title</label>
          <input type="text" name="title" id="title" required maxlength="200" placeholder="Meeting title" autocapitalize="sentences" />
        </div>

        <div class="field-row">
          <div class="field">
            <label for="date">Date</label>
            <input type="date" name="date" id="date" required />
          </div>
          <label class="all-day-toggle">
            <input type="checkbox" name="all_day" bind:checked={allDay} />
            All day
          </label>
        </div>

        {#if !allDay}
          <div class="field-row">
            <div class="field">
              <label for="start_time">Start</label>
              <input type="time" name="start_time" id="start_time" required={!allDay} value={startTime} oninput={onStartTimeInput} />
            </div>
            <div class="field">
              <label for="end_time">End</label>
              <input type="time" name="end_time" id="end_time" required={!allDay} value={endTime} oninput={onEndTimeInput} />
            </div>
          </div>
        {/if}

        <div class="field">
          <label for="location">Location</label>
          <input type="text" name="location" id="location" maxlength="300" placeholder="Optional" />
        </div>

        <div class="field">
          <label for="attendees">Attendees</label>
          <EmailAutocomplete bind:value={attendees} name="attendees" id="attendees" placeholder="recipient@example.com, another@example.com" multi required />
        </div>

        <div class="field">
          <label for="description">Description</label>
          <textarea name="description" id="description" rows="6" maxlength="5000" placeholder="Optional agenda or notes" spellcheck="true"></textarea>
        </div>

        <div class="form-actions">
          <a class="btn" href={backHref}>Cancel</a>
          <button class="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send invitation'}</button>
        </div>
      </fieldset>
    </form>
  {/if}
</section>

<style>
  .calendar-new-page { max-width: 640px; }
  .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
  .heading-group h1 { font-size: 22px; }
  .heading-group p { margin-top: 4px; color: var(--text-muted); font-size: 13px; }
  form.card { display: flex; flex-direction: column; }
  fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }
  .field-row { display: flex; gap: 12px; align-items: flex-end; }
  .field-row .field { flex: 1 1 auto; }
  .all-day-toggle { display: flex; align-items: center; gap: 6px; padding-bottom: 7px; font-size: 13px; white-space: nowrap; }
  .form-error-banner { padding: 10px 12px; margin-bottom: 12px; color: var(--danger-text); background: var(--danger-soft); border: 1px solid var(--danger-border); border-radius: var(--radius); font-size: 13px; }

  @media (max-width: 520px) {
    .field-row { flex-direction: column; align-items: stretch; }
  }
</style>

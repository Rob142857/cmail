<script>
  import { goto } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { eventDayKey, formatDayHeading, formatEventRange } from '$lib/dates';
  import { partstatBadgeClass, partstatLabel } from '$lib/calendar-format';

  let { data, form } = $props();
  const d = $derived(data);

  let cancellingId = $state('');

  const groups = $derived.by(() => {
    /** @type {Map<string, any[]>} */
    const map = new Map();
    for (const event of d.events) {
      const key = eventDayKey(event.starts_at, event.all_day === 1, d.timeZone);
      const list = map.get(key) || [];
      list.push(event);
      map.set(key, list);
    }
    return [...map.entries()];
  });

  const monthLabel = $derived.by(() => {
    const date = new Date(`${d.month}-01T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return d.month;
    return date.toLocaleDateString(d.locale || 'en', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  });

  /** @param {string} monthValue */
  function monthHref(monthValue) {
    const params = new URLSearchParams();
    if (monthValue) params.set('month', monthValue);
    if (d.mailboxId) params.set('mailbox', d.mailboxId);
    return `/mail/calendar?${params.toString()}`;
  }

  /** @param {string} mailboxId */
  function mailboxHref(mailboxId) {
    const params = new URLSearchParams();
    if (mailboxId) params.set('mailbox', mailboxId);
    return params.toString() ? `/mail/calendar?${params}` : '/mail/calendar';
  }

  const newMeetingHref = $derived(d.mailboxId ? `/mail/calendar/new?mailbox=${encodeURIComponent(d.mailboxId)}` : '/mail/calendar/new');
</script>

<svelte:head><title>Calendar · {d.appName || 'cmail'}</title></svelte:head>

<section class="calendar-page">
  <header class="page-header">
    <div class="heading-group">
      <h1>Calendar</h1>
      <p>
        {monthLabel}
        {#if d.mailboxAddress}<span>— {d.mailboxAddress}</span>{/if}
      </p>
    </div>

    <div class="page-actions">
      {#if d.mailboxes.length > 1}
        <label class="sr-only" for="calendar-mailbox">Mailbox</label>
        <select
          id="calendar-mailbox"
          class="calendar-mailbox-picker"
          value={d.mailboxId}
          onchange={(event) => { void goto(mailboxHref(event.currentTarget.value)); }}
        >
          {#each d.mailboxes as mb}
            <option value={mb.id}>{mb.type === 'shared' ? 'Shared — ' : ''}{mb.display_name || mb.address}</option>
          {/each}
        </select>
      {/if}
      <nav class="month-nav" aria-label="Month">
        {#if d.canGoPrev}
          <a class="btn btn-sm" href={monthHref(d.prevMonth)}>&larr; Prev</a>
        {:else}
          <span class="btn btn-sm" aria-disabled="true">&larr; Prev</span>
        {/if}
        {#if d.canGoNext}
          <a class="btn btn-sm" href={monthHref(d.nextMonth)}>Next &rarr;</a>
        {:else}
          <span class="btn btn-sm" aria-disabled="true">Next &rarr;</span>
        {/if}
      </nav>
      {#if d.canOrganize}
        <a class="btn btn-primary" href={newMeetingHref}>New meeting</a>
      {/if}
    </div>
  </header>

  {#if form?.error}<p class="bulk-feedback error" role="alert">{form.error}</p>{/if}
  {#if form?.cancelled}<p class="bulk-feedback success" role="status">Meeting cancelled.</p>{/if}

  {#if !d.mailboxId}
    <div class="card empty-state">
      <h2>No mailbox available</h2>
      <p>You need an assigned mailbox to see a calendar.</p>
    </div>
  {:else if d.events.length === 0}
    <div class="card empty-state">
      <h2>No meetings this month</h2>
      <p>Invitations you organise or receive for {d.mailboxAddress} appear here.</p>
    </div>
  {:else}
    <div class="agenda card">
      {#each groups as [day, events] (day)}
        <div class="agenda-day">
          <h2 class="day-heading">{formatDayHeading(day, d.locale)}</h2>
          {#each events as event (event.id)}
            <details class="event-row">
              <summary>
                <span class="event-time">{formatEventRange(event.starts_at, event.ends_at, event.all_day === 1, d.locale, d.timeZone)}{event.rrule ? ' · Repeats' : ''}</span>
                <span class="event-summary" class:cancelled-text={event.status === 'cancelled'}>{event.summary || '(no title)'}</span>
                {#if event.location}<span class="event-location">{event.location}</span>{/if}
                <span class="event-chips">
                  {#if event.status === 'cancelled'}
                    <span class="badge badge-danger">Cancelled</span>
                  {:else if event.organizer_self}
                    <span class="badge badge-info">Organiser</span>
                  {:else if event.myPartstat}
                    <span class="badge {partstatBadgeClass(event.myPartstat)}">{partstatLabel(event.myPartstat)}</span>
                  {/if}
                </span>
              </summary>

              <div class="event-detail">
                <p class="u-muted">
                  {event.organizer_self ? 'You organised this meeting.' : `Organiser: ${event.organizer_address}`}
                </p>
                {#if event.description}<p class="event-description">{event.description}</p>{/if}
                {#if event.attendees.length}
                  <ul class="attendee-list">
                    {#each event.attendees as attendee (attendee.id)}
                      <li>
                        <span class="u-truncate">{attendee.display_name || attendee.address}</span>
                        <span class="badge {partstatBadgeClass(attendee.partstat)}">{partstatLabel(attendee.partstat)}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#if event.organizer_self && event.status !== 'cancelled'}
                  <form
                    method="POST"
                    action="?/cancel"
                    use:enhance={() => {
                      cancellingId = event.id;
                      return async ({ update }) => {
                        cancellingId = '';
                        await update();
                      };
                    }}
                  >
                    <input type="hidden" name="event_id" value={event.id} />
                    <button class="btn btn-outline-danger btn-sm" type="submit" disabled={cancellingId === event.id}>
                      {cancellingId === event.id ? 'Cancelling…' : 'Cancel meeting'}
                    </button>
                  </form>
                {/if}
              </div>
            </details>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .calendar-page { min-width: 0; }
  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .heading-group { min-width: 0; }
  .heading-group h1 { font-size: 22px; }
  .heading-group p { margin-top: 4px; color: var(--text-muted); font-size: 13px; }
  .page-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .calendar-mailbox-picker { min-width: 180px; width: auto; }
  .month-nav { display: flex; align-items: center; gap: 6px; }
  .month-nav [aria-disabled='true'] { pointer-events: none; opacity: 0.45; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

  .bulk-feedback { padding: 10px 12px; margin-bottom: 12px; border: 1px solid transparent; border-radius: var(--radius); font-size: 13px; }
  .bulk-feedback.error { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 25%, transparent); }
  .bulk-feedback.success { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 25%, transparent); }

  .agenda { padding: 0; overflow: hidden; }
  .agenda-day { border-bottom: 1px solid var(--border); }
  .agenda-day:last-child { border-bottom: 0; }
  .day-heading { padding: 10px 16px; margin: 0; font-size: 13px; font-weight: 600; color: var(--text-muted); background: var(--bg-subtle); }

  .event-row { border-bottom: 1px solid var(--divider); }
  .event-row:last-child { border-bottom: 0; }
  .event-row summary {
    display: grid;
    grid-template-columns: minmax(120px, 200px) minmax(160px, 1fr) minmax(0, 200px) auto;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    cursor: pointer;
    list-style: none;
  }
  .event-row summary::-webkit-details-marker { display: none; }
  .event-row:hover summary { background: var(--bg-hover); }
  .event-time { color: var(--text-muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .event-summary { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .event-summary.cancelled-text { text-decoration: line-through; color: var(--text-muted); }
  .event-location { color: var(--text-muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .event-chips { display: flex; justify-content: flex-end; }
  .event-detail { padding: 0 16px 14px 16px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
  .event-description { white-space: pre-wrap; overflow-wrap: anywhere; }
  .attendee-list { list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .attendee-list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; }

  @media (max-width: 700px) {
    .event-row summary { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'time chips' 'summary chips' 'location chips'; }
    .event-time { grid-area: time; }
    .event-summary { grid-area: summary; white-space: normal; }
    .event-location { grid-area: location; }
    .event-chips { grid-area: chips; align-items: flex-start; }
  }
</style>

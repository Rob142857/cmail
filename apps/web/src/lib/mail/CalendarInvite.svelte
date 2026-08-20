<script>
  import { enhance } from '$app/forms';
  import { formatEventRange } from '$lib/dates';
  import { partstatBadgeClass, partstatLabel } from '$lib/calendar-format';
  import Icon from '$lib/ui/Icon.svelte';

  /**
   * @type {{
   *   invite: {
   *     summary: string, description: string, location: string,
   *     startsAt: string, endsAt: string | null, allDay: boolean, status: 'confirmed' | 'cancelled',
   *     organizerAddress: string, organizerSelf: boolean, rrule?: string | null,
   *     myPartstat: string | null, canRespond: boolean,
   *   },
   *   locale?: string,
   *   timeZone?: string,
   *   error?: string,
   * }}
   */
  let { invite, locale = 'en', timeZone = 'UTC', error = '' } = $props();

  let submitting = $state('');

  const whenLabel = $derived(formatEventRange(invite.startsAt, invite.endsAt, invite.allDay, locale, timeZone));
</script>

<div class="invite-card card">
  <div class="invite-head">
    <span class="invite-icon"><Icon name="calendar" size={18} /></span>
    <div class="invite-heading">
      <p class="invite-summary">{invite.summary || '(no title)'}</p>
      <p class="invite-when">{whenLabel}{invite.rrule ? ' · Repeats' : ''}</p>
    </div>
  </div>

  {#if invite.location}<p class="invite-line">Location: {invite.location}</p>{/if}
  <p class="invite-line">
    {invite.organizerSelf ? 'You organised this meeting.' : `Organiser: ${invite.organizerAddress}`}
  </p>

  {#if invite.status === 'cancelled'}
    <p class="invite-cancelled">This meeting was cancelled.</p>
  {:else}
    {#if invite.myPartstat}
      <p class="invite-line">
        Your response:
        <span class="badge {partstatBadgeClass(invite.myPartstat)}">{partstatLabel(invite.myPartstat)}</span>
      </p>
    {/if}

    {#if invite.canRespond}
      <form
        method="POST"
        action="?/rsvp"
        use:enhance={({ submitter }) => {
          submitting = submitter instanceof HTMLButtonElement ? submitter.value : 'sending';
          return async ({ update }) => {
            submitting = '';
            await update();
          };
        }}
      >
        <div class="invite-actions">
          <button class="btn btn-primary btn-sm" type="submit" name="partstat" value="accepted" disabled={Boolean(submitting)}>Accept</button>
          <button class="btn btn-sm" type="submit" name="partstat" value="tentative" disabled={Boolean(submitting)}>Tentative</button>
          <button class="btn btn-sm" type="submit" name="partstat" value="declined" disabled={Boolean(submitting)}>Decline</button>
        </div>
      </form>
    {/if}
  {/if}

  {#if error}<p class="invite-error" role="alert">{error}</p>{/if}
</div>

<style>
  .invite-card { margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px; }
  .invite-head { display: flex; align-items: flex-start; gap: 10px; }
  .invite-icon { flex: 0 0 auto; color: var(--primary); margin-top: 2px; }
  .invite-heading { min-width: 0; }
  .invite-summary { font-weight: 650; font-size: 15px; overflow-wrap: anywhere; }
  .invite-when { color: var(--text-muted); font-size: 13px; margin-top: 2px; }
  .invite-line { font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
  .invite-cancelled { font-size: 13px; font-weight: 600; color: var(--danger-text); }
  .invite-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
  .invite-error { font-size: 12px; color: var(--danger-text); }
</style>

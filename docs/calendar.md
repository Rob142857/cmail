# Calendar

cmail can send and receive meeting invitations by email, using the same `.ics` calendar format most mail clients understand. There's no separate calendar to sign into — invitations arrive as mail, and responses go out the same way.

## Invitations you receive

An invitation shows up as a normal message with a calendar card above the message body: the meeting title, when it is, where (if given), and who's organising it. If the meeting was cancelled, the card says so instead of offering a response.

If you're invited, three buttons let you reply: **Accept**, **Tentative**, or **Decline**. Choosing one:

- Records your response, shown as a status badge on the card.
- Emails your response back to the organiser as a calendar reply, so their invitation stays in sync.

You can change your response later by opening the message again and choosing a different button, as long as the meeting hasn't been cancelled.

An invitation forwarded from outside cmail, or one that's since been superseded by a newer update, still shows the calendar card with what it contains — but read-only, without response buttons, since it's no longer the current version of that meeting.

## Your calendar

Go to **Mail > Calendar** to see an agenda of meetings for the active mailbox: what's coming up, grouped by day, with a heading you can page back a month or forward up to six months. Each meeting expands to show the full attendee list and each person's response. If you're the organiser, you'll also see a **Cancel meeting** option there.

If you're assigned more than one mailbox, use the picker at the top of the calendar page to switch which one you're viewing — a shared mailbox's calendar is separate from your personal one.

## Creating a meeting

Select **New meeting** from the calendar page. Fill in:

- **From** — which of your mailboxes is organising it (requires Send as or Full access).
- **Title**, **date**, and either a start/end time or **All day**.
- **Location** and a **description**, both optional.
- **Attendees** — one or more email addresses; internal and external addresses both work.

Times are entered in the organisation's configured time zone, shown on the form. Sending creates the meeting and emails every attendee one invitation with the details and a calendar attachment their mail client can add automatically.

If the invitation email can't be sent, the meeting is still saved — you'll see a plain message explaining that attendees weren't notified, so you can follow up directly.

## Cancelling a meeting

Only the organiser sees **Cancel meeting**, on the calendar page. Cancelling marks the meeting cancelled for everyone who can see it and emails every attendee a cancellation notice. It can't be undone from cmail — create a new meeting if you need to reschedule.

## What's not included yet

- **Repeating meetings** show a "Repeats" note next to the time when the invitation carries a recurrence rule, but cmail displays that one occurrence only — it doesn't expand the series into individual future dates, and New meeting can't create a repeating series.
- **Free/busy lookup** — there's no way to see whether an attendee is already busy before you send an invitation.
- **External calendar sync** — cmail doesn't publish to or subscribe from Google Calendar, Outlook, or similar. Invitations work by email either way, so most calendar apps will still pick them up and let the recipient respond from there.

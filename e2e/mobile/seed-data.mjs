// Invented fixtures for the mobile suite. Every person, organisation, address
// and message below is made up; the `.test` TLD can never resolve or deliver.
// Nothing here is copied from a real mailbox.

export const ORG = {
  name: 'Wattle Creek Community Trust',
  shortName: 'Wattle Creek',
  domain: 'wattle.test',
  appName: 'Wattle Mail',
};

export const USERS = [
  { id: 'user-mia', email: 'mia.manager@wattle.test', name: 'Mia Okafor', role: 'manager', provider: 'microsoft' },
  { id: 'user-sam', email: 'sam.standard@wattle.test', name: 'Sam Lindqvist', role: 'standard', provider: 'google' },
  { id: 'user-pia', email: 'pia.pending@wattle.test', name: 'Pia Ruiz', role: 'standard', provider: '', status: 'pending' },
  // Only the compose-defaults spec signs in as Ivy: it changes her default
  // font, which would otherwise race with specs that expect Outlook's.
  { id: 'user-ivy', email: 'ivy.settings@wattle.test', name: 'Ivy Tran', role: 'standard', provider: 'google' },
];

export const MAILBOXES = [
  { id: 'mb-mia', address: 'mia.manager@wattle.test', type: 'personal', name: 'Mia Okafor', owner: 'user-mia' },
  { id: 'mb-sam', address: 'sam.standard@wattle.test', type: 'personal', name: 'Sam Lindqvist', owner: 'user-sam' },
  { id: 'mb-desk', address: 'frontdesk@wattle.test', type: 'shared', name: 'Front Desk', owner: null },
  { id: 'mb-bookings', address: 'bookings@wattle.test', type: 'shared', name: 'Hall Bookings', owner: null },
  // Internal sink for the send tests: nobody views it, so sends never change
  // a screen another spec photographs. Sam can read it to check delivery.
  { id: 'mb-records', address: 'records@wattle.test', type: 'shared', name: 'Records', owner: null },
];

export const ASSIGNMENTS = [
  ['user-mia', 'mb-mia', 'full'],
  ['user-mia', 'mb-desk', 'full'],
  ['user-mia', 'mb-bookings', 'read'],
  ['user-sam', 'mb-sam', 'full'],
  ['user-sam', 'mb-desk', 'send-as'],
  ['user-sam', 'mb-records', 'read'],
  ['user-ivy', 'mb-desk', 'send-as'],
];

const p = (text) => `<p>${text}</p>`;

// A marketing-style HTML mail: tables, inline styles, a remote image (which the
// reader must block) and a long unbroken URL, to exercise the HTML frame.
const NEWSLETTER = `<!doctype html><html><body style="margin:0;background:#eef2f5">
<table role="presentation" width="600" style="width:600px;margin:0 auto;background:#ffffff;font-family:Georgia,serif">
<tr><td style="padding:24px;background:#2f5d50;color:#ffffff"><h1 style="margin:0;font-size:26px">Banksia Heads Landcare</h1>
<p style="margin:4px 0 0">Spring planting bulletin</p></td></tr>
<tr><td style="padding:24px"><img src="https://images.banksia.test/hero.jpg" width="552" height="200" alt="Volunteers planting">
<h2 style="font-size:20px">Saturday working bee</h2>
<p>We are planting 400 tubestock along the creek line. Bring gloves, a hat and water. Morning tea from 10:30.</p>
<table width="100%" style="border-collapse:collapse"><tr><th align="left">Site</th><th align="left">Start</th><th align="left">Leader</th></tr>
<tr><td>North bank</td><td>08:00</td><td>Ivo</td></tr><tr><td>Footbridge</td><td>09:00</td><td>Ren</td></tr></table>
<p>Full roster: https://landcare.banksia.test/rosters/2026/spring/working-bee-planting-roster-final-version-two.pdf</p>
<p><a href="https://landcare.banksia.test/rsvp" style="display:inline-block;padding:12px 20px;background:#2f5d50;color:#fff;text-decoration:none">RSVP for Saturday</a></p>
</td></tr></table></body></html>`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** D1 datetime() format, UTC. */
function at(offsetMs, now) {
  return new Date(now - offsetMs).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Messages, newest first per folder. `ago` is relative to the seeding time so
 * the list always reads "today / yesterday / last week"; visual baselines
 * mask dates.
 */
export function buildMessages(now = Date.now()) {
  const rows = [
    // Mia's inbox
    { id: 'msg-roster', mb: 'mb-mia', from: 'ivo.petrov@banksia.test', fromName: 'Ivo Petrov', subject: 'Roster for the spring working bee', body: p('Hi Mia,') + p('Attached is the draft roster for Saturday. Could you check the morning shift before I send it to the volunteers?') + p('Thanks,<br>Ivo'), ago: 25 * MINUTE, attachments: [{ id: 'att-roster', filename: 'working-bee-roster.pdf', type: 'application/pdf', size: 48_213 }], importance: 'high' },
    { id: 'msg-newsletter', mb: 'mb-mia', from: 'news@landcare.banksia.test', fromName: 'Banksia Heads Landcare', subject: 'Spring planting bulletin: Saturday working bee', body: NEWSLETTER, snippet: 'Banksia Heads Landcare. Spring planting bulletin. Saturday working bee: we are planting 400 tubestock along the creek line.', ago: 2 * HOUR, read: 1 },
    { id: 'msg-hall', mb: 'mb-mia', from: 'ren.tanaka@ironbark.test', fromName: 'Ren Tanaka', subject: 'Hall key handover', body: p('Hi Mia, I can drop the hall key at the front desk on Thursday afternoon. Does 3pm suit?'), ago: 5 * HOUR, starred: 1, thread: 'thread-hall' },
    { id: 'msg-grant', mb: 'mb-mia', from: 'grants@saltbush-council.test', fromName: 'Saltbush Shire Council', subject: 'Community grant round 2: application received and under assessment by the panel', body: p('Your application CG-2026-114 has been received. The panel meets on 12 November. We will contact you if we need anything else.'), ago: 1 * DAY, read: 1 },
    { id: 'msg-minutes', mb: 'mb-mia', from: 'secretary@wattle.test', fromName: 'Nell Abara', subject: 'Draft minutes, October committee meeting', body: p('Draft minutes attached for comment by Friday.'), ago: 1 * DAY + 3 * HOUR, read: 1, attachments: [{ id: 'att-minutes', filename: 'committee-minutes-october-draft.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 31_877 }] },
    { id: 'msg-insurance', mb: 'mb-mia', from: 'renewals@insure.test', fromName: 'Ironbark Mutual', subject: 'Public liability renewal due', body: p('Your policy renews on 1 December. No action is needed if your details are unchanged.'), ago: 3 * DAY, read: 1, importance: 'low' },
    { id: 'msg-bbq', mb: 'mb-mia', from: 'otto@wattle.test', fromName: 'Otto Fischer', subject: 'Sausage sizzle volunteers', body: p('We still need two people for the 11–1 shift at the market stall.'), ago: 4 * DAY, read: 1 },
    { id: 'msg-printer', mb: 'mb-mia', from: 'helpdesk@wattle.test', fromName: 'Wattle IT', subject: 'Office printer moved to the side room', body: p('The office printer is now in the side room. The queue name has not changed.'), ago: 6 * DAY, read: 1 },
    { id: 'msg-hall-2', mb: 'mb-mia', from: 'ren.tanaka@ironbark.test', fromName: 'Ren Tanaka', subject: 'Re: Hall key handover', body: p('Great, see you then.'), ago: 4 * HOUR + 30 * MINUTE, read: 1, thread: 'thread-hall' },
    // Mia's other folders
    { id: 'msg-sent-1', mb: 'mb-mia', folder: 'sent', direction: 'outbound', from: 'mia.manager@wattle.test', fromName: 'Mia Okafor', to: [{ address: 'ivo.petrov@banksia.test', name: 'Ivo Petrov' }], subject: 'Re: Roster for the spring working bee', body: p('Looks good, Ivo. Please swap Ren and Otto on the second shift.') + p('Mia'), ago: 10 * MINUTE, read: 1 },
    { id: 'msg-sent-2', mb: 'mb-mia', folder: 'sent', direction: 'outbound', from: 'mia.manager@wattle.test', fromName: 'Mia Okafor', to: [{ address: 'grants@saltbush-council.test', name: 'Saltbush Shire Council' }, { address: 'nell@wattle.test', name: 'Nell Abara' }, { address: 'otto@wattle.test', name: 'Otto Fischer' }], subject: 'Grant application CG-2026-114', body: p('Please find our application attached.'), ago: 9 * DAY, read: 1 },
    { id: 'msg-spam', mb: 'mb-mia', folder: 'spam', from: 'prize@lottery.test', fromName: 'Prize Office', subject: 'You have won a holiday', body: p('Claim now.'), ago: 2 * DAY, read: 0 },
    // Front Desk (shared)
    { id: 'msg-desk-lost', mb: 'mb-desk', from: 'kai@ironbark.test', fromName: 'Kai Morgan', subject: 'Lost property: blue drink bottle', body: p('I left a blue drink bottle in the main hall on Sunday. Has anyone handed it in?'), ago: 50 * MINUTE },
    { id: 'msg-desk-parking', mb: 'mb-desk', from: 'lee@saltbush.test', fromName: 'Lee Huang', subject: 'Parking for the Saturday market', body: p('Is the back car park open to stallholders this weekend?'), ago: 7 * HOUR },
    { id: 'msg-desk-thanks', mb: 'mb-desk', from: 'ada@banksia.test', fromName: 'Ada Novak', subject: 'Thank you!', body: p('Thanks for organising the seniors’ afternoon tea. It was lovely.'), ago: 2 * DAY, read: 1 },
    // Hall Bookings (shared, read only for Mia)
    { id: 'msg-book-1', mb: 'mb-bookings', from: 'yoga@ironbark.test', fromName: 'Ironbark Yoga', subject: 'Booking request: Tuesdays in November', body: p('Could we book the small hall on Tuesdays 6–7pm in November?'), ago: 3 * HOUR, read: 1 },
    // Sam's mailbox
    { id: 'msg-sam-1', mb: 'mb-sam', from: 'otto@wattle.test', fromName: 'Otto Fischer', subject: 'Market float', body: p('The float is in the office safe.'), ago: 2 * HOUR },
  ];
  return rows.map((row) => ({
    folder: 'inbox',
    direction: 'inbound',
    read: 0,
    starred: 0,
    importance: 'normal',
    attachments: [],
    to: [{ address: MAILBOXES.find((m) => m.id === row.mb).address, name: MAILBOXES.find((m) => m.id === row.mb).name }],
    thread: null,
    ...row,
    snippet: row.snippet ?? plainParagraphs(row.body).slice(0, 160),
    receivedAt: at(row.ago, now),
  }));
}

/** Text of the simple p()/br bodies above (fixed markup only, not a sanitizer). */
function plainParagraphs(body) {
  return body.split('<p>').join(' ').split('</p>').join(' ').split('<br>').join(' ').trim().split(/\s+/).join(' ');
}

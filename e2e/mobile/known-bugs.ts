/**
 * Known bugs: tests expected to fail until the TODO is done.
 *
 * Key: "<spec file> › <describe> › <test title>" (as in the list reporter).
 * projects: 'all' or the device projects it fails on.
 * When a fix lands the test fails with "Expected to fail, but passed":
 * delete the entry in the same commit.
 */
export const KNOWN_BUGS: Record<string, { projects: 'all' | string[]; todo: string }> = {
  'a11y.spec.ts › keyboard › skip link comes first and every stop shows a focus ring':
    { projects: ['desktop-chrome'], todo: 'TODO(a11y): header search field shows no focus ring when tabbed to.' },
  'compose.spec.ts › on a phone › with the keyboard up, Send is still reachable without scrolling':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(compose): Send sits at the bottom of a long form; keep the action bar on screen (sticky) on phones.' },
  'compose.spec.ts › send states: Sending, then the Sent folder shows the message body':
    { projects: ['iphone-14'], todo: 'TODO(compose): on iPhone the fixed "Install app" banner covers the Send button; keep it off compose and reserve space for it.' },
  'compose.spec.ts › Sent body also renders after a full page load of the Sent item':
    { projects: ['iphone-14'], todo: 'TODO(compose): on iPhone the fixed "Install app" banner covers the Send button; keep it off compose and reserve space for it.' },
  'compose.spec.ts › a missing recipient is refused with a clear message':
    { projects: ['iphone-14'], todo: 'TODO(compose): on iPhone the fixed "Install app" banner covers the Send button; keep it off compose and reserve space for it.' },
  'inbox.spec.ts › on a phone › each row shows sender, subject and a preview line':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(inbox): the preview line is hidden on phones; show one line like other mail apps.' },
  'inbox.spec.ts › on a phone › New message is one tap away without opening the menu':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(inbox): New message is only in the closed drawer on phones; add a floating compose button.' },
  'inbox.spec.ts › on a phone › list controls are at least 44px':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(a11y): menu/search/account header buttons are 32px on touch screens; make them 44px.' },
  'inbox.spec.ts › on a phone › a phone screen shows at least six messages':
    { projects: ['iphone-14'], todo: 'TODO(inbox): rows take three lines plus a mailbox chip line; fewer than six fit on a 360px phone.' },
  'inbox.spec.ts › Refresh while offline keeps the list and says you are offline':
    { projects: 'all', todo: 'TODO(offline): going offline then refreshing or opening a message blanks the app (SvelteKit falls back to a full page load); stay put and say you are offline.' },
  'inbox.spec.ts › opening a message while offline stays on the list and explains why':
    { projects: 'all', todo: 'TODO(offline): going offline then refreshing or opening a message blanks the app (SvelteKit falls back to a full page load); stay put and say you are offline.' },
  'message.spec.ts › on a phone › message actions fit on one row above the subject':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(reading): eight full-text buttons wrap into two or three rows above the subject on phones; use an icon toolbar with a More menu.' },
  'message.spec.ts › wide HTML mail fits the screen instead of being cut off':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(reading): 600px newsletter tables are cut off on the right with no way to scroll; scale the frame content to fit.' },
  'settings-admin.spec.ts › management pages › on a phone › management header and drawer controls are at least 44px':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(a11y): management menu button is 32px on touch screens.' },
};

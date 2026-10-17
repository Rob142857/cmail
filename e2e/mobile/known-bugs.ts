/**
 * Known bugs: tests expected to fail until the TODO is done.
 *
 * Key: "<spec file> › <describe> › <test title>" (as in the list reporter).
 * projects: 'all' or the device projects it fails on.
 * When a fix lands the test fails with "Expected to fail, but passed":
 * delete the entry in the same commit.
 */
export const KNOWN_BUGS: Record<string, { projects: 'all' | string[]; todo: string }> = {
  'a11y.spec.ts › axe: serious and critical issues › signed in › inbox':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › shared mailbox':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › sent':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › search':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › message html':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › message plain':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › settings':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › connected apps':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › calendar':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › admin home':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › admin users':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › admin mailboxes':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › admin settings':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › signed in › admin audit':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › dark mode › inbox (dark)':
    { projects: ['pixel-7'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › dark mode › message html (dark)':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › dark mode › settings (dark)':
    { projects: ['pixel-7'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › dark mode › admin home (dark)':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › compose › new message':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): account button has no accessible name on phones (avatar only); mode-switch links lose their text when labels are display:none; faint nav headings fail contrast.' },
  'a11y.spec.ts › axe: serious and critical issues › sign-in page':
    { projects: ['pixel-7', 'desktop-chrome'], todo: 'TODO(a11y): faint text (#8a8a8a) fails 4.5:1 contrast on white; darken --text-faint.' },
  'a11y.spec.ts › keyboard › skip link comes first and every stop shows a focus ring':
    { projects: ['desktop-chrome'], todo: 'TODO(a11y): header search field shows no focus ring when tabbed to.' },
  'compose.spec.ts › on a phone › with the keyboard up, Send is still reachable without scrolling':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(compose): Send sits at the bottom of a long form; keep the action bar on screen (sticky) on phones.' },
  'compose.spec.ts › on a phone › formatting toolbar and attachment controls are at least 44px':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(compose): toolbar, format toggle and Bcc controls are 19-36px tall on touch screens; make them 44px.' },
  'compose.spec.ts › send states: Sending, then the Sent folder shows the message body':
    { projects: ['iphone-14'], todo: 'TODO(compose): on iPhone the fixed "Install app" banner covers the Send button; keep it off compose and reserve space for it.' },
  'compose.spec.ts › Sent body also renders after a full page load of the Sent item':
    { projects: ['iphone-14'], todo: 'TODO(compose): on iPhone the fixed "Install app" banner covers the Send button; keep it off compose and reserve space for it.' },
  'compose.spec.ts › a missing recipient is refused with a clear message':
    { projects: ['iphone-14'], todo: 'TODO(compose): on iPhone the fixed "Install app" banner covers the Send button; keep it off compose and reserve space for it.' },
  'inbox.spec.ts › on a phone › each row shows sender, subject and a preview line':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(inbox): the preview line is hidden on phones; show one line like other mail apps.' },
  'inbox.spec.ts › on a phone › bulk actions stay out of the way until something is selected':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(inbox): seven disabled bulk buttons sit above the list on phones; show them only after a selection.' },
  'inbox.spec.ts › on a phone › New message is one tap away without opening the menu':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(inbox): New message is only in the closed drawer on phones; add a floating compose button.' },
  'inbox.spec.ts › on a phone › list controls are at least 44px':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(a11y): menu/search/account header buttons are 32px on touch screens; make them 44px.' },
  'inbox.spec.ts › on a phone › a phone screen shows at least six messages':
    { projects: ['galaxy-s24', 'iphone-14'], todo: 'TODO(inbox): rows take three lines plus a mailbox chip line; fewer than six fit on a 360px phone.' },
  'inbox.spec.ts › Refresh while offline keeps the list and says you are offline':
    { projects: 'all', todo: 'TODO(offline): going offline then refreshing or opening a message blanks the app (SvelteKit falls back to a full page load); stay put and say you are offline.' },
  'inbox.spec.ts › opening a message while offline stays on the list and explains why':
    { projects: 'all', todo: 'TODO(offline): going offline then refreshing or opening a message blanks the app (SvelteKit falls back to a full page load); stay put and say you are offline.' },
  'message.spec.ts › on a phone › message actions fit on one row above the subject':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(reading): eight full-text buttons wrap into two or three rows above the subject on phones; use an icon toolbar with a More menu.' },
  'message.spec.ts › on a phone › Reply is reachable and message actions are at least 44px':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(reading): message toolbar buttons are 36px tall on touch screens.' },
  'message.spec.ts › wide HTML mail fits the screen instead of being cut off':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(reading): 600px newsletter tables are cut off on the right with no way to scroll; scale the frame content to fit.' },
  'navigation.spec.ts › shared mailbox switcher › on a phone › drawer items are at least 44px':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(a11y): New message and the mailbox picker in the drawer are 36-38px tall.' },
  'settings-admin.spec.ts › management pages › on a phone › management header and drawer controls are at least 44px':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(a11y): management menu button is 32px on touch screens.' },
};

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
  'message.spec.ts › on a phone › message actions fit on one row above the subject':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(reading): eight full-text buttons wrap into two or three rows above the subject on phones; use an icon toolbar with a More menu.' },
  'message.spec.ts › wide HTML mail fits the screen instead of being cut off':
    { projects: ['pixel-7', 'galaxy-s24', 'iphone-14'], todo: 'TODO(reading): 600px newsletter tables are cut off on the right with no way to scroll; scale the frame content to fit.' },
};

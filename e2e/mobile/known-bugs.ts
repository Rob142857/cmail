/**
 * Known bugs: tests expected to fail until the TODO is done.
 *
 * Key: "<spec file> › <describe> › <test title>" (as in the list reporter).
 * projects: 'all' or the device projects it fails on.
 * When a fix lands the test fails with "Expected to fail, but passed":
 * delete the entry in the same commit.
 */
export const KNOWN_BUGS: Record<string, { projects: 'all' | string[]; todo: string }> = {
  'message.spec.ts › sender text stays readable when its background colour is removed':
    { projects: 'all', todo: 'TODO(reading, sanitizer): the reading sanitizer drops background colours but keeps text colours, so white-on-colour headers become white on white. Drop or neutralise a light text colour whenever its background is removed (needs a security review; packages/shared sanitize).' },
  'compose.spec.ts › recipients become removable chips':
    { projects: 'all', todo: 'TODO(compose): To/Cc/Bcc are comma-separated text; turn confirmed addresses into chips with a remove button (L: EmailAutocomplete rework).' },
};

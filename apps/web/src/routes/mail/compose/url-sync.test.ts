import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

/** Returns the body of the first `name(() => { ... });` block in the page script. */
function callbackBody(name: string): string {
  const start = source.indexOf(`${name}(() => {`);
  if (start < 0) throw new Error(`${name} block not found`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} block not closed`);
}

describe('compose URL sync', () => {
  // On a full page load SvelteKit's root component flushes mount effects
  // inside `new Root()`, before the router has a root. replaceState() there
  // throws "Cannot read properties of undefined (reading '$set')", which
  // leaves the router without a root and breaks autosave and Send.
  it('never calls replaceState from onMount', () => {
    expect(callbackBody('onMount')).not.toMatch(/replaceState\s*\(/);
  });

  it('pins the recovery id from afterNavigate, once', () => {
    const body = callbackBody('afterNavigate');
    expect(body).toMatch(/replaceState\s*\(/);
    expect(body).toMatch(/composeUrlSynced/);
  });

  it('records the saved draft version before rewriting the URL', () => {
    const save = source.slice(source.indexOf('async function runSaveOnce'));
    const versionAt = save.indexOf('draftVersion = payload.draftVersion');
    const urlAt = save.indexOf('keepDraftInUrl(draftId)');
    expect(versionAt).toBeGreaterThan(-1);
    expect(urlAt).toBeGreaterThan(versionAt);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { loadOrgSettings } from './org-settings';

function dbWithSettings(rows: Array<{ key: string; value: string }>): D1Database {
  const prepare = vi.fn(() => ({
    all: vi.fn().mockResolvedValue({ results: rows }),
  }));
  return { prepare } as unknown as D1Database;
}

describe('loadOrgSettings signInCountries', () => {
  it('defaults to empty — feature off — when unset', async () => {
    const settings = await loadOrgSettings({ DB: dbWithSettings([]) });
    expect(settings.signInCountries).toEqual([]);
  });

  it('parses a stored JSON array of codes, deduplicated and sorted', async () => {
    const db = dbWithSettings([{ key: 'sign_in_countries', value: JSON.stringify(['nz', 'AU', 'au']) }]);
    const settings = await loadOrgSettings({ DB: db });
    expect(settings.signInCountries).toEqual(['AU', 'NZ']);
  });

  it('drops unrecognised codes but keeps valid ones', async () => {
    const db = dbWithSettings([{ key: 'sign_in_countries', value: JSON.stringify(['AU', 'ZZ', 'NZ']) }]);
    const settings = await loadOrgSettings({ DB: db });
    expect(settings.signInCountries).toEqual(['AU', 'NZ']);
  });

  it('fails open to empty (never locks the organisation out) on malformed JSON', async () => {
    const db = dbWithSettings([{ key: 'sign_in_countries', value: 'not json' }]);
    const settings = await loadOrgSettings({ DB: db });
    expect(settings.signInCountries).toEqual([]);
  });

  it('fails open to empty when the stored value is not a JSON array', async () => {
    const db = dbWithSettings([{ key: 'sign_in_countries', value: JSON.stringify({ AU: true }) }]);
    const settings = await loadOrgSettings({ DB: db });
    expect(settings.signInCountries).toEqual([]);
  });
});

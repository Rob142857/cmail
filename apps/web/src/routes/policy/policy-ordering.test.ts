import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('policy version ordering', () => {
  it('uses the policy id as a deterministic tie-breaker for same-second publications', async () => {
    const queries: string[] = [];
    const db = {
      prepare(query: string) {
        queries.push(query);
        return {
          async first() {
            return query.includes('FROM ict_policy_versions')
              ? { id: 'policy-b', version_label: 'B', body_text: 'Policy B', published_at: '2026-08-03 12:00:00' }
              : null;
          },
        };
      },
    } as unknown as D1Database;

    const result = await (load as any)({
      locals: { user: null, sessionId: null },
      platform: { env: { DB: db } },
    });

    expect(result.policy?.id).toBe('policy-b');
    expect(queries[0]).toContain('ORDER BY published_at DESC, id DESC');
  });
});

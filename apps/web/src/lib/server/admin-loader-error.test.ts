import { describe, expect, it, vi } from 'vitest';
import { adminLoaderFailure } from './admin-loader-error';

describe('admin loader failures', () => {
  it('returns a safe message and reference without exposing the database error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = adminLoaderFailure('investigation', new Error('no such column: secret_internal_column'));

    expect(result.error).not.toContain('secret_internal_column');
    expect(result.errorReference).toMatch(/^[0-9a-f-]{36}$/i);
    expect(log).toHaveBeenCalledWith('Admin investigation loader failed', expect.objectContaining({
      errorReference: result.errorReference,
      errorType: 'Error',
      message: 'no such column: secret_internal_column',
    }));
    log.mockRestore();
  });
});

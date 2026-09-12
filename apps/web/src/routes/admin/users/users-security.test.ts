import { describe, expect, it } from 'vitest';
import { managerIdentityAllowed, managerInviteProviderAllowed } from './users-security';

describe('manager invitation authentication', () => {
  it('requires an OAuth provider for manager invitations', () => {
    expect(managerInviteProviderAllowed('manager', 'google')).toBe(true);
    expect(managerInviteProviderAllowed('manager', 'microsoft')).toBe(true);
    expect(managerInviteProviderAllowed('manager', 'email')).toBe(false);
    expect(managerInviteProviderAllowed('manager', null)).toBe(false);
  });

  it('keeps email OTP available for standard invitations', () => {
    expect(managerInviteProviderAllowed('standard', 'email')).toBe(true);
  });

  it('requires an already-bound OAuth identity before promotion', () => {
    expect(managerIdentityAllowed(true)).toBe(true);
    expect(managerIdentityAllowed(false)).toBe(false);
  });
});

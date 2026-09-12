import type { AuthProvider, UserRole } from '@cmail/shared/types';

/**
 * Manager sessions require an OAuth identity. Email OTP is intentionally
 * available to standard users only, so a manager invitation must not be
 * issued through that method (or omitted entirely).
 */
export function managerInviteProviderAllowed(
  role: UserRole,
  provider: AuthProvider | null,
): boolean {
  return role !== 'manager' || managerIdentityAllowed(provider === 'google' || provider === 'microsoft');
}

/** A manager must have an immutable OAuth identity before promotion. */
export function managerIdentityAllowed(hasOAuthIdentity: boolean): boolean {
  return hasOAuthIdentity;
}

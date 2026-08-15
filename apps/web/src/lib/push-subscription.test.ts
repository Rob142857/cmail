import { describe, expect, it } from 'vitest';
import { applicationServerKey, subscriptionUsesCurrentVapidKey } from './push-subscription';

describe('push subscription VAPID key comparison', () => {
  const publicKey = 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  it('preserves a subscription when the browser does not expose its historic VAPID key', () => {
    expect(subscriptionUsesCurrentVapidKey(null, publicKey)).toBe(true);
  });

  it('rotates only a present, mismatched VAPID key', () => {
    expect(subscriptionUsesCurrentVapidKey(applicationServerKey(publicKey).buffer, publicKey)).toBe(true);
    expect(subscriptionUsesCurrentVapidKey(new Uint8Array([4, 1, 2]).buffer, publicKey)).toBe(false);
  });
});

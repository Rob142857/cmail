import { describe, expect, it } from 'vitest';
import {
  assertStrongSessionSecret,
  draftSaveRatePerHour,
  maxDraftsPerMailboxUser,
  maxRecipientsPerMessage,
  maxSessionsPerUser,
  outboundRateLimitPerHour,
  outboundWorkLimitPerHour,
  publicRuntimeConfig,
  sessionTtlMs,
} from './config';

describe('runtime configuration', () => {
  it('exposes only validated public branding values', () => {
    expect(publicRuntimeConfig({
      APP_NAME: ' Example Mail ',
      APP_URL: 'javascript:alert(1)',
      MAIL_DOMAIN: 'EXAMPLE.COM',
      BRAND_LOGO_URL: '//tracker.example/logo.svg',
      BRAND_ICON_URL: 'https://cdn.example.com/icon.svg',
      BRAND_ICON_192_URL: 'https://cdn.example.com/icon-192.png',
      BRAND_ICON_512_URL: 'data:image/png;base64,unsafe',
      BRAND_PRIMARY_COLOR: '#12abEF',
      LOCALE: 'en-AU',
      TIME_ZONE: 'Australia/Sydney',
    })).toEqual({
      appName: 'Example Mail',
      appUrl: '',
      mailDomain: 'example.com',
      brandLogoUrl: '/logo.svg',
      brandIconUrl: 'https://cdn.example.com/icon.svg',
      brandIcon192Url: 'https://cdn.example.com/icon-192.png',
      brandIcon512Url: '/icon-512.png',
      brandOgImageUrl: '/og-image.svg',
      brandPrimaryColor: '#12abEF',
      brandOnPrimary: '#111827',
      pushPublicKey: '',
      locale: 'en-AU',
      timeZone: 'Australia/Sydney',
    });
  });

  it('falls back when locale, timezone, colour, or limits are invalid', () => {
    const env = {
      LOCALE: 'not_a_locale',
      TIME_ZONE: 'Moon/Base',
      BRAND_PRIMARY_COLOR: 'red',
      SESSION_TTL_HOURS: '999',
      MAX_SESSIONS_PER_USER: '0',
      MAX_RECIPIENTS_PER_MESSAGE: 'invalid',
      OUTBOUND_RATE_LIMIT_PER_HOUR: '-2',
      OUTBOUND_WORK_LIMIT_PER_HOUR: 'invalid',
      DRAFT_SAVE_RATE_PER_HOUR: 'invalid',
      MAX_DRAFTS_PER_MAILBOX_USER: '0',
    };
    const config = publicRuntimeConfig(env);
    expect(config.locale).toBe('en');
    expect(config.timeZone).toBe('UTC');
    expect(config.brandPrimaryColor).toBe('#2563eb');
    expect(config.brandOnPrimary).toBe('#ffffff');
    expect(sessionTtlMs(env)).toBe(168 * 60 * 60 * 1000);
    expect(maxSessionsPerUser(env)).toBe(1);
    expect(maxRecipientsPerMessage(env)).toBe(50);
    expect(outboundRateLimitPerHour(env)).toBe(1);
    expect(outboundWorkLimitPerHour(env)).toBe(600);
    expect(draftSaveRatePerHour(env)).toBe(300);
    expect(maxDraftsPerMailboxUser(env)).toBe(1);
  });

  it('chooses readable text for light brand colours and exposes push only when complete', () => {
    const base64Url = (value: Uint8Array) => {
      let binary = '';
      for (const byte of value) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    };
    const vapid = {
      VAPID_PUBLIC_KEY: base64Url(Uint8Array.from({ length: 65 }, (_, index) => index === 0 ? 4 : 0)),
      VAPID_PRIVATE_KEY: base64Url(new Uint8Array(32).fill(1)),
      VAPID_SUBJECT: 'mailto:operator@example.com',
    };
    expect(publicRuntimeConfig({ BRAND_PRIMARY_COLOR: '#ffffff', ...vapid })).toMatchObject({
      brandOnPrimary: '#111827',
      pushPublicKey: vapid.VAPID_PUBLIC_KEY,
    });
    expect(publicRuntimeConfig({ VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY }).pushPublicKey).toBe('');
  });

  it('requires a non-placeholder session secret with enough entropy space', () => {
    expect(() => assertStrongSessionSecret('change-me-change-me-change-me-change-me')).toThrow();
    expect(() => assertStrongSessionSecret('short')).toThrow();
    expect(() => assertStrongSessionSecret('9b31cc4df6ca42c3a60cedd53d63a90f8de45aae0b72a749')).not.toThrow();
  });

  it('hard-caps configurable compose workload limits', () => {
    const env = {
      MAX_RECIPIENTS_PER_MESSAGE: '200',
      OUTBOUND_WORK_LIMIT_PER_HOUR: '5000',
      DRAFT_SAVE_RATE_PER_HOUR: '5000',
      MAX_DRAFTS_PER_MAILBOX_USER: '5000',
    };
    expect(maxRecipientsPerMessage(env)).toBe(100);
    expect(outboundWorkLimitPerHour(env)).toBe(1000);
    expect(draftSaveRatePerHour(env)).toBe(2000);
    expect(maxDraftsPerMailboxUser(env)).toBe(1000);
  });
});

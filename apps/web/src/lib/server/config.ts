import { boundedInteger, normalizeDomain } from './validation';
import { publicPushKey } from '@cmail/shared/push';

const DEFAULT_PRIMARY = '#0078d4';

function envString(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function safePublicUrl(value: string, fallback: string): string {
  if (!value) return fallback;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password) return fallback;
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      ? url.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

function validLocale(value: string): string {
  if (!value || value.length > 35) return 'en';
  try {
    return Intl.getCanonicalLocales(value)[0] || 'en';
  } catch {
    return 'en';
  }
}

function validTimeZone(value: string): string {
  if (!value || value.length > 100) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value;
  } catch {
    return 'UTC';
  }
}

function onPrimaryColor(value: string): '#ffffff' | '#111827' {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const luminance = channels
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const whiteContrast = 1.05 / (luminance + 0.05);
  return whiteContrast >= 4.5 ? '#ffffff' : '#111827';
}

export function assertStrongSessionSecret(secret: unknown): asserts secret is string {
  if (
    typeof secret !== 'string' ||
    secret.length < 32 ||
    /^(change-me|replace-me|generate-|secret|password)/i.test(secret)
  ) {
    throw new Error('SESSION_SECRET must be a random value of at least 32 characters');
  }
}

export function assertStrongBootstrapToken(token: unknown): asserts token is string {
  if (
    typeof token !== 'string' ||
    token.length < 32 ||
    token.length > 512 ||
    /^(change-me|replace-me|generate-|token|secret|password)/i.test(token)
  ) {
    throw new Error('BOOTSTRAP_ADMIN_TOKEN must be a random value of 32 to 512 characters');
  }
}

export function publicRuntimeConfig(env: Record<string, unknown>) {
  const primary = envString(env, 'BRAND_PRIMARY_COLOR');
  const brandPrimaryColor = /^#[\da-f]{6}$/i.test(primary) ? primary : DEFAULT_PRIMARY;
  return {
    appName: envString(env, 'APP_NAME') || 'cmail',
    appUrl: safePublicUrl(envString(env, 'APP_URL'), ''),
    mailDomain: normalizeDomain(envString(env, 'MAIL_DOMAIN')) || '',
    brandLogoUrl: safePublicUrl(envString(env, 'BRAND_LOGO_URL'), '/logo.svg'),
    brandIconUrl: safePublicUrl(envString(env, 'BRAND_ICON_URL'), '/icon.svg'),
    brandIcon192Url: safePublicUrl(envString(env, 'BRAND_ICON_192_URL'), '/icon-192.png'),
    brandIcon512Url: safePublicUrl(envString(env, 'BRAND_ICON_512_URL'), '/icon-512.png'),
    brandOgImageUrl: safePublicUrl(envString(env, 'BRAND_OG_IMAGE_URL'), '/og-image.svg'),
    brandPrimaryColor,
    brandOnPrimary: onPrimaryColor(brandPrimaryColor),
    pushPublicKey: publicPushKey(env),
    locale: validLocale(envString(env, 'LOCALE')),
    timeZone: validTimeZone(envString(env, 'TIME_ZONE')),
  };
}

/**
 * SESSION_TTL_HOURS is an inactivity window, not a fixed sign-in length:
 * hooks.server.ts slides a session's DB-row expiry back out to a fresh TTL
 * while it keeps being used (see shouldRenewSession in lib/server/session.ts),
 * so a session only lapses after this many hours with no activity at all.
 * The 9600-hour (400-day) ceiling matches the session cookie's own fixed
 * Max-Age, which is itself capped by Chrome at 400 days.
 */
export function sessionTtlMs(env: Record<string, unknown>): number {
  return boundedInteger(env.SESSION_TTL_HOURS, 8, 1, 9600) * 60 * 60 * 1000;
}

export function maxSessionsPerUser(env: Record<string, unknown>): number {
  return boundedInteger(env.MAX_SESSIONS_PER_USER, 5, 1, 20);
}

/** EMAIL_OTP_ENABLED defaults ON; only the literal string "false" disables it. */
export function emailOtpEnabled(env: Record<string, unknown>): boolean {
  return envString(env, 'EMAIL_OTP_ENABLED').toLowerCase() !== 'false';
}

/**
 * OTP-issued sessions are capped to at most OTP_SESSION_TTL_HOURS (default
 * 168h/7 days) even when SESSION_TTL_HOURS is configured longer, since an
 * OTP identity carries none of an OAuth account's ongoing provider-side
 * revocation/2FA guarantees.
 */
export function otpSessionTtlMs(env: Record<string, unknown>): number {
  const capped = boundedInteger(env.OTP_SESSION_TTL_HOURS, 168, 1, 9600) * 60 * 60 * 1000;
  return Math.min(sessionTtlMs(env), capped);
}

/**
 * Comma-separated ISO-3166-1 alpha-2 allowlist for email-OTP sign-in and
 * enrolment requests, matched against the CF-IPCountry request header.
 * `null` means unset/blank — no restriction, every country passes. A
 * variable that IS set but contains no recognisable 2-letter code fails
 * closed to an empty allowlist (blocks every country) rather than silently
 * behaving as unset, matching this deployment's fail-closed posture
 * elsewhere (see getEnabledProviders in auth.ts) — a rejected sign-in is
 * loud and immediately reported; a silently-ignored restriction is not.
 */
export function authOtpAllowedCountries(env: Record<string, unknown>): string[] | null {
  const raw = envString(env, 'AUTH_OTP_ALLOWED_COUNTRIES');
  if (!raw) return null;
  const codes = raw
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => /^[A-Z]{2}$/.test(entry));
  return [...new Set(codes)];
}

export function maxRecipientsPerMessage(env: Record<string, unknown>): number {
  return boundedInteger(env.MAX_RECIPIENTS_PER_MESSAGE, 50, 1, 100);
}

export function outboundRateLimitPerHour(env: Record<string, unknown>): number {
  return boundedInteger(env.OUTBOUND_RATE_LIMIT_PER_HOUR, 60, 1, 1000);
}

/** Recipient-payload MiB units available to one user in each hourly window. */
export function outboundWorkLimitPerHour(env: Record<string, unknown>): number {
  return boundedInteger(env.OUTBOUND_WORK_LIMIT_PER_HOUR, 600, 1, 1000);
}

/** Autosaves and explicit saves available to one user for one mailbox hourly. */
export function draftSaveRatePerHour(env: Record<string, unknown>): number {
  return boundedInteger(env.DRAFT_SAVE_RATE_PER_HOUR, 300, 1, 2000);
}

/** Maximum retained draft rows owned by one user in one mailbox. */
export function maxDraftsPerMailboxUser(env: Record<string, unknown>): number {
  return boundedInteger(env.MAX_DRAFTS_PER_MAILBOX_USER, 100, 1, 1000);
}

import { boundedInteger, normalizeDomain } from './validation';
import { publicPushKey } from '@cmail/shared/push';

const DEFAULT_PRIMARY = '#2563eb';

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

export function sessionTtlMs(env: Record<string, unknown>): number {
  return boundedInteger(env.SESSION_TTL_HOURS, 8, 1, 168) * 60 * 60 * 1000;
}

export function maxSessionsPerUser(env: Record<string, unknown>): number {
  return boundedInteger(env.MAX_SESSIONS_PER_USER, 5, 1, 20);
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

export async function consumeRateLimit(
  db: D1Database,
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number,
  cost = 1,
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  if (!Number.isSafeInteger(cost) || cost < 1 || cost > 1_000_000) {
    throw new RangeError('Rate-limit cost must be an integer between 1 and 1,000,000');
  }
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSeconds);
  const key = `${scope}:${subject}:${bucket}`;
  const expiresAt = (bucket + 1) * windowSeconds;

  const row = await db.prepare(
    `INSERT INTO rate_limits (key, count, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + excluded.count
     RETURNING count`,
  ).bind(key, cost, expiresAt).first<{ count: number }>();

  const count = row?.count ?? limit + 1;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, expiresAt - now),
  };
}

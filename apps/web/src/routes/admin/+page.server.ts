import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env;
  if (!env) return { stats: null };

  const [users, mailboxes, messages, activeSessions] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) as count FROM mailboxes').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) as count FROM messages').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) as count FROM sessions WHERE revoked = 0 AND expires_at > datetime(\'now\')').first<{ count: number }>(),
  ]);

  return {
    stats: {
      users: users?.count || 0,
      mailboxes: mailboxes?.count || 0,
      messages: messages?.count || 0,
      activeSessions: activeSessions?.count || 0,
    },
  };
};

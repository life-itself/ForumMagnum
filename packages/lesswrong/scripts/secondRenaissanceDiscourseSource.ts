import pgPromise from "pg-promise";
import type { SourceData } from "./secondRenaissanceMigrationChecks";

/**
 * Reads a restored Second Renaissance Discourse backup. The source must be a
 * local database named discourse_backup* (DISCOURSE_SOURCE_URL); it's only
 * read, inside a read-only transaction.
 */

export function getSourceUrl(): string {
  const raw = process.env.DISCOURSE_SOURCE_URL;
  if (!raw) throw new Error("DISCOURSE_SOURCE_URL is required");
  const url = new URL(raw);
  // Restored backups are named discourse_backup, discourse_backup_2026, etc.
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/discourse_backup\w*$/.test(url.pathname)) {
    throw new Error("DISCOURSE_SOURCE_URL must point at a local discourse_backup* database");
  }
  return raw;
}

// Discourse stores UTC timestamps without a time zone
const utcTimestamp = (column: string) => `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export async function loadDiscourseSource(): Promise<SourceData> {
  const source = pgPromise()(getSourceUrl());
  try {
    return await source.tx(async t => {
      await t.none("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const users = await t.any(`
        SELECT u.id, u.username, u.name, ${utcTimestamp("u.created_at")} AS "createdAt",
          CASE WHEN u.id > 0 AND NOT u.staged THEN e.email END AS email
        FROM users u
        LEFT JOIN user_emails e ON e.user_id = u.id AND e."primary"
        WHERE u.id > 0 OR u.id = -1
      `);
      // Discourse sets read_restricted on categories that "everyone" can't see.
      // Categories that only limit who can post (like Meta) stay public.
      const topics = await t.any(`
        SELECT t.id, t.title, t.archetype, t.visible, t.category_id AS "categoryId",
          COALESCE(c.read_restricted, FALSE) AS restricted
        FROM topics t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.deleted_at IS NULL
      `);
      const posts = await t.any(`
        SELECT p.id, p.topic_id AS "topicId", p.post_number AS "postNumber",
          p.reply_to_post_number AS "replyToPostNumber", p.user_id AS "userId",
          ${utcTimestamp("p.created_at")} AS "createdAt",
          p.hidden, p.user_deleted AS "userDeleted", p.cooked
        FROM posts p
        JOIN topics t ON t.id = p.topic_id
        WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.post_type = 1
      `);
      return {
        users: users.map(u => ({ ...u, createdAt: new Date(u.createdAt) })),
        topics,
        posts: posts.map(p => ({ ...p, createdAt: new Date(p.createdAt) })),
      };
    });
  } finally {
    // Only close this connection; pgp.end() would also close the app's database pool
    await source.$pool.end();
  }
}

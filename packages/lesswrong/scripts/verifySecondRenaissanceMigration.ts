import pgPromise from "pg-promise";
import { getSqlClientOrThrow } from "@/server/sql/sqlClient";
import { getSourceUrl } from "./createSecondRenaissanceCategoryTags";
import {
  checkSecondRenaissanceMigration,
  type MigrationCheckResult,
  type SourceData,
  type TargetData,
} from "./secondRenaissanceMigrationChecks";

/* eslint-disable no-console */

/**
 * Read-only check that the migrated Second Renaissance data matches the
 * Discourse backup (issue #36): users, posts, comments, authors, dates, comment
 * nesting and category tags, and that no private messages or Staff topics were
 * migrated. Run it after every migration run. Throws if anything is wrong.
 *
 * Reads the local `discourse_backup` database (DISCOURSE_SOURCE_URL, localhost
 * only) and the app database. Neither is written to.
 *
 * Usage: yarn repl prod lw packages/lesswrong/scripts/verifySecondRenaissanceMigration.ts "verifySecondRenaissanceMigration()"
 */

async function loadSource(): Promise<SourceData> {
  const source = pgPromise()(getSourceUrl());
  try {
    return await source.tx(async t => {
      await t.none("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const users = await t.any(`
        SELECT id, username, name
        FROM users
        WHERE id > 0 OR id = -1
      `);
      const topics = await t.any(`
        SELECT t.id, t.title, t.archetype, t.visible, t.category_id AS "categoryId",
          COALESCE(c.read_restricted, FALSE)
            OR EXISTS (SELECT 1 FROM category_groups cg WHERE cg.category_id = t.category_id) AS restricted
        FROM topics t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.deleted_at IS NULL
      `);
      // Discourse stores UTC timestamps without a time zone
      const posts = await t.any(`
        SELECT p.id, p.topic_id AS "topicId", p.post_number AS "postNumber",
          p.reply_to_post_number AS "replyToPostNumber", p.user_id AS "userId",
          to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
          p.hidden, p.user_deleted AS "userDeleted"
        FROM posts p
        JOIN topics t ON t.id = p.topic_id
        WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.post_type = 1
      `);
      return {
        users,
        topics,
        posts: posts.map(p => ({ ...p, createdAt: new Date(p.createdAt) })),
      };
    });
  } finally {
    // Only close this connection; pgp.end() would also close the app's database pool
    await source.$pool.end();
  }
}

async function loadTarget(): Promise<TargetData> {
  const db = getSqlClientOrThrow("read");
  const users = await db.any(`
    -- verifySecondRenaissanceMigration.loadTarget users
    SELECT _id, "legacyData"->>'secondRenaissanceDiscourseUserId' AS "discourseUserId", "displayName"
    FROM "Users"
    WHERE "legacyData" ? 'secondRenaissanceDiscourseUserId'
  `);
  const posts = await db.any(`
    -- verifySecondRenaissanceMigration.loadTarget posts
    SELECT p._id,
      p."legacyData"->>'secondRenaissanceDiscourseTopicId' AS "discourseTopicId",
      p."legacyData"->>'secondRenaissanceDiscourseOpeningPostId' AS "discourseOpeningPostId",
      p.title, p."postedAt", p."userId", p.draft, p."deletedDraft",
      COALESCE(TRIM(r.html) <> '', FALSE) AS "hasContents",
      ARRAY(
        SELECT t.slug FROM "TagRels" tr JOIN "Tags" t ON t._id = tr."tagId"
        WHERE tr."postId" = p._id AND NOT tr.deleted AND NOT t.deleted
      ) AS "tagSlugs"
    FROM "Posts" p
    LEFT JOIN "Revisions" r ON r._id = p.contents_latest
    WHERE p."legacyData" ? 'secondRenaissanceDiscourseTopicId'
  `);
  const comments = await db.any(`
    -- verifySecondRenaissanceMigration.loadTarget comments
    SELECT c._id, c."legacyData"->>'secondRenaissanceDiscoursePostId' AS "discoursePostId",
      c."postId", c."userId", c."postedAt", c."parentCommentId", c."topLevelCommentId", c.deleted,
      COALESCE(TRIM(r.html) <> '', FALSE) AS "hasContents"
    FROM "Comments" c
    LEFT JOIN "Revisions" r ON r._id = c.contents_latest
    WHERE c."legacyData" ? 'secondRenaissanceDiscoursePostId'
  `);
  return { users, posts, comments };
}

function printResult({ expected, migrated, problems }: MigrationCheckResult): void {
  console.log(`Users:    ${migrated.users} migrated, ${expected.users} expected`);
  console.log(`Posts:    ${migrated.posts} migrated, ${expected.posts} expected`);
  console.log(`Comments: ${migrated.comments} migrated, ${expected.comments} expected`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.log(`- ${problem}`);
  } else {
    console.log("\nPASSED: the migrated data matches the Discourse backup.");
  }
}

export async function verifySecondRenaissanceMigration(): Promise<MigrationCheckResult> {
  const [source, target] = await Promise.all([loadSource(), loadTarget()]);
  const result = checkSecondRenaissanceMigration(source, target);
  printResult(result);
  if (result.problems.length) {
    throw new Error(`Migration verification failed with ${result.problems.length} problem(s)`);
  }
  return result;
}

export default verifySecondRenaissanceMigration;

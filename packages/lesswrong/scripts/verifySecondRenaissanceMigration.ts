import { getSqlClientOrThrow } from "@/server/sql/sqlClient";
import { loadDiscourseSource } from "./secondRenaissanceDiscourseSource";
import {
  checkSecondRenaissanceMigration,
  type MigrationCheckResult,
  type TargetData,
} from "./secondRenaissanceMigrationChecks";

/* eslint-disable no-console */

/**
 * Read-only check that the migrated Second Renaissance data matches the
 * Discourse backup (issue #36): users, posts, comments, authors, dates, comment
 * nesting, comment counts and category tags, and that no private messages or
 * Staff topics were migrated. Run it after every migration run. Throws if anything is wrong.
 *
 * Reads a local `discourse_backup*` database (DISCOURSE_SOURCE_URL, localhost
 * only) and the app database. Neither is written to.
 *
 * Usage: yarn repl prod lw packages/lesswrong/scripts/verifySecondRenaissanceMigration.ts "verifySecondRenaissanceMigration()"
 */

async function loadTarget(): Promise<TargetData> {
  const db = getSqlClientOrThrow("read");
  const users = await db.any(`
    -- verifySecondRenaissanceMigration.loadTarget users
    SELECT _id, "legacyData"->>'secondRenaissanceDiscourseUserId' AS "discourseUserId", "displayName",
      LOWER(email) AS email,
      COALESCE(("legacyData"->>'secondRenaissanceDiscourseClaimed')::boolean, FALSE) AS claimed,
      "reviewedByUserId" IS NOT NULL AS reviewed, COALESCE(karma, 0) AS karma
    FROM "Users"
    WHERE "legacyData" ? 'secondRenaissanceDiscourseUserId'
  `);
  const otherAccounts = await db.any(`
    -- verifySecondRenaissanceMigration.loadTarget otherAccounts
    SELECT username, LOWER(email) AS email
    FROM "Users"
    WHERE NOT COALESCE("legacyData" ? 'secondRenaissanceDiscourseUserId', FALSE)
      AND NOT deleted AND email IS NOT NULL
  `);
  const posts = await db.any(`
    -- verifySecondRenaissanceMigration.loadTarget posts
    SELECT p._id,
      p."legacyData"->>'secondRenaissanceDiscourseTopicId' AS "discourseTopicId",
      p."legacyData"->>'secondRenaissanceDiscourseOpeningPostId' AS "discourseOpeningPostId",
      p.title, p."postedAt", p."userId", p.draft, p."deletedDraft", p."commentCount",
      EXISTS (SELECT 1 FROM "Votes" v WHERE v."documentId" = p._id AND v."userId" = p."userId" AND NOT v.cancelled) AS "hasSelfVote",
      COALESCE(TRIM(r.html) <> '', FALSE) AS "hasContents",
      (
        SELECT COUNT(*)::int FROM "Comments" c
        WHERE c."postId" = p._id AND NOT c.deleted
          AND NOT COALESCE(c."legacyData" ? 'secondRenaissanceDiscoursePostId', FALSE)
      ) AS "forumCommentCount",
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
      EXISTS (SELECT 1 FROM "Votes" v WHERE v."documentId" = c._id AND v."userId" = c."userId" AND NOT v.cancelled) AS "hasSelfVote",
      COALESCE(TRIM(r.html) <> '', FALSE) AS "hasContents"
    FROM "Comments" c
    LEFT JOIN "Revisions" r ON r._id = c.contents_latest
    WHERE c."legacyData" ? 'secondRenaissanceDiscoursePostId'
  `);
  return { users, otherAccounts, posts, comments };
}

function printResult({ expected, migrated, problems, notes }: MigrationCheckResult): void {
  console.log(`Users:    ${migrated.users} migrated, ${expected.users} expected`);
  console.log(`Posts:    ${migrated.posts} migrated, ${expected.posts} expected`);
  console.log(`Comments: ${migrated.comments} migrated, ${expected.comments} expected`);
  for (const note of notes) console.log(`Note: ${note}`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.log(`- ${problem}`);
  } else {
    console.log("\nPASSED: the migrated data matches the Discourse backup.");
  }
}

export async function verifySecondRenaissanceMigration(): Promise<MigrationCheckResult> {
  const [source, target] = await Promise.all([loadDiscourseSource(), loadTarget()]);
  const result = checkSecondRenaissanceMigration(source, target);
  printResult(result);
  if (result.problems.length) {
    throw new Error(`Migration verification failed with ${result.problems.length} problem(s)`);
  }
  return result;
}

export default verifySecondRenaissanceMigration;

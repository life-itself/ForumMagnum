/**
 * Full Second Renaissance Discourse -> ForumMagnum production importer (preflight by default).
 * Reads local discourse_backup and targets ONLY the verified Railway public PostgreSQL proxy, database railway.
 * Prerequisite: verified Railway snapshot and independently tested portable backup. Default is READ-ONLY preflight.
 * Source: 29 regular users plus the historical Discourse system account, 81 non-deleted topics (40 private messages); public subset: 41 topics and 60 replies.
 * Excludes private messages and known private Staff category topics; refuses unknown restrictions, hidden content, partial target imports.
 * Does NOT migrate attachments, categories, reactions, credentials or account ownership.
 */
import pgPromise from "pg-promise";
import { randomId } from "../packages/lesswrong/lib/random";
import { sanitize } from "../packages/lesswrong/lib/utils/sanitize";
import { getSqlClient } from "../packages/lesswrong/server/sql/sqlClient";
import { htmlToChangeMetrics } from "../packages/lesswrong/server/editor/utils";
import { dataToMarkdown } from "../packages/lesswrong/server/editor/conversionUtils";

const SOURCE_DB = "discourse_backup";
const TARGET_DB = "railway";
const EXPECTED = { users: 30, sourceTopics: 81, sourceReplies: 83, sourcePosts: 164, privateTopics: 40, publicTopics: 41, publicReplies: 60, publicPosts: 101 };
const RESTRICTED_STAFF_TOPIC_IDS = [2, 4, 6];
const EXPECTED_ELIGIBLE_TOPICS = 38;

type SourceUser = { id: number; username: string; name: string | null; created_at: string };
type SourceTopic = { id: number; title: string; visible: boolean; archetype: string; category_id: number | null; closed: boolean; archived: boolean };
type SourcePost = { id: number; topic_id: number; post_number: number; reply_to_post_number: number | null; user_id: number; cooked: string; created_at: string; hidden: boolean; user_deleted: boolean };
type Prepared = { source: SourcePost; id: string; revisionId: string; authorId: string; date: Date; html: string; wordCount: number; metrics: ReturnType<typeof htmlToChangeMetrics> };

function safeUrl(name: string, expectedDb: string): string {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is required`);
  const u = new URL(raw);
  const validProtocol = ['postgres:', 'postgresql:'].includes(u.protocol);
  const validSource = name === 'DISCOURSE_SOURCE_URL' && ['localhost', '127.0.0.1'].includes(u.hostname);
  const validTarget = name !== 'DISCOURSE_SOURCE_URL' &&
    u.hostname.endsWith('.proxy.rlwy.net') && !!u.port && !!u.username;
  if (!validProtocol || u.pathname !== `/${expectedDb}` || !(validSource || validTarget)) {
    throw new Error(`${name}: refused database host/name (source must be local; target must be Railway proxy /${expectedDb})`);
  }
  return raw;
}

function makeContents(p: Prepared) {
  return { html: p.html, originalContents: {type: 'ckEditorMarkup', data: p.html, yjsState: null},
    wordCount: p.wordCount, editedAt: p.date.toISOString(), version: '1.1.0',
    userId: p.authorId, changeMetrics: p.metrics };
}
function prepare(source: SourcePost, authorId: string): Prepared {
  if (typeof source.cooked !== 'string' || !source.cooked.trim()) throw new Error(`Missing HTML: Discourse post ${source.id}`);
  const html = sanitize(source.cooked);
  if (!html.trim()) throw new Error(`Sanitization removed all content in Discourse post ${source.id}`);
  const markdown = dataToMarkdown(html, 'html');
  if (typeof markdown !== 'string') throw new Error(`Markdown conversion failed for ${source.id}`);
  const date = new Date(source.created_at);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid Discourse timestamp ${source.id}`);
  return { source, authorId, id: randomId(), revisionId: randomId(), date, html,
    wordCount: markdown.trim() ? markdown.trim().split(/\s+/).length : 0,
    metrics: htmlToChangeMetrics('', html) };
}
async function insertRevision(tx: any, p: Prepared, collection: 'Posts'|'Comments') {
  await tx.none(`INSERT INTO "Revisions" ("_id","documentId","collectionName","fieldName","editedAt","version","userId","originalContents","html","wordCount","changeMetrics")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb)`,
    [p.revisionId, p.id, collection, 'contents', p.date, '1.1.0', p.authorId,
      JSON.stringify(makeContents(p).originalContents), p.html, p.wordCount, JSON.stringify(p.metrics)]);
}

async function main() {
  const sourceUrl = safeUrl('DISCOURSE_SOURCE_URL', SOURCE_DB);
  const targetUrl = safeUrl('PG_URL', TARGET_DB);
  const readUrl = safeUrl('PG_READ_URL', TARGET_DB);
  if (targetUrl !== readUrl) throw new Error('PG_URL and PG_READ_URL must use exactly the same verified Railway connection');
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--execute')) {
    throw new Error('Usage: ts-node script.ts [--execute]. Default is READ-ONLY preflight.');
  }
  const execute = args[0] === '--execute';
  if (execute && process.env.CONFIRM_RAILWAY_IMPORT !== 'IMPORT_38_PUBLIC_TOPICS') {
    throw new Error('Production execution requires CONFIRM_RAILWAY_IMPORT=IMPORT_38_PUBLIC_TOPICS');
  }
  console.log(execute ? 'MODE: PRODUCTION IMPORT — will write atomically after guards' : 'MODE: READ-ONLY PREFLIGHT — no changes will be made');
  const pgp = pgPromise();
  const source = pgp(sourceUrl);
  try {
    // Single consistent, read-only snapshot. Source database is NEVER written to.
    const {users, topics, posts} = await source.tx(async t => {
      await t.none('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const name = await t.one('SELECT current_database() AS name');
      if (name.name !== SOURCE_DB) throw new Error('Unexpected source database');
      const users: SourceUser[] = await t.any(`SELECT id, username, name,
        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
        FROM users WHERE id > 0 OR id = -1 ORDER BY id`);
      const topics: SourceTopic[] = await t.any(`SELECT id, title, visible, archetype, category_id, closed, archived
        FROM topics WHERE deleted_at IS NULL ORDER BY id`);
      const posts: SourcePost[] = await t.any(`SELECT p.id, p.topic_id, p.post_number, p.reply_to_post_number,
        p.user_id, p.cooked, p.hidden, p.user_deleted,
        to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
        FROM posts p JOIN topics t ON t.id = p.topic_id
        WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.post_type = 1
        ORDER BY p.topic_id, p.post_number`);
      return {users, topics, posts};
    });

    // Preserve the real historical system author (-1) instead of losing public announcements.
    const systemAccount = users.find(u => u.id === -1);
    if (!systemAccount || systemAccount.username !== 'system' || users.filter(u => u.id === -1).length !== 1)
      throw new Error('Expected exactly one Discourse system account (id -1, username system). Refusing import.');
    if (users.filter(u => u.id > 0).length !== 29)
      throw new Error('Unexpected number of regular Discourse users.');

    // The Discourse backup includes PRIVATE MESSAGES. Do not publish them.
    const allReplies = posts.filter(p => p.post_number > 1);
    const privateTopics = topics.filter(t => t.archetype === 'private_message');
    const unexpectedTopics = topics.filter(t => t.archetype !== 'private_message' && (t.archetype !== 'regular' || !t.visible));
    const publicTopics = topics.filter(t => t.archetype === 'regular' && t.visible);
    const publicIds = new Set(publicTopics.map(t => t.id));
    const publicPosts = posts.filter(p => publicIds.has(p.topic_id));
    const publicReplies = publicPosts.filter(p => p.post_number > 1);
    console.log(`Backup: ${users.length - 1} regular users plus system, ${topics.length} surviving topics (${privateTopics.length} private-message topics), ${posts.length} posts.`);
    console.log(`Public import scope: ${publicTopics.length} discussions, ${publicReplies.length} comments, ${publicPosts.length} revisions.`);
    if (users.length !== EXPECTED.users || topics.length !== EXPECTED.sourceTopics ||
        allReplies.length !== EXPECTED.sourceReplies || posts.length !== EXPECTED.sourcePosts ||
        privateTopics.length !== EXPECTED.privateTopics || publicTopics.length !== EXPECTED.publicTopics ||
        publicReplies.length !== EXPECTED.publicReplies || publicPosts.length !== EXPECTED.publicPosts || unexpectedTopics.length)
      throw new Error(`Source eligibility/counts changed; review before import. Unexpected topics: ${unexpectedTopics.map(t => t.id).join(',')}`);
    // Discourse can mark private staff topics visible=true and archetype=regular.
    // Confirm the known restricted category and fail closed if access rules change.
    const category = await source.oneOrNone(`SELECT id, name, slug, read_restricted FROM categories WHERE id = 3`);
    if (!category || category.name !== 'Staff' || category.slug !== 'staff' || category.read_restricted !== true)
      throw new Error('Staff category #3 is not as expected; review before public import.');
    const restricted = await source.any(`SELECT t.id AS topic_id, t.category_id
      FROM topics t WHERE t.id IN ($1:csv) AND (
        EXISTS (SELECT 1 FROM category_groups cg WHERE cg.category_id = t.category_id)
        OR EXISTS (SELECT 1 FROM categories c WHERE c.id = t.category_id AND c.read_restricted = TRUE)
      ) ORDER BY t.id`, [publicTopics.map(t => t.id)]);
    const actualRestrictedIds = restricted.map(r => Number(r.topic_id)).sort((a,b) => a-b);
    if (JSON.stringify(actualRestrictedIds) !== JSON.stringify(RESTRICTED_STAFF_TOPIC_IDS))
      throw new Error(`Unexpected restricted public-looking topics: ${JSON.stringify(restricted)}. Refusing import.`);
    if (restricted.some(r => Number(r.category_id) !== 3))
      throw new Error('Restricted topic outside Staff category #3.');
    const blocked = new Set(RESTRICTED_STAFF_TOPIC_IDS);
    const eligibleTopics = publicTopics.filter(t => !blocked.has(t.id));
    const eligibleIds = new Set(eligibleTopics.map(t => t.id));
    const eligiblePosts = publicPosts.filter(p => eligibleIds.has(p.topic_id));
    const eligibleReplies = eligiblePosts.filter(p => p.post_number > 1);
    if (eligibleTopics.length !== EXPECTED_ELIGIBLE_TOPICS ||
        eligiblePosts.length !== eligibleTopics.length + eligibleReplies.length)
      throw new Error('Unexpected eligible public content counts.');
    const hiddenPosts = eligiblePosts.filter(p => p.hidden || p.user_deleted);
    if (hiddenPosts.length) throw new Error(`Source contains ${hiddenPosts.length} hidden/user-deleted public posts: ${hiddenPosts.map(p => p.id).join(', ')}. Review eligibility before import.`);
    console.log(`Excluding Staff topics ${RESTRICTED_STAFF_TOPIC_IDS.join(', ')} and all private messages.`);
    console.log(`Eligible PUBLIC scope: ${eligibleTopics.length} discussions, ${eligibleReplies.length} comments, ${eligiblePosts.length} revisions.`);
    if (new Set(users.map(u => u.id)).size !== users.length || users.some(u => !u.username?.trim())) throw new Error('Duplicate/malformed users');
    if (new Set(topics.map(t => t.id)).size !== topics.length) throw new Error('Duplicate source topic ID');
    const usersById = new Map(users.map(u => [u.id, u]));
    const postsByTopic = new Map<number, SourcePost[]>();
    for (const p of eligiblePosts) {
      if (!usersById.has(p.user_id)) throw new Error(`Missing source author ${p.user_id}`);
      if (!postsByTopic.has(p.topic_id)) postsByTopic.set(p.topic_id, []);
      postsByTopic.get(p.topic_id)!.push(p);
    }
    for (const topic of eligibleTopics) {
      const group = postsByTopic.get(topic.id) ?? [];
      if (!topic.title?.trim() || group.filter(p => p.post_number === 1).length !== 1 || new Set(group.map(p => p.post_number)).size !== group.length)
        throw new Error(`Bad opening post/title or duplicate post numbers: topic ${topic.id}`);
      for (const p of group) {
        if (p.reply_to_post_number == null || p.reply_to_post_number === 1) continue;
        const parent = group.find(other => other.post_number === p.reply_to_post_number);
        if (!parent || parent.post_number >= p.post_number) throw new Error(`Invalid parent for post ${p.id}`);
      }
    }
    // ForumMagnum-specific client and schema. Target must be Railway public proxy and db railway.
    const target = getSqlClient('write');
    const db = await target.one('SELECT current_database() AS name');
    if (db.name !== TARGET_DB) throw new Error(`Unexpected target ${db.name}`);
    const existing = await target.one(`SELECT
      (SELECT count(*)::int FROM "Users" WHERE "legacyData" ? 'secondRenaissanceDiscourseUserId') AS users,
      (SELECT count(*)::int FROM "Posts" WHERE "legacyData" ? 'secondRenaissanceDiscourseTopicId') AS posts,
      (SELECT count(*)::int FROM "Comments" WHERE "legacyData" ? 'secondRenaissanceDiscoursePostId') AS comments`);
    if (existing.users || existing.posts || existing.comments) throw new Error(`Target already has historical data (${JSON.stringify(existing)}); use a fresh restored backup.`);
    const baseline = await target.one(`SELECT
      (SELECT count(*)::int FROM "Users") AS users,
      (SELECT count(*)::int FROM "Posts") AS posts,
      (SELECT count(*)::int FROM "Comments") AS comments`);
    if (baseline.users !== 7 || baseline.posts !== 12 || baseline.comments !== 31)
      throw new Error(`Production baseline mismatch: ${JSON.stringify(baseline)}. Refusing import.`);
    // Check imported slugs won't overwrite or collide with existing Railway posts.
    const slugCollisions = await target.any(`SELECT "slug" FROM "Posts" WHERE "slug" IN ($1:csv)`,
      [eligibleTopics.map(t => `second-renaissance-discourse-${t.id}`)]);
    if (slugCollisions.length) throw new Error(`Existing post slug collision: ${JSON.stringify(slugCollisions)}`);
    console.log('Production baseline verified:', baseline);
    if (!execute) {
      console.log('READ-ONLY PREFLIGHT PASSED: no writes made. Eligible: 30 users, 38 topics, 58 comments, 96 revisions.');
      return;
    }

    // Prepare placeholder IDs in memory; NO writes outside the main transaction.
    // Historical accounts intentionally have no credentials or email.
    const authorMap = new Map<number,string>();
    for (const u of users) authorMap.set(u.id, randomId());
    const prepared = eligiblePosts.map(p => prepare(p, authorMap.get(p.user_id)!));
    const groups = eligibleTopics.map(topic => {
      const items = prepared.filter(p => p.source.topic_id === topic.id);
      const opening = items.find(p => p.source.post_number === 1)!;
      const comments = items.filter(p => p.source.post_number > 1);
      const byNumber = new Map(comments.map(c => [c.source.post_number, c]));
      const parentOf = (c: Prepared): Prepared|null => {
        const n = c.source.reply_to_post_number;
        if (n == null || n === 1) return null;
        const parent = byNumber.get(n);
        if (!parent || parent.source.post_number >= c.source.post_number) throw new Error(`Invalid comment parent: ${c.source.id}`);
        return parent;
      };
      const rootOf = (c: Prepared): Prepared => {
        let current = c;
        const seen = new Set<string>();
        while (parentOf(current)) {
          if (seen.has(current.id)) throw new Error(`Reply cycle: ${c.source.id}`);
          seen.add(current.id);
          current = parentOf(current)!;
        }
        return current;
      };
      const descendants = (c: Prepared) => comments.filter(other => {
        let current = parentOf(other);
        while (current) { if (current.id === c.id) return true; current = parentOf(current); }
        return false;
      }).length;
      comments.forEach(rootOf);
      return {topic, opening, comments, parentOf, rootOf, descendants};
    });
    console.log('Prepared full migration. Inserting users and discussions atomically.');
    await target.tx(async tx => {
      const check = await tx.one('SELECT current_database() AS name');
      if (check.name !== TARGET_DB) throw new Error('Target transaction connected to unexpected DB');
      await tx.one('SELECT pg_advisory_xact_lock($1,$2) AS locked',[20261018, 81]);
      const recheck = await tx.one(`SELECT
        (SELECT count(*)::int FROM "Users" WHERE "legacyData" ? 'secondRenaissanceDiscourseUserId') AS migrated_users,
        (SELECT count(*)::int FROM "Posts" WHERE "legacyData" ? 'secondRenaissanceDiscourseTopicId') AS migrated_posts,
        (SELECT count(*)::int FROM "Comments" WHERE "legacyData" ? 'secondRenaissanceDiscoursePostId') AS migrated_comments,
        (SELECT count(*)::int FROM "Users") AS users,
        (SELECT count(*)::int FROM "Posts") AS posts,
        (SELECT count(*)::int FROM "Comments") AS comments`);
      if (recheck.migrated_users || recheck.migrated_posts || recheck.migrated_comments ||
          recheck.users !== 7 || recheck.posts !== 12 || recheck.comments !== 31)
        throw new Error(`Target baseline changed during preparation: ${JSON.stringify(recheck)}`);
      const collision = await tx.any(`SELECT "username", "slug" FROM "Users"
        WHERE "username" IN ($1:csv) OR "slug" IN ($2:csv)`,
        [users.map(u => `discourse_import_${u.id}`), users.map(u => `discourse-import-user-${u.id}`)]);
      if (collision.length) throw new Error(`Historical user identity collision: ${JSON.stringify(collision)}`);
      const postCollision = await tx.any(`SELECT "slug" FROM "Posts" WHERE "slug" IN ($1:csv)`,
        [eligibleTopics.map(t => `second-renaissance-discourse-${t.id}`)]);
      if (postCollision.length) throw new Error(`Historical post slug collision: ${JSON.stringify(postCollision)}`);
      for (const u of users) {
        await tx.none(`INSERT INTO "Users" (
          "_id", "username", "slug", "displayName", "createdAt", "abTestKey",
          "isAdmin", "noindex", "hideFromPeopleDirectory", "legacyData"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [authorMap.get(u.id), `discourse_import_${u.id}`,
           `discourse-import-user-${u.id}`, u.name?.trim() || u.username,
           new Date(), `discourse-import-test-${u.id}`, false, true, true,
           JSON.stringify({secondRenaissanceDiscourseUserId: String(u.id),
             secondRenaissanceDiscourseUsername: u.username})]);
      }
      console.log('Inserted 30 placeholder users inside the same transaction.');
      for (const g of groups) {
        const p = g.opening;
        const dates = [p.date, ...g.comments.map(c => c.date)];
        const lastCommentedAt = new Date(Math.max(...dates.map(d => d.getTime())));
        await tx.none(`INSERT INTO "Posts" ("_id","slug","title","postedAt","lastCommentedAt","status","isFuture","userId","maxBaseScore","contents_latest","legacyData")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [p.id, `second-renaissance-discourse-${g.topic.id}`, g.topic.title, p.date, lastCommentedAt,
            2, false, p.authorId, 0, p.revisionId,
            JSON.stringify({secondRenaissanceDiscourseTopicId:String(g.topic.id),secondRenaissanceDiscourseOpeningPostId:String(p.source.id)})]);
        await insertRevision(tx,p,'Posts');
        for (const c of g.comments) {
          const parent = g.parentOf(c);
          const root = g.rootOf(c);
          await tx.none(`INSERT INTO "Comments" ("_id","postId","userId","createdAt","postedAt","parentCommentId","topLevelCommentId","contents_latest","contents","legacyData","directChildrenCount","descendentCount")
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)`,
            [c.id,p.id,c.authorId,c.date,c.date,parent?.id ?? null,parent ? root.id : null,c.revisionId,
              JSON.stringify(makeContents(c)), JSON.stringify({secondRenaissanceDiscourseTopicId:String(g.topic.id),secondRenaissanceDiscoursePostId:String(c.source.id),secondRenaissanceDiscoursePostNumber:c.source.post_number}),
              g.comments.filter(other => other.source.reply_to_post_number === c.source.post_number).length,g.descendants(c)]);
          await insertRevision(tx,c,'Comments');
        }
      }
      const counts = await tx.one(`SELECT
        (SELECT count(*)::int FROM "Posts" WHERE "legacyData" ? 'secondRenaissanceDiscourseTopicId') AS posts,
        (SELECT count(*)::int FROM "Comments" WHERE "legacyData" ? 'secondRenaissanceDiscoursePostId') AS comments,
        (SELECT count(*)::int FROM "Revisions" WHERE "collectionName" IN ('Posts','Comments') AND "documentId" IN
          (SELECT "_id" FROM "Posts" WHERE "legacyData" ? 'secondRenaissanceDiscourseTopicId'
           UNION ALL SELECT "_id" FROM "Comments" WHERE "legacyData" ? 'secondRenaissanceDiscoursePostId')) AS revisions,
        (SELECT count(*)::int FROM "Comments" c JOIN "Revisions" r ON r."_id"=c."contents_latest"
          WHERE c."legacyData" ? 'secondRenaissanceDiscoursePostId' AND c."contents"->>'html' = r."html") AS rendered_comments`);
      const insertedUsers = await tx.one(`SELECT count(*)::int AS count FROM "Users"
        WHERE "legacyData" ? 'secondRenaissanceDiscourseUserId'`);
      if (insertedUsers.count !== users.length) throw new Error(`Historical user count mismatch: ${insertedUsers.count}`);
      if (counts.posts !== eligibleTopics.length || counts.comments !== eligibleReplies.length || counts.revisions !== eligiblePosts.length || counts.rendered_comments !== eligibleReplies.length)
        throw new Error(`Transaction validation failed: ${JSON.stringify(counts)}`);
      console.log('Transaction verified:', counts);
    });
    console.log(`Atomic production PUBLIC migration COMMITTED: ${users.length} placeholder users (including system), ${eligibleTopics.length} topics, ${eligibleReplies.length} comments and ${eligiblePosts.length} revisions. Private messages and Staff topics excluded.`);
    const totals = await target.one(`SELECT (SELECT count(*)::int FROM "Users") AS users, (SELECT count(*)::int FROM "Posts") AS posts, (SELECT count(*)::int FROM "Comments") AS comments`);
    if (totals.users !== 37 || totals.posts !== 50 || totals.comments !== 89) throw new Error(`Unexpected post-commit totals: ${JSON.stringify(totals)}`);
    console.log('Existing Railway data preserved + history added; expected totals verified:', totals);
  } finally {
    pgp.end();
  }
}
main().catch(e => {console.error(e); process.exitCode = 1;});

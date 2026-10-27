import { createHash } from "crypto";
import type { ITask } from "pg-promise";
import { randomId } from "@/lib/random";
import { slugify } from "@/lib/utils/slugify";
import { getSqlClientOrThrow } from "@/server/sql/sqlClient";
import { getPgPromiseLib } from "@/server/sqlConnection";
import type { ChangeMetrics } from "@/server/collections/revisions/collection";
import { getNextVersionAfterSemver, htmlToChangeMetrics } from "@/server/editor/utils";
import { dataToMarkdown } from "@/server/editor/conversionUtils";
import { loadDiscourseSource } from "./secondRenaissanceDiscourseSource";
import {
  getExpectedDisplayName,
  getReplyNesting,
  selectPublicContent,
  type PublicContent,
  type ReplyNesting,
  type SourceData,
  type SourcePost,
} from "./secondRenaissanceMigrationChecks";
import { cleanDiscourseHtml, HTML_CLEANUP_VERSION, type DiscourseLinkTargets } from "./secondRenaissanceDiscourseHtml";
import { createSecondRenaissanceCategoryTags } from "./createSecondRenaissanceCategoryTags";
import { verifySecondRenaissanceMigration } from "./verifySecondRenaissanceMigration";

/* eslint-disable no-console */

/**
 * Re-runnable import of the Second Renaissance Discourse forum (issue #35).
 * Replaces the one-time scripts/importSecondRenaissanceProduction.ts.
 *
 * Records are matched by their Discourse IDs (stored in `legacyData`), so each
 * run only writes what changed since the last one:
 * - creates users, posts and comments that are new in Discourse;
 * - updates titles, authors, dates, comment nesting and display names that
 *   changed, and content whose Discourse HTML changed (or whose cleanup did,
 *   see HTML_CLEANUP_VERSION);
 * - unpublishes anything that's no longer public in Discourse (posts become
 *   drafts, comments are marked deleted), and republishes it if it becomes
 *   public again;
 * - recomputes comment counts and per-user post and comment counts;
 * - tags posts with their Discourse category (createSecondRenaissanceCategoryTags);
 * - finishes with verifySecondRenaissanceMigration.
 * A second run with an unchanged backup makes no changes.
 *
 * Private messages and topics in read-restricted categories are never
 * imported. Notifications, karma and search indexing are skipped: writes are
 * raw SQL, like the original import, so that historical content doesn't notify
 * anyone. Reindex Elasticsearch after running against production.
 *
 * Dry run by default: everything runs inside a transaction that's rolled
 * back, so the counts are exact. Pass `{ execute: true }` to commit. A target
 * database that isn't on localhost also needs `{ allowRemote: true }`.
 *
 * Usage: yarn repl prod lw packages/lesswrong/scripts/importSecondRenaissanceDiscourse.ts "importSecondRenaissanceDiscourse({ execute: true })"
 */

const pgp = getPgPromiseLib();

const ADVISORY_LOCK: [number, number] = [20261018, 35];
const DRY_RUN_ROLLBACK = "Dry run: rolling back";

type Transaction = ITask<{}>;

interface ExistingUser {
  _id: string
  discourseUserId: string
  slug: string
  displayName: string | null
}

interface ExistingPost {
  _id: string
  discourseTopicId: string
  title: string
  slug: string
  userId: string
  postedAt: Date
  draft: boolean
  unpublished: boolean
  contentHash: string | null
  version: string | null
}

interface ExistingComment {
  _id: string
  discoursePostId: string
  postId: string
  userId: string
  postedAt: Date
  parentCommentId: string | null
  topLevelCommentId: string | null
  deleted: boolean
  unpublished: boolean
  contentHash: string | null
  version: string | null
  directChildrenCount: number
  descendentCount: number
}

interface ImportCounts {
  usersCreated: number
  usersUpdated: number
  postsCreated: number
  postsUpdated: number
  postsUnpublished: number
  commentsCreated: number
  commentsUpdated: number
  commentsUnpublished: number
  countsUpdated: number
}

interface RevisionRow {
  _id: string
  documentId: string
  collectionName: "Posts" | "Comments"
  fieldName: "contents"
  editedAt: Date
  updateType: "initial" | "minor"
  version: string
  userId: string
  originalContents: { type: "ckEditorMarkup", data: string }
  html: string
  wordCount: number
  changeMetrics: ChangeMetrics
}

interface ExistingRecords {
  users: Map<string, ExistingUser>
  posts: Map<string, ExistingPost>
  comments: Map<string, ExistingComment>
}

interface PreparedContent {
  html: string
  hash: string
  wordCount: number
}

interface IdMaps {
  userIds: Map<number, string>
  postIds: Map<number, string>
  commentIds: Map<number, string>
  postSlugs: Map<number, string>
  targets: DiscourseLinkTargets
}

const emptyCounts = (): ImportCounts => ({
  usersCreated: 0, usersUpdated: 0,
  postsCreated: 0, postsUpdated: 0, postsUnpublished: 0,
  commentsCreated: 0, commentsUpdated: 0, commentsUnpublished: 0,
  countsUpdated: 0,
});

const jsonColumn = (name: string) => ({ name, mod: ":json" as const, cast: "jsonb" });

const userColumns = new pgp.helpers.ColumnSet([
  "_id", "username", "slug", "displayName", "createdAt", "abTestKey",
  "isAdmin", "noindex", "hideFromPeopleDirectory", jsonColumn("legacyData"),
], { table: "Users" });

const postColumns = new pgp.helpers.ColumnSet([
  "_id", "slug", "title", "postedAt", "createdAt", "lastCommentedAt", "frontpageDate",
  "status", "isFuture", "draft", "userId", "maxBaseScore", "contents_latest", jsonColumn("legacyData"),
], { table: "Posts" });

const commentColumns = new pgp.helpers.ColumnSet([
  "_id", "postId", "userId", "createdAt", "postedAt", "parentCommentId", "topLevelCommentId",
  "contents_latest", jsonColumn("contents"), jsonColumn("legacyData"), "directChildrenCount", "descendentCount",
], { table: "Comments" });

const revisionColumns = new pgp.helpers.ColumnSet([
  "_id", "documentId", "collectionName", "fieldName", "editedAt", "updateType", "version", "userId",
  jsonColumn("originalContents"), "html", "wordCount", jsonColumn("changeMetrics"),
], { table: "Revisions" });

/** Refuses a non-local target unless allowRemote is set */
function checkTarget(allowRemote: boolean): string {
  const raw = process.env.PG_URL;
  if (!raw) throw new Error("PG_URL is required");
  const { hostname, pathname } = new URL(raw);
  const isLocal = ["localhost", "127.0.0.1"].includes(hostname);
  if (!isLocal && !allowRemote) {
    throw new Error(`Target ${hostname}${pathname} isn't local; pass { allowRemote: true } to import into it`);
  }
  return `${hostname}${pathname}`;
}

function hashContent(cooked: string): string {
  return createHash("sha256").update(`${HTML_CLEANUP_VERSION}\n${cooked}`).digest("hex");
}

function prepareContent(post: SourcePost, targets: DiscourseLinkTargets): PreparedContent {
  const html = cleanDiscourseHtml(post.cooked, targets);
  const markdown = dataToMarkdown(html, "html").trim();
  return { html, hash: hashContent(post.cooked), wordCount: markdown ? markdown.split(/\s+/).length : 0 };
}

function makeRevision(documentId: string, collectionName: "Posts" | "Comments", userId: string, content: PreparedContent, previousVersion: string | null, editedAt: Date): RevisionRow {
  return {
    _id: randomId(),
    documentId,
    collectionName,
    fieldName: "contents",
    editedAt,
    updateType: previousVersion ? "minor" : "initial",
    version: previousVersion ? getNextVersionAfterSemver(previousVersion, "minor", false) : "1.0.0",
    userId,
    originalContents: { type: "ckEditorMarkup", data: content.html },
    html: content.html,
    wordCount: content.wordCount,
    changeMetrics: htmlToChangeMetrics("", content.html),
  };
}

/** The denormalized `contents` field of a comment, matching its latest revision */
function makeCommentContents(revision: RevisionRow) {
  return {
    html: revision.html,
    originalContents: revision.originalContents,
    wordCount: revision.wordCount,
    editedAt: revision.editedAt.toISOString(),
    version: revision.version,
    userId: revision.userId,
    changeMetrics: revision.changeMetrics,
  };
}

async function insertBatches(tx: Transaction, columns: typeof userColumns, rows: object[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await tx.none(pgp.helpers.insert(rows.slice(i, i + 500), columns));
  }
}

async function loadExisting(tx: Transaction): Promise<ExistingRecords> {
  const users: ExistingUser[] = await tx.any(`
    -- importSecondRenaissanceDiscourse users
    SELECT _id, slug, "displayName", "legacyData"->>'secondRenaissanceDiscourseUserId' AS "discourseUserId"
    FROM "Users" WHERE "legacyData" ? 'secondRenaissanceDiscourseUserId'
  `);
  const posts: ExistingPost[] = await tx.any(`
    -- importSecondRenaissanceDiscourse posts
    SELECT p._id, p.title, p.slug, p."userId", p."postedAt", p.draft,
      p."legacyData"->>'secondRenaissanceDiscourseTopicId' AS "discourseTopicId",
      p."legacyData"->>'secondRenaissanceDiscourseContentHash' AS "contentHash",
      COALESCE((p."legacyData"->>'secondRenaissanceDiscourseUnpublished')::boolean, FALSE) AS unpublished,
      r.version
    FROM "Posts" p LEFT JOIN "Revisions" r ON r._id = p.contents_latest
    WHERE p."legacyData" ? 'secondRenaissanceDiscourseTopicId'
  `);
  const comments: ExistingComment[] = await tx.any(`
    -- importSecondRenaissanceDiscourse comments
    SELECT c._id, c."postId", c."userId", c."postedAt", c."parentCommentId", c."topLevelCommentId", c.deleted,
      c."directChildrenCount", c."descendentCount",
      c."legacyData"->>'secondRenaissanceDiscoursePostId' AS "discoursePostId",
      c."legacyData"->>'secondRenaissanceDiscourseContentHash' AS "contentHash",
      COALESCE((c."legacyData"->>'secondRenaissanceDiscourseUnpublished')::boolean, FALSE) AS unpublished,
      r.version
    FROM "Comments" c LEFT JOIN "Revisions" r ON r._id = c.contents_latest
    WHERE c."legacyData" ? 'secondRenaissanceDiscoursePostId'
  `);
  return {
    users: new Map(users.map(u => [u.discourseUserId, u])),
    posts: new Map(posts.map(p => [p.discourseTopicId, p])),
    comments: new Map(comments.map(c => [c.discoursePostId, c])),
  };
}

const userSlug = (discourseUserId: number) => `discourse-import-user-${discourseUserId}`;
const postSlug = (title: string, topicId: number) => slugify(title) || `discourse-topic-${topicId}`;

/** Forum IDs for every Discourse record, reusing existing ones */
function assignIds(source: SourceData, content: PublicContent, existing: ExistingRecords): IdMaps {
  const userIds = new Map<number, string>();
  const userPathsByUsername = new Map<string, string>();
  for (const user of source.users) {
    const match = existing.users.get(String(user.id));
    userIds.set(user.id, match?._id ?? randomId());
    userPathsByUsername.set(user.username.toLowerCase(), `/users/${match?.slug ?? userSlug(user.id)}`);
  }
  const postIds = new Map<number, string>();
  const postSlugs = new Map<number, string>();
  const postPathsByTopicId = new Map<number, string>();
  for (const topic of content.publicTopics) {
    const id = existing.posts.get(String(topic.id))?._id ?? randomId();
    const slug = postSlug(topic.title, topic.id);
    postIds.set(topic.id, id);
    postSlugs.set(topic.id, slug);
    postPathsByTopicId.set(topic.id, `/posts/${id}/${slug}`);
  }
  const commentIds = new Map<number, string>();
  for (const reply of content.publicReplies) {
    commentIds.set(reply.id, existing.comments.get(String(reply.id))?._id ?? randomId());
  }
  return { userIds, postIds, commentIds, postSlugs, targets: { userPathsByUsername, postPathsByTopicId } };
}

async function syncUsers(tx: Transaction, source: SourceData, existing: Map<string, ExistingUser>, ids: IdMaps, counts: ImportCounts): Promise<void> {
  const newUsers: object[] = [];
  for (const user of source.users) {
    const displayName = getExpectedDisplayName(user);
    const match = existing.get(String(user.id));
    if (!match) {
      // Historical accounts have no email or password, so nobody can log in as them
      newUsers.push({
        _id: ids.userIds.get(user.id), username: `discourse_import_${user.id}`, slug: userSlug(user.id),
        displayName, createdAt: user.createdAt, abTestKey: randomId(),
        isAdmin: false, noindex: true, hideFromPeopleDirectory: true,
        legacyData: { secondRenaissanceDiscourseUserId: String(user.id), secondRenaissanceDiscourseUsername: user.username },
      });
    } else if (match.displayName !== displayName) {
      await tx.none(`UPDATE "Users" SET "displayName" = $1 WHERE _id = $2`, [displayName, match._id]);
      counts.usersUpdated++;
    }
  }
  await insertBatches(tx, userColumns, newUsers);
  counts.usersCreated += newUsers.length;
}

async function syncPosts(tx: Transaction, content: PublicContent, existing: Map<string, ExistingPost>, ids: IdMaps, counts: ImportCounts): Promise<void> {
  const newPosts: object[] = [];
  const revisions: object[] = [];
  for (const topic of content.publicTopics) {
    const opening = content.openingPosts.get(topic.id);
    if (!opening) {
      console.log(`Skipping topic ${topic.id} "${topic.title}": its opening post isn't public`);
      continue;
    }
    const _id = ids.postIds.get(topic.id)!;
    const slug = ids.postSlugs.get(topic.id)!;
    const userId = ids.userIds.get(opening.userId)!;
    const match = existing.get(String(topic.id));
    const hash = hashContent(opening.cooked);
    if (!match) {
      const revision = makeRevision(_id, "Posts", userId, prepareContent(opening, ids.targets), null, opening.createdAt);
      revisions.push(revision);
      newPosts.push({
        _id, slug, title: topic.title, postedAt: opening.createdAt, createdAt: opening.createdAt,
        lastCommentedAt: opening.createdAt, frontpageDate: opening.createdAt, status: 2, isFuture: false,
        draft: false, userId, maxBaseScore: 0, contents_latest: revision._id,
        legacyData: {
          secondRenaissanceDiscourseTopicId: String(topic.id),
          secondRenaissanceDiscourseOpeningPostId: String(opening.id),
          secondRenaissanceDiscourseContentHash: hash,
        },
      });
      continue;
    }
    const fieldsChanged = match.title !== topic.title || match.slug !== slug || match.userId !== userId
      || match.postedAt.getTime() !== opening.createdAt.getTime() || match.unpublished;
    const contentChanged = match.contentHash !== hash;
    if (!fieldsChanged && !contentChanged) continue;
    let revisionId: string | null = null;
    if (contentChanged) {
      const revision = makeRevision(_id, "Posts", userId, prepareContent(opening, ids.targets), match.version, new Date());
      revisions.push(revision);
      revisionId = revision._id;
    }
    await tx.none(`
      UPDATE "Posts" SET title = $(title), slug = $(slug), "userId" = $(userId), "postedAt" = $(postedAt),
        draft = CASE WHEN $(republish) THEN FALSE ELSE draft END,
        contents_latest = COALESCE($(revisionId), contents_latest),
        "legacyData" = ("legacyData" - 'secondRenaissanceDiscourseUnpublished')
          || jsonb_build_object('secondRenaissanceDiscourseContentHash', $(hash))
      WHERE _id = $(_id)
    `, { _id, title: topic.title, slug, userId, postedAt: opening.createdAt, republish: match.unpublished, revisionId, hash });
    counts.postsUpdated++;
  }
  await insertBatches(tx, revisionColumns, revisions);
  await insertBatches(tx, postColumns, newPosts);
  counts.postsCreated += newPosts.length;

  for (const post of existing.values()) {
    if (content.publicTopicIds.has(Number(post.discourseTopicId)) || post.draft) continue;
    await tx.none(`
      UPDATE "Posts" SET draft = TRUE,
        "legacyData" = "legacyData" || '{"secondRenaissanceDiscourseUnpublished": true}'::jsonb
      WHERE _id = $1
    `, [post._id]);
    counts.postsUnpublished++;
  }
}

/** Number of direct replies and of all descendants for each public reply */
function getReplyCounts(nesting: Map<number, ReplyNesting>): Map<number, { children: number, descendants: number }> {
  const counts = new Map<number, { children: number, descendants: number }>();
  for (const id of nesting.keys()) counts.set(id, { children: 0, descendants: 0 });
  for (const { parentId } of nesting.values()) {
    if (parentId !== null) counts.get(parentId)!.children++;
    for (let ancestor = parentId; ancestor !== null; ancestor = nesting.get(ancestor)?.parentId ?? null) {
      counts.get(ancestor)!.descendants++;
    }
  }
  return counts;
}

async function syncComments(tx: Transaction, content: PublicContent, existing: Map<string, ExistingComment>, ids: IdMaps, counts: ImportCounts): Promise<void> {
  const nesting = getReplyNesting(content.publicReplies);
  const replyCounts = getReplyCounts(nesting);
  const newComments: object[] = [];
  const revisions: object[] = [];
  for (const reply of content.publicReplies) {
    const _id = ids.commentIds.get(reply.id)!;
    const postId = ids.postIds.get(reply.topicId)!;
    const userId = ids.userIds.get(reply.userId)!;
    const { parentId, rootId } = nesting.get(reply.id)!;
    const parentCommentId = parentId === null ? null : ids.commentIds.get(parentId)!;
    const topLevelCommentId = rootId === null ? null : ids.commentIds.get(rootId)!;
    const { children, descendants } = replyCounts.get(reply.id)!;
    const match = existing.get(String(reply.id));
    const hash = hashContent(reply.cooked);
    if (!match) {
      const revision = makeRevision(_id, "Comments", userId, prepareContent(reply, ids.targets), null, reply.createdAt);
      revisions.push(revision);
      newComments.push({
        _id, postId, userId, createdAt: reply.createdAt, postedAt: reply.createdAt, parentCommentId, topLevelCommentId,
        contents_latest: revision._id, contents: makeCommentContents(revision),
        legacyData: {
          secondRenaissanceDiscourseTopicId: String(reply.topicId),
          secondRenaissanceDiscoursePostId: String(reply.id),
          secondRenaissanceDiscoursePostNumber: reply.postNumber,
          secondRenaissanceDiscourseContentHash: hash,
        },
        directChildrenCount: children, descendentCount: descendants,
      });
      continue;
    }
    const fieldsChanged = match.postId !== postId || match.userId !== userId
      || match.postedAt.getTime() !== reply.createdAt.getTime()
      || match.parentCommentId !== parentCommentId || match.topLevelCommentId !== topLevelCommentId
      || match.directChildrenCount !== children || match.descendentCount !== descendants || match.unpublished;
    const contentChanged = match.contentHash !== hash;
    if (!fieldsChanged && !contentChanged) continue;
    let revision: RevisionRow | null = null;
    if (contentChanged) {
      revision = makeRevision(_id, "Comments", userId, prepareContent(reply, ids.targets), match.version, new Date());
      revisions.push(revision);
    }
    await tx.none(`
      UPDATE "Comments" SET "postId" = $(postId), "userId" = $(userId), "postedAt" = $(postedAt),
        "parentCommentId" = $(parentCommentId), "topLevelCommentId" = $(topLevelCommentId),
        "directChildrenCount" = $(children), "descendentCount" = $(descendants),
        deleted = CASE WHEN $(restore) THEN FALSE ELSE deleted END,
        contents_latest = COALESCE($(revisionId), contents_latest),
        contents = COALESCE($(contents)::jsonb, contents),
        "legacyData" = ("legacyData" - 'secondRenaissanceDiscourseUnpublished')
          || jsonb_build_object('secondRenaissanceDiscourseContentHash', $(hash))
      WHERE _id = $(_id)
    `, {
      _id, postId, userId, postedAt: reply.createdAt, parentCommentId, topLevelCommentId, children, descendants,
      restore: match.unpublished, revisionId: revision?._id ?? null,
      contents: revision ? JSON.stringify(makeCommentContents(revision)) : null, hash,
    });
    counts.commentsUpdated++;
  }
  await insertBatches(tx, revisionColumns, revisions);
  await insertBatches(tx, commentColumns, newComments);
  counts.commentsCreated += newComments.length;

  const publicReplyIds = new Set(content.publicReplies.map(r => r.id));
  for (const comment of existing.values()) {
    if (publicReplyIds.has(Number(comment.discoursePostId)) || comment.deleted) continue;
    await tx.none(`
      UPDATE "Comments" SET deleted = TRUE,
        "legacyData" = "legacyData" || '{"secondRenaissanceDiscourseUnpublished": true}'::jsonb
      WHERE _id = $1
    `, [comment._id]);
    counts.commentsUnpublished++;
  }
}

/** Comment counts on migrated posts and post/comment counts on migrated users */
async function syncCounts(tx: Transaction, counts: ImportCounts): Promise<void> {
  const posts = await tx.result(`
    -- importSecondRenaissanceDiscourse post counts
    UPDATE "Posts" p SET "commentCount" = c.total, "topLevelCommentCount" = c."topLevel",
      "lastCommentedAt" = GREATEST(p."postedAt", c.latest)
    FROM (
      SELECT p2._id,
        COUNT(c2._id) FILTER (WHERE NOT c2.deleted) AS total,
        COUNT(c2._id) FILTER (WHERE NOT c2.deleted AND c2."parentCommentId" IS NULL) AS "topLevel",
        MAX(c2."postedAt") FILTER (WHERE NOT c2.deleted) AS latest
      FROM "Posts" p2 LEFT JOIN "Comments" c2 ON c2."postId" = p2._id
      WHERE p2."legacyData" ? 'secondRenaissanceDiscourseTopicId'
      GROUP BY p2._id
    ) c
    WHERE p._id = c._id AND (
      p."commentCount" IS DISTINCT FROM c.total OR p."topLevelCommentCount" IS DISTINCT FROM c."topLevel"
      OR p."lastCommentedAt" IS DISTINCT FROM GREATEST(p."postedAt", c.latest)
    )
  `);
  const users = await tx.result(`
    -- importSecondRenaissanceDiscourse user counts
    UPDATE "Users" u SET "postCount" = s.posts, "commentCount" = s.comments
    FROM (
      SELECT u2._id,
        (SELECT COUNT(*) FROM "Posts" p WHERE p."userId" = u2._id AND NOT p.draft AND NOT p."deletedDraft") AS posts,
        (SELECT COUNT(*) FROM "Comments" c WHERE c."userId" = u2._id AND NOT c.deleted) AS comments
      FROM "Users" u2 WHERE u2."legacyData" ? 'secondRenaissanceDiscourseUserId'
    ) s
    WHERE u._id = s._id AND (u."postCount" IS DISTINCT FROM s.posts OR u."commentCount" IS DISTINCT FROM s.comments)
  `);
  counts.countsUpdated += posts.rowCount + users.rowCount;
}

async function runImport(tx: Transaction, source: SourceData): Promise<ImportCounts> {
  await tx.one("SELECT pg_advisory_xact_lock($1, $2) AS locked", ADVISORY_LOCK);
  const content = selectPublicContent(source);
  const existing = await loadExisting(tx);
  const ids = assignIds(source, content, existing);
  const counts = emptyCounts();
  await syncUsers(tx, source, existing.users, ids, counts);
  await syncPosts(tx, content, existing.posts, ids, counts);
  await syncComments(tx, content, existing.comments, ids, counts);
  await syncCounts(tx, counts);
  return counts;
}

export async function importSecondRenaissanceDiscourse({ execute = false, allowRemote = false }: {
  execute?: boolean,
  allowRemote?: boolean,
} = {}): Promise<ImportCounts> {
  const target = checkTarget(allowRemote);
  console.log(`${execute ? "EXECUTING" : "DRY RUN (rolled back)"}: importing into ${target}`);
  const source = await loadDiscourseSource();

  let counts = emptyCounts();
  try {
    await getSqlClientOrThrow().tx(async tx => {
      counts = await runImport(tx, source);
      if (!execute) throw new Error(DRY_RUN_ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error && e.message === DRY_RUN_ROLLBACK)) throw e;
  }
  console.log("Changes:", counts);

  if (!execute) {
    console.log("Dry run: nothing was written. Category tags and verification run after a real import.");
    return counts;
  }
  await createSecondRenaissanceCategoryTags({ execute: true });
  await verifySecondRenaissanceMigration();
  return counts;
}

export default importSecondRenaissanceDiscourse;

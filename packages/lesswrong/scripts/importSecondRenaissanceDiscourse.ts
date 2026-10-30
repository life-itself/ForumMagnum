import { createHash } from "crypto";
import type { ITask } from "pg-promise";
import { randomId } from "@/lib/random";
import { slugify } from "@/lib/utils/slugify";
import { getSqlClientOrThrow } from "@/server/sql/sqlClient";
import { getPgPromiseLib } from "@/server/sqlConnection";
import { getCollection } from "@/server/collections/allCollections";
import { recalculateDocumentScores } from "@/server/voteServer";
import { createAnonymousContext } from "@/server/vulcan-lib/createContexts";
import { cheerioParse } from "@/server/utils/htmlUtil";
import { executePromiseQueue } from "@/lib/utils/asyncUtils";
import { adminAccountSetting } from "@/lib/instanceSettings";
import type { ChangeMetrics } from "@/server/collections/revisions/collection";
import { getNextVersionAfterSemver, htmlToChangeMetrics } from "@/server/editor/utils";
import { dataToMarkdown } from "@/server/editor/conversionUtils";
import { loadDiscourseSource } from "./secondRenaissanceDiscourseSource";
import {
  MIGRATED_MEMBER_KARMA,
  getExpectedDisplayName,
  getReplyNesting,
  groupBy,
  selectPublicContent,
  selectPublicLikes,
  type PublicContent,
  type ReplyNesting,
  type SourceData,
  type SourcePost,
} from "./secondRenaissanceMigrationChecks";
import { DISCOURSE_ORIGIN, cleanDiscourseHtml, type DiscourseLinkTargets } from "./secondRenaissanceDiscourseHtml";
import { replaceEmojiCodes } from "./secondRenaissanceDiscourseEmoji";
import { findDiscourseUploadPaths, loadDiscourseUploads, mirrorDiscourseUploads } from "./secondRenaissanceDiscourseUploads";
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
 *   changed, and content whose cleaned HTML changed (because the Discourse
 *   post was edited, the cleanup changed, or a link target moved);
 * - moves uploaded images and attachments to Cloudinary when `uploadsDir`
 *   (the backup's extracted `uploads/` folder) is given, and points posts at
 *   them (secondRenaissanceDiscourseUploads);
 * - unpublishes anything that's no longer public in Discourse (posts become
 *   drafts, comments are marked deleted), and republishes it if it becomes
 *   public again;
 * - recomputes comment counts and per-user post and comment counts;
 * - marks migrated members as reviewed with starting karma, so they aren't
 *   treated as brand-new accounts (syncMemberTrust);
 * - gives migrated posts and comments their author's self-upvote, and
 *   recalculates their scores (syncSelfVotes, recalculateScores);
 * - turns Discourse likes into upvotes by the same members, adding to the
 *   authors' karma (syncLikeVotes);
 * - sets link-preview images for migrated posts (syncSocialPreviewImages);
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
 * back, so the counts are exact, and nothing is uploaded. Pass `{ execute: true }` to commit. A target
 * database that isn't on localhost also needs `{ allowRemote: true }`.
 *
 * Usage: yarn repl prod lw packages/lesswrong/scripts/importSecondRenaissanceDiscourse.ts "importSecondRenaissanceDiscourse({ execute: true })"
 */

const pgp = getPgPromiseLib();

const ADVISORY_LOCK: [number, number] = [20261018, 35];
const DRY_RUN_ROLLBACK = "Dry run: rolling back";
/** The old forum was also served from forum.lifeitself.org, which some links use */
const OLD_FORUM_ORIGINS = [DISCOURSE_ORIGIN, "https://forum.lifeitself.org"];

type Transaction = ITask<{}>;

interface ExistingUser {
  _id: string
  discourseUserId: string
  username: string
  slug: string
  displayName: string | null
  email: string | null
  /** An account the member already had here, linked by claimDiscourseAccount */
  claimed: boolean
}

/** Who already uses each username, slug and email, across all accounts */
interface TakenIdentities {
  usernames: Map<string, string>
  slugs: Map<string, string>
  emails: Map<string, string>
}

/** The username, slug and email an imported account should have */
interface UserIdentity {
  username: string
  slug: string
  email: string | null
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
  selfVotesAdded: number
  likeVotesAdded: number
  previewImagesUpdated: number
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
  taken: TakenIdentities
  posts: Map<string, ExistingPost>
  comments: Map<string, ExistingComment>
}

interface CleanedContent {
  html: string
  /** Hash of the cleaned HTML, stored to detect changes on later runs */
  hash: string
}

interface IdMaps {
  userIds: Map<number, string>
  userIdentities: Map<number, UserIdentity>
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
  selfVotesAdded: 0,
  likeVotesAdded: 0,
  previewImagesUpdated: 0,
});

const jsonColumn = (name: string) => ({ name, mod: ":json" as const, cast: "jsonb" });

const userColumns = new pgp.helpers.ColumnSet([
  "_id", "username", "slug", "displayName", "email", { name: "emails", mod: ":raw" as const }, "createdAt", "abTestKey",
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

const voteColumns = new pgp.helpers.ColumnSet([
  "_id", "documentId", "collectionName", "userId", { name: "authorIds", cast: "text[]" },
  "voteType", "power", "afPower", "votedAt", "createdAt",
], { table: "Votes" });

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


function cleanContent(post: SourcePost, targets: DiscourseLinkTargets): CleanedContent {
  const html = cleanDiscourseHtml(post.cooked, targets);
  return { html, hash: createHash("sha256").update(html).digest("hex") };
}

function countWords(html: string): number {
  const markdown = dataToMarkdown(html, "html").trim();
  return markdown ? markdown.split(/\s+/).length : 0;
}

function makeRevision(documentId: string, collectionName: "Posts" | "Comments", userId: string, content: CleanedContent, previousVersion: string | null, editedAt: Date): RevisionRow {
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
    wordCount: countWords(content.html),
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
    SELECT _id, username, slug, "displayName", email,
      "legacyData"->>'secondRenaissanceDiscourseUserId' AS "discourseUserId",
      COALESCE(("legacyData"->>'secondRenaissanceDiscourseClaimed')::boolean, FALSE) AS claimed
    FROM "Users" WHERE "legacyData" ? 'secondRenaissanceDiscourseUserId'
  `);
  // Deleted accounts still hold their username, slug and email
  const allAccounts: { _id: string, username: string | null, slug: string, email: string | null }[] = await tx.any(`
    -- importSecondRenaissanceDiscourse taken identities
    SELECT _id, username, slug, email FROM "Users"
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
  const taken: TakenIdentities = { usernames: new Map(), slugs: new Map(), emails: new Map() };
  for (const account of allAccounts) {
    if (account.username) taken.usernames.set(account.username.toLowerCase(), account._id);
    taken.slugs.set(account.slug, account._id);
    if (account.email) taken.emails.set(account.email.toLowerCase(), account._id);
  }
  return {
    users: new Map(users.map(u => [u.discourseUserId, u])),
    taken,
    posts: new Map(posts.map(p => [p.discourseTopicId, p])),
    comments: new Map(comments.map(c => [c.discoursePostId, c])),
  };
}

const userSlug = (discourseUserId: number) => `discourse-import-user-${discourseUserId}`;
const postSlug = (title: string, topicId: number) => slugify(title) || `discourse-topic-${topicId}`;

/** Forum IDs for every Discourse record, reusing existing ones */
/** Takes a username, slug or email for an account if nobody else has it */
function claimIdentity(owners: Map<string, string>, key: string, accountId: string): boolean {
  const owner = owners.get(key);
  if (owner && owner !== accountId) return false;
  owners.set(key, accountId);
  return true;
}

/**
 * Gives each imported account its Discourse username and email, so members
 * can log in with "Forgot password". Never takes a username, slug or email
 * that another account has; a member whose email belongs to another account
 * already signed up here, and needs claimDiscourseAccount instead.
 */
function planUserIdentities(source: SourceData, existing: ExistingRecords, userIds: Map<number, string>): Map<number, UserIdentity> {
  const identities = new Map<number, UserIdentity>();
  for (const user of source.users) {
    const match = existing.users.get(String(user.id));
    if (match?.claimed) {
      identities.set(user.id, { username: match.username, slug: match.slug, email: match.email });
      continue;
    }
    const accountId = userIds.get(user.id)!;
    const username = claimIdentity(existing.taken.usernames, user.username.toLowerCase(), accountId)
      ? user.username
      : match?.username ?? `discourse_import_${user.id}`;
    const usernameSlug = slugify(username);
    const slug = usernameSlug && claimIdentity(existing.taken.slugs, usernameSlug, accountId)
      ? usernameSlug
      : match?.slug ?? userSlug(user.id);
    let email = match?.email ?? null;
    if (user.email) {
      if (claimIdentity(existing.taken.emails, user.email.toLowerCase(), accountId)) {
        email = user.email;
      } else {
        const otherAccountId = existing.taken.emails.get(user.email.toLowerCase());
        console.log(`Discourse user ${user.username} already has an account here (${otherAccountId}); link it with claimDiscourseAccount`);
      }
    }
    identities.set(user.id, { username, slug, email });
  }
  return identities;
}

function assignIds(source: SourceData, content: PublicContent, existing: ExistingRecords, uploadUrlsByPath: Map<string, string>): IdMaps {
  const userIds = new Map<number, string>();
  for (const user of source.users) {
    userIds.set(user.id, existing.users.get(String(user.id))?._id ?? randomId());
  }
  const userIdentities = planUserIdentities(source, existing, userIds);
  const userPathsByUsername = new Map<string, string>();
  for (const user of source.users) {
    userPathsByUsername.set(user.username.toLowerCase(), `/users/${userIdentities.get(user.id)!.slug}`);
  }
  const postIds = new Map<number, string>();
  const postSlugs = new Map<number, string>();
  const postPathsByTopicId = new Map<number, string>();
  for (const topic of content.publicTopics) {
    const id = existing.posts.get(String(topic.id))?._id ?? randomId();
    const slug = postSlug(replaceEmojiCodes(topic.title), topic.id);
    postIds.set(topic.id, id);
    postSlugs.set(topic.id, slug);
    postPathsByTopicId.set(topic.id, `/posts/${id}/${slug}`);
  }
  const commentIds = new Map<number, string>();
  for (const reply of content.publicReplies) {
    commentIds.set(reply.id, existing.comments.get(String(reply.id))?._id ?? randomId());
  }
  return { userIds, userIdentities, postIds, commentIds, postSlugs, targets: { userPathsByUsername, postPathsByTopicId, uploadUrlsByPath } };
}

/** Login email for an account, in the format the Users `emails` column uses */
function emailsColumnValue(email: string | null) {
  return email ? pgp.as.format("ARRAY[$1::jsonb]", [JSON.stringify({ address: email, verified: false })]) : "NULL";
}

async function syncUsers(tx: Transaction, source: SourceData, existing: Map<string, ExistingUser>, ids: IdMaps, counts: ImportCounts): Promise<void> {
  const newUsers: object[] = [];
  for (const user of source.users) {
    const match = existing.get(String(user.id));
    // Claimed accounts keep the name, username and email their owner chose
    if (match?.claimed) continue;
    const displayName = getExpectedDisplayName(user);
    const { username, slug, email } = ids.userIdentities.get(user.id)!;
    if (!match) {
      // Members log in by resetting their password; nobody knows one yet
      newUsers.push({
        _id: ids.userIds.get(user.id), username, slug, displayName, email, emails: emailsColumnValue(email),
        createdAt: user.createdAt, abTestKey: randomId(),
        isAdmin: false, noindex: true, hideFromPeopleDirectory: true,
        legacyData: { secondRenaissanceDiscourseUserId: String(user.id), secondRenaissanceDiscourseUsername: user.username },
      });
      continue;
    }
    if (match.displayName === displayName && match.username === username && match.slug === slug && match.email === email) continue;
    await tx.none(`
      UPDATE "Users" SET "displayName" = $(displayName), username = $(username), slug = $(slug),
        "oldSlugs" = CASE WHEN slug = $(slug) THEN "oldSlugs" ELSE array_append("oldSlugs", slug) END,
        email = $(email), emails = $(emails:raw)
      WHERE _id = $(_id)
    `, { _id: match._id, displayName, username, slug, email, emails: emailsColumnValue(email) });
    counts.usersUpdated++;
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
    const title = replaceEmojiCodes(topic.title);
    const userId = ids.userIds.get(opening.userId)!;
    const match = existing.get(String(topic.id));
    const cleaned = cleanContent(opening, ids.targets);
    const { hash } = cleaned;
    if (!match) {
      const revision = makeRevision(_id, "Posts", userId, cleaned, null, opening.createdAt);
      revisions.push(revision);
      newPosts.push({
        _id, slug, title, postedAt: opening.createdAt, createdAt: opening.createdAt,
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
    const fieldsChanged = match.title !== title || match.slug !== slug || match.userId !== userId
      || match.postedAt.getTime() !== opening.createdAt.getTime() || match.unpublished;
    const contentChanged = match.contentHash !== hash;
    if (!fieldsChanged && !contentChanged) continue;
    let revisionId: string | null = null;
    if (contentChanged) {
      const revision = makeRevision(_id, "Posts", userId, cleaned, match.version, new Date());
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
    `, { _id, title, slug, userId, postedAt: opening.createdAt, republish: match.unpublished, revisionId, hash });
    if (revisionId) {
      // The post page caches its rendered HTML and doesn't notice a new
      // revision written directly, so drop the cached copy (as
      // convertImagesInObject does)
      await tx.none(`DELETE FROM "SideCommentCaches" WHERE "postId" = $1`, [_id]);
    }
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

/**
 * The forum sets a post's link-preview image to its first image when the post
 * is saved (extractSocialPreviewImage), which raw imports skip. Fills it in
 * for migrated posts that have none, and replaces previews still pointing at
 * the old forum, whose images now live on Cloudinary. Posts with a preview
 * image chosen by hand are left alone.
 */
async function syncSocialPreviewImages(tx: Transaction, counts: ImportCounts): Promise<void> {
  const posts: { _id: string, previewUrl: string | null, html: string | null }[] = await tx.any(`
    -- importSecondRenaissanceDiscourse preview images
    SELECT p._id, p."socialPreviewImageAutoUrl" AS "previewUrl", r.html
    FROM "Posts" p LEFT JOIN "Revisions" r ON r._id = p.contents_latest
    WHERE p."legacyData" ? 'secondRenaissanceDiscourseTopicId'
      AND p."socialPreview"->>'imageId' IS NULL
      AND (COALESCE(p."socialPreviewImageAutoUrl", '') = '' OR p."socialPreviewImageAutoUrl" LIKE ANY($(oldForumPatterns)))
  `, { oldForumPatterns: OLD_FORUM_ORIGINS.map(origin => `${origin}/%`) });
  const updates = posts
    .map(({ _id, previewUrl, html }) => ({ _id, previewUrl: previewUrl ?? "", firstImage: getFirstImageSrc(html) }))
    .filter(({ previewUrl, firstImage }) => previewUrl !== firstImage);
  for (const { _id, firstImage } of updates) {
    await tx.none(`UPDATE "Posts" SET "socialPreviewImageAutoUrl" = $(firstImage) WHERE _id = $(_id)`, { _id, firstImage });
  }
  counts.previewImagesUpdated += updates.length;
}

function getFirstImageSrc(html: string | null): string {
  return cheerioParse(html ?? "")("img").first().attr("src") ?? "";
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
    const cleaned = cleanContent(reply, ids.targets);
    const { hash } = cleaned;
    if (!match) {
      const revision = makeRevision(_id, "Comments", userId, cleaned, null, reply.createdAt);
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
      revision = makeRevision(_id, "Comments", userId, cleaned, match.version, new Date());
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
/**
 * Lets old Discourse profile links (/u/<lowercase username>) find each member:
 * the profile page also looks accounts up by their old slugs. Accounts merged
 * away by claimDiscourseAccount first give up the member's slug.
 */
async function syncProfileSlugs(tx: Transaction, source: SourceData, ids: IdMaps, counts: ImportCounts): Promise<void> {
  const merged = await tx.result(`
    -- importSecondRenaissanceDiscourse merged slugs
    UPDATE "Users" SET slug = 'discourse-merged-' || ("legacyData"->>'secondRenaissanceDiscourseFormerUserId')
    WHERE "legacyData" ? 'secondRenaissanceDiscourseMergedInto' AND slug NOT LIKE 'discourse-merged-%'
  `);
  const profileSlugs = source.users.map(user => ({ _id: ids.userIds.get(user.id)!, slug: user.username.toLowerCase() }));
  const added = await tx.result(`
    -- importSecondRenaissanceDiscourse profile slugs
    UPDATE "Users" u SET "oldSlugs" = array_append(u."oldSlugs", v.slug)
    FROM (VALUES ${pgp.helpers.values(profileSlugs, ["_id", "slug"])}) AS v(_id, slug)
    WHERE u._id = v._id AND u.slug <> v.slug AND NOT (v.slug = ANY(u."oldSlugs"))
      AND NOT EXISTS (
        SELECT 1 FROM "Users" o WHERE o._id <> v._id AND (o.slug = v.slug OR v.slug = ANY(o."oldSlugs"))
      )
  `);
  counts.usersUpdated += merged.rowCount + added.rowCount;
}

/**
 * Migrated members were members of the old forum, so they shouldn't be
 * treated as brand-new accounts (#61): mark them reviewed by the admin
 * account, so their posts and comments aren't held for approval, and give
 * them enough karma to lift the limits on new accounts (3 comments a day,
 * 2 posts a week below 5 karma). Never lowers karma or changes an existing
 * reviewer.
 */
async function syncMemberTrust(tx: Transaction, counts: ImportCounts): Promise<void> {
  const adminAccountId = adminAccountSetting.get("LessWrong")?._id;
  if (!adminAccountId) throw new Error("The adminAccount setting is required to mark migrated members as reviewed");
  const result = await tx.result(`
    -- importSecondRenaissanceDiscourse member trust
    UPDATE "Users" SET
      "reviewedByUserId" = COALESCE("reviewedByUserId", $(adminAccountId)),
      "reviewedAt" = COALESCE("reviewedAt", NOW()),
      karma = GREATEST(COALESCE(karma, 0), $(startingKarma))
    WHERE "legacyData" ? 'secondRenaissanceDiscourseUserId'
      AND ("reviewedByUserId" IS NULL OR COALESCE(karma, 0) < $(startingKarma))
  `, { adminAccountId, startingKarma: MIGRATED_MEMBER_KARMA });
  counts.usersUpdated += result.rowCount;
}

/**
 * On the forum every post and comment starts with its author's own small
 * upvote, which the "magic" ranking relies on (#69). Migrated content was
 * imported without one, so add it, in the same shape the site creates.
 * Scores are recalculated from the votes after the import (recalculateScores).
 */
async function syncSelfVotes(tx: Transaction, counts: ImportCounts): Promise<void> {
  const missing: { documentId: string, collectionName: "Posts" | "Comments", userId: string, postedAt: Date }[] = await tx.any(`
    -- importSecondRenaissanceDiscourse missing self-votes
    SELECT d._id AS "documentId", d."collectionName", d."userId", d."postedAt" FROM (
      SELECT _id, 'Posts' AS "collectionName", "userId", "postedAt" FROM "Posts" WHERE "legacyData" ? 'secondRenaissanceDiscourseTopicId'
      UNION ALL
      SELECT _id, 'Comments', "userId", "postedAt" FROM "Comments" WHERE "legacyData" ? 'secondRenaissanceDiscoursePostId'
    ) d
    WHERE NOT EXISTS (
      SELECT 1 FROM "Votes" v WHERE v."documentId" = d._id AND v."userId" = d."userId" AND NOT v.cancelled
    )
  `);
  const votes = missing.map(({ documentId, collectionName, userId, postedAt }) => ({
    _id: randomId(), documentId, collectionName, userId, authorIds: [userId],
    voteType: "smallUpvote", power: 1, afPower: 1, votedAt: postedAt, createdAt: postedAt,
  }));
  await insertBatches(tx, voteColumns, votes);
  counts.selfVotesAdded += votes.length;
}

/**
 * Discourse likes become small upvotes by the same member (#66), so scores
 * reflect what members liked, and adds them to the author's karma, as voting
 * on the forum does. A like is skipped if the member has already voted on it
 * here, including a vote they later took back, so re-runs add only new likes.
 */
async function syncLikeVotes(tx: Transaction, source: SourceData, content: PublicContent, ids: IdMaps, counts: ImportCounts): Promise<void> {
  const likes = selectPublicLikes(source, content).map(({ like, post }) => ({
    documentId: post.postNumber === 1 ? ids.postIds.get(post.topicId)! : ids.commentIds.get(post.id)!,
    collectionName: post.postNumber === 1 ? "Posts" : "Comments",
    userId: ids.userIds.get(like.userId)!,
    likedAt: like.createdAt,
  }));
  if (!likes.length) return;
  const documents: { _id: string, userId: string, voterIds: string[] }[] = await tx.any(`
    -- importSecondRenaissanceDiscourse liked documents
    SELECT d._id, d."userId", ARRAY(SELECT v."userId" FROM "Votes" v WHERE v."documentId" = d._id) AS "voterIds"
    FROM (
      SELECT _id, "userId" FROM "Posts" WHERE _id IN ($(ids:csv))
      UNION ALL
      SELECT _id, "userId" FROM "Comments" WHERE _id IN ($(ids:csv))
    ) d
  `, { ids: [...new Set(likes.map(l => l.documentId))] });
  const documentsById = new Map(documents.map(d => [d._id, d]));
  const votes = likes.flatMap(({ documentId, collectionName, userId, likedAt }) => {
    const document = documentsById.get(documentId)!;
    if (document.userId === userId || document.voterIds.includes(userId)) return [];
    return [{
      _id: randomId(), documentId, collectionName, userId, authorIds: [document.userId],
      voteType: "smallUpvote", power: 1, afPower: 1, votedAt: likedAt, createdAt: likedAt,
    }];
  });
  await insertBatches(tx, voteColumns, votes);
  const karmaByAuthor = [...groupBy(votes, v => v.authorIds[0])].map(([_id, authorVotes]) => ({ _id, karma: authorVotes.length }));
  if (karmaByAuthor.length) {
    await tx.none(`
      -- importSecondRenaissanceDiscourse like karma
      UPDATE "Users" u SET karma = COALESCE(u.karma, 0) + v.karma::int
      FROM (VALUES ${pgp.helpers.values(karmaByAuthor, ["_id", "karma"])}) AS v(_id, karma)
      WHERE u._id = v._id
    `);
  }
  counts.likeVotesAdded += votes.length;
}

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

async function runImport(tx: Transaction, source: SourceData, content: PublicContent, uploadUrlsByPath: Map<string, string>): Promise<ImportCounts> {
  await tx.one("SELECT pg_advisory_xact_lock($1, $2) AS locked", ADVISORY_LOCK);
  const existing = await loadExisting(tx);
  const ids = assignIds(source, content, existing, uploadUrlsByPath);
  const counts = emptyCounts();
  await syncUsers(tx, source, existing.users, ids, counts);
  await syncProfileSlugs(tx, source, ids, counts);
  await syncPosts(tx, content, existing.posts, ids, counts);
  await syncSocialPreviewImages(tx, counts);
  await syncComments(tx, content, existing.comments, ids, counts);
  await syncMemberTrust(tx, counts);
  await syncSelfVotes(tx, counts);
  await syncLikeVotes(tx, source, content, ids, counts);
  await syncCounts(tx, counts);
  return counts;
}

/**
 * Recalculates the scores of migrated posts and comments whose base score no
 * longer matches their votes (e.g. after syncSelfVotes), with the site's own
 * recalculateDocumentScores, as scripts/recalculateDocumentScoresOnCollection
 * does. Outside the import transaction: it reads votes through the app.
 */
async function recalculateScores(): Promise<void> {
  const db = getSqlClientOrThrow();
  const context = createAnonymousContext();
  for (const [collectionName, legacyKey] of [["Posts", "secondRenaissanceDiscourseTopicId"], ["Comments", "secondRenaissanceDiscoursePostId"]] as const) {
    const ids: { _id: string }[] = await db.any(`
      -- importSecondRenaissanceDiscourse stale scores
      SELECT d._id FROM "${collectionName}" d
      WHERE d."legacyData" ? '${legacyKey}' AND d."baseScore" IS DISTINCT FROM (
        SELECT COALESCE(SUM(v.power), 0) FROM "Votes" v WHERE v."documentId" = d._id AND NOT v.cancelled
      )
    `);
    const collection = getCollection(collectionName);
    const documents = await collection.find({ _id: { $in: ids.map(({ _id }) => _id) } }).fetch();
    await executePromiseQueue(documents.map(document => async () => {
      const { baseScore, voteCount, afVoteCount, score, extendedScore, afExtendedScore } =
        await recalculateDocumentScores(document, collectionName, context);
      await collection.rawUpdateOne({ _id: document._id }, { $set: { baseScore, voteCount, afVoteCount, score, extendedScore, afExtendedScore } });
    }), 5);
    console.log(`Recalculated the scores of ${documents.length} ${collectionName.toLowerCase()}`);
  }
  // Karma thresholds (e.g. on All Posts) filter on a post's highest score
  await db.none(`
    -- importSecondRenaissanceDiscourse max scores
    UPDATE "Posts" SET "maxBaseScore" = "baseScore"
    WHERE "legacyData" ? 'secondRenaissanceDiscourseTopicId' AND "baseScore" > COALESCE("maxBaseScore", 0)
  `);
}

export async function importSecondRenaissanceDiscourse({ execute = false, allowRemote = false, uploadsDir }: {
  execute?: boolean,
  allowRemote?: boolean,
  /** The backup's extracted `uploads/` folder; without it, files not yet on Cloudinary keep their Discourse URLs */
  uploadsDir?: string,
} = {}): Promise<ImportCounts> {
  const target = checkTarget(allowRemote);
  console.log(`${execute ? "EXECUTING" : "DRY RUN (rolled back)"}: importing into ${target}`);
  const source = await loadDiscourseSource();
  const content = selectPublicContent(source);

  // Uploads happen outside the transaction: Cloudinary can't be rolled back,
  // and the Images table makes them reusable on the next run
  const publicPosts = [...content.openingPosts.values(), ...content.publicReplies];
  const linkPaths = new Set(publicPosts.flatMap(post => findDiscourseUploadPaths(post.cooked)));
  const uploads = await mirrorDiscourseUploads(linkPaths, await loadDiscourseUploads(), { uploadsDir, execute });
  console.log(`Uploads: ${uploads.uploaded} uploaded to Cloudinary, ${uploads.pending} not yet uploaded, ${uploads.failed.length} failed`);
  for (const failure of uploads.failed) console.log(`  Failed: ${failure}`);

  let counts = emptyCounts();
  try {
    await getSqlClientOrThrow().tx(async tx => {
      counts = await runImport(tx, source, content, uploads.urlsByPath);
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
  await recalculateScores();
  await createSecondRenaissanceCategoryTags({ execute: true });
  await verifySecondRenaissanceMigration();
  return counts;
}

export default importSecondRenaissanceDiscourse;

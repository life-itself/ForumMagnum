import { replaceEmojiCodes } from "./secondRenaissanceDiscourseEmoji";

/**
 * Pure checks comparing the Second Renaissance Discourse backup with the
 * migrated ForumMagnum data (issue #36). Loading lives in
 * verifySecondRenaissanceMigration.ts; this module has no database access so
 * it can be unit tested.
 */

export interface CategoryTag {
  discourseCategoryId: number
  name: string
  slug: string
  /** Slugs the tag had before its category was renamed */
  previousSlugs?: string[]
}

// Public categories only; topics in read-restricted categories (Staff, the
// Oasis Tents subcategories, etc.) aren't migrated. Category 6 was renamed in
// Discourse from "Ideas"; renaming the tag moves its slug and keeps the old one
// as a redirect.
export const CATEGORY_TAGS: CategoryTag[] = [
  { discourseCategoryId: 4, name: "General", slug: "general" },
  { discourseCategoryId: 6, name: "Research and Sense-Making", slug: "research-and-sense-making", previousSlugs: ["ideas"] },
  { discourseCategoryId: 7, name: "People and Orgs", slug: "people-and-orgs" },
  { discourseCategoryId: 11, name: "Welcome", slug: "welcome" },
  { discourseCategoryId: 12, name: "Events", slug: "events" },
  { discourseCategoryId: 13, name: "Oasis Tents", slug: "oasis-tents" },
  { discourseCategoryId: 20, name: "Meta", slug: "meta" },
  { discourseCategoryId: 21, name: "Wiki", slug: "wiki" },
  { discourseCategoryId: 23, name: "Embodied Knowing", slug: "embodied-knowing" },
];

/**
 * Starting karma for migrated members: upstream's automatic rate limits for
 * new accounts apply below 5 karma (#61)
 */
export const MIGRATED_MEMBER_KARMA = 5;

export interface SourceUser {
  id: number
  username: string
  name: string | null
  createdAt: Date
  /** Primary email; null for the system account */
  email: string | null
}

export interface SourceTopic {
  id: number
  title: string
  archetype: string
  visible: boolean
  categoryId: number | null
  /** In a read-restricted category, or one limited to specific groups */
  restricted: boolean
}

export interface SourcePost {
  id: number
  topicId: number
  postNumber: number
  replyToPostNumber: number | null
  userId: number
  createdAt: Date
  hidden: boolean
  userDeleted: boolean
  /** Discourse-rendered HTML */
  cooked: string
}

export interface SourceData {
  users: SourceUser[]
  topics: SourceTopic[]
  posts: SourcePost[]
}

export interface TargetUser {
  _id: string
  discourseUserId: string
  displayName: string | null
  /** Lowercased, so the check can compare without printing it */
  email: string | null
  /** An account the member already had here, linked by claimDiscourseAccount */
  claimed: boolean
  reviewed: boolean
  karma: number
}

export interface TargetPost {
  _id: string
  discourseTopicId: string
  discourseOpeningPostId: string | null
  title: string
  postedAt: Date
  userId: string
  draft: boolean
  deletedDraft: boolean
  hasContents: boolean
  /** Has its author's own upvote, which every post starts with on the forum */
  hasSelfVote: boolean
  commentCount: number
  /** Comments written on the forum rather than migrated */
  forumCommentCount: number
  tagSlugs: string[]
}

export interface TargetComment {
  _id: string
  discoursePostId: string
  postId: string
  userId: string
  postedAt: Date
  parentCommentId: string | null
  topLevelCommentId: string | null
  deleted: boolean
  hasContents: boolean
  hasSelfVote: boolean
}

export interface OtherAccount {
  username: string
  email: string
}

export interface TargetData {
  users: TargetUser[]
  /** Accounts that aren't linked to a Discourse user, with lowercased emails */
  otherAccounts: OtherAccount[]
  posts: TargetPost[]
  comments: TargetComment[]
}

export interface MigrationCheckResult {
  expected: { users: number, posts: number, comments: number }
  migrated: { users: number, posts: number, comments: number }
  problems: string[]
  /** Expected differences worth knowing about, such as posts members unpublished themselves */
  notes: string[]
}

const EMAIL_PATTERN = /\S+@\S+\.\S+/;

/** Public topics are regular, visible and outside restricted categories */
export function isPublicTopic(topic: SourceTopic): boolean {
  return topic.archetype === "regular" && topic.visible && !topic.restricted;
}

export interface PublicContent {
  publicTopics: SourceTopic[]
  publicTopicIds: Set<number>
  /** Opening post (#1) of each public topic, by topic ID */
  openingPosts: Map<number, SourcePost>
  publicReplies: SourcePost[]
  repliesByTopic: Map<number, SourcePost[]>
}

/** The topics and replies that should be on the forum: public, and not hidden or deleted by their author */
export function selectPublicContent(source: SourceData): PublicContent {
  const publicTopics = source.topics.filter(isPublicTopic);
  const publicTopicIds = new Set(publicTopics.map(t => t.id));
  const publicPosts = source.posts.filter(p => publicTopicIds.has(p.topicId) && !p.hidden && !p.userDeleted);
  const publicReplies = publicPosts.filter(p => p.postNumber > 1);
  return {
    publicTopics,
    publicTopicIds,
    openingPosts: new Map(publicPosts.filter(p => p.postNumber === 1).map(p => [p.topicId, p])),
    publicReplies,
    repliesByTopic: groupBy(publicReplies, r => r.topicId),
  };
}

export function groupBy<T, K>(items: T[], getKey: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** The Discourse name, or the username if the name is empty or an email address */
export function getExpectedDisplayName(user: SourceUser): string {
  const name = user.name?.trim();
  return name && !EMAIL_PATTERN.test(name) ? name : user.username;
}

function checkUsers(source: SourceData, target: TargetData, problems: string[]): Map<number, string> {
  const otherAccountsByEmail = new Map(target.otherAccounts.map(a => [a.email, a.username]));
  const targetByDiscourseId = groupBy(target.users, u => u.discourseUserId);
  const userIdMap = new Map<number, string>();
  for (const sourceUser of source.users) {
    const matches = targetByDiscourseId.get(String(sourceUser.id)) ?? [];
    if (matches.length !== 1) {
      problems.push(`User ${sourceUser.username} (Discourse ${sourceUser.id}): expected 1 migrated user, found ${matches.length}`);
      continue;
    }
    const [user] = matches;
    userIdMap.set(sourceUser.id, user._id);
    if (!user.reviewed) problems.push(`User ${sourceUser.username}: not marked as reviewed, so their posts and comments are held for approval`);
    if (user.karma < MIGRATED_MEMBER_KARMA) problems.push(`User ${sourceUser.username}: karma is ${user.karma}, so new-account rate limits apply`);
    // Claimed accounts keep the name and email their owner chose
    if (user.claimed) continue;
    const expectedName = getExpectedDisplayName(sourceUser);
    if (user.displayName !== expectedName) {
      problems.push(`User ${sourceUser.username}: display name is "${user.displayName}", expected "${expectedName}"`);
    }
    const email = sourceUser.email?.toLowerCase();
    const otherAccount = email && otherAccountsByEmail.get(email);
    if (otherAccount) {
      problems.push(`User ${sourceUser.username} already has an account here (${otherAccount}); link it with claimDiscourseAccount`);
    } else if (email && user.email !== email) {
      problems.push(`User ${sourceUser.username}: email isn't set to their Discourse email, so they can't reset their password`);
    }
  }
  const sourceIds = new Set(source.users.map(u => String(u.id)));
  for (const user of target.users) {
    if (!sourceIds.has(user.discourseUserId)) {
      problems.push(`User ${user._id}: Discourse user ${user.discourseUserId} isn't in the backup`);
    }
    if (user.displayName && EMAIL_PATTERN.test(user.displayName)) {
      problems.push(`User ${user._id} (Discourse ${user.discourseUserId}): display name is an email address (PRIVACY)`);
    }
  }
  return userIdMap;
}

function checkPosts(
  publicTopics: SourceTopic[],
  openingPosts: Map<number, SourcePost>,
  repliesByTopic: Map<number, SourcePost[]>,
  userIdMap: Map<number, string>,
  target: TargetData,
  problems: string[],
  notes: string[],
): Map<number, string> {
  const targetByTopicId = groupBy(target.posts, p => p.discourseTopicId);
  const tagSlugByCategory = new Map(CATEGORY_TAGS.map(c => [c.discourseCategoryId, c.slug]));
  const postIdMap = new Map<number, string>();
  for (const topic of publicTopics) {
    const label = `Topic ${topic.id} "${topic.title}"`;
    const matches = targetByTopicId.get(String(topic.id)) ?? [];
    if (matches.length !== 1) {
      problems.push(`${label}: expected 1 migrated post, found ${matches.length}`);
      continue;
    }
    const [post] = matches;
    postIdMap.set(topic.id, post._id);
    const opening = openingPosts.get(topic.id);
    if (!opening) {
      problems.push(`${label}: no opening post in the backup`);
      continue;
    }
    if (post.title !== replaceEmojiCodes(topic.title)) problems.push(`${label}: title is "${post.title}"`);
    if (post.postedAt.getTime() !== opening.createdAt.getTime()) {
      problems.push(`${label}: postedAt is ${post.postedAt.toISOString()}, expected ${opening.createdAt.toISOString()}`);
    }
    if (post.userId !== userIdMap.get(opening.userId)) problems.push(`${label}: wrong author`);
    if (post.discourseOpeningPostId !== String(opening.id)) problems.push(`${label}: wrong opening post ID`);
    // Members can move their own posts back to drafts or delete them; the
    // importer only republishes posts it unpublished itself
    if (post.draft || post.deletedDraft) notes.push(`${label}: unpublished by its author`);
    if (!post.hasContents) problems.push(`${label}: post has no content`);
    if (!post.hasSelfVote) problems.push(`${label}: post is missing its author's self-vote, so it ranks as 0`);
    const expectedCommentCount = (repliesByTopic.get(topic.id)?.length ?? 0) + post.forumCommentCount;
    if (post.commentCount !== expectedCommentCount) {
      problems.push(`${label}: comment count is ${post.commentCount}, expected ${expectedCommentCount}`);
    }
    const tagSlug = topic.categoryId === null ? undefined : tagSlugByCategory.get(topic.categoryId);
    if (!tagSlug) problems.push(`${label}: category ${topic.categoryId} has no tag`);
    else if (!post.tagSlugs.includes(tagSlug)) problems.push(`${label}: missing tag "${tagSlug}"`);
  }
  return postIdMap;
}

export interface ReplyNesting {
  /** Discourse post ID of the parent reply, or null for a top-level comment */
  parentId: number | null
  /** Discourse post ID of the top-level reply of the thread, or null for a top-level comment */
  rootId: number | null
}

/**
 * Where each public reply sits in its comment tree. Replies to the opening post
 * (#1) are top-level, and so are replies whose parent isn't public (for
 * example, it was deleted in Discourse).
 */
export function getReplyNesting(publicReplies: SourcePost[]): Map<number, ReplyNesting> {
  const repliesByNumber = new Map(publicReplies.map(r => [`${r.topicId}:${r.postNumber}`, r]));
  const parentOf = new Map<number, SourcePost | null>();
  for (const reply of publicReplies) {
    const isTopLevel = reply.replyToPostNumber === null || reply.replyToPostNumber === 1;
    parentOf.set(reply.id, isTopLevel ? null : repliesByNumber.get(`${reply.topicId}:${reply.replyToPostNumber}`) ?? null);
  }
  const nesting = new Map<number, ReplyNesting>();
  for (const reply of publicReplies) {
    const parent = parentOf.get(reply.id) ?? null;
    let root = parent;
    // Discourse replies always point at earlier posts, so this terminates
    for (let next = root && parentOf.get(root.id); next; next = parentOf.get(next.id)) root = next;
    nesting.set(reply.id, { parentId: parent?.id ?? null, rootId: root?.id ?? null });
  }
  return nesting;
}

function getMigratedCommentId(discoursePostId: number | null, targetByPostId: Map<string, TargetComment[]>): string | null {
  if (discoursePostId === null) return null;
  const matches = targetByPostId.get(String(discoursePostId)) ?? [];
  return matches.length === 1 ? matches[0]._id : null;
}

function checkComments(
  publicReplies: SourcePost[],
  userIdMap: Map<number, string>,
  postIdMap: Map<number, string>,
  target: TargetData,
  problems: string[],
): void {
  const targetByPostId = groupBy(target.comments, c => c.discoursePostId);
  const nesting = getReplyNesting(publicReplies);
  for (const reply of publicReplies) {
    const label = `Reply ${reply.id} (topic ${reply.topicId} #${reply.postNumber})`;
    const matches = targetByPostId.get(String(reply.id)) ?? [];
    if (matches.length !== 1) {
      problems.push(`${label}: expected 1 migrated comment, found ${matches.length}`);
      continue;
    }
    const [comment] = matches;
    if (comment.postId !== postIdMap.get(reply.topicId)) problems.push(`${label}: on the wrong post`);
    if (comment.userId !== userIdMap.get(reply.userId)) problems.push(`${label}: wrong author`);
    if (comment.postedAt.getTime() !== reply.createdAt.getTime()) {
      problems.push(`${label}: postedAt is ${comment.postedAt.toISOString()}, expected ${reply.createdAt.toISOString()}`);
    }
    if (comment.deleted) problems.push(`${label}: comment is deleted`);
    if (!comment.hasContents) problems.push(`${label}: comment has no content`);
    if (!comment.hasSelfVote) problems.push(`${label}: comment is missing its author's self-vote`);

    const { parentId, rootId } = nesting.get(reply.id)!;
    const expectedParentId = getMigratedCommentId(parentId, targetByPostId);
    const expectedTopLevelId = getMigratedCommentId(rootId, targetByPostId);
    if (comment.parentCommentId !== expectedParentId) problems.push(`${label}: wrong parent comment`);
    if (comment.topLevelCommentId !== expectedTopLevelId) problems.push(`${label}: wrong top-level comment`);
  }
}

/**
 * Why a migrated record's source shouldn't have been migrated. Records the
 * importer has already unpublished (draft posts, deleted comments) are fine.
 */
function describeUnexpectedSource(topic: SourceTopic | undefined): string {
  if (!topic) return "isn't in the backup";
  if (topic.archetype === "private_message" || topic.restricted) return "is private (PRIVACY)";
  return "isn't public";
}

function checkNothingExtra(source: SourceData, publicTopicIds: Set<number>, publicReplyIds: Set<number>, target: TargetData, problems: string[]): void {
  const topicsById = new Map(source.topics.map(t => [t.id, t]));
  const postsById = new Map(source.posts.map(p => [p.id, p]));
  for (const post of target.posts) {
    const topicId = Number(post.discourseTopicId);
    if (publicTopicIds.has(topicId) || post.draft) continue;
    problems.push(`Post ${post._id}: Discourse topic ${topicId} ${describeUnexpectedSource(topicsById.get(topicId))}`);
  }
  for (const comment of target.comments) {
    const postId = Number(comment.discoursePostId);
    if (publicReplyIds.has(postId) || comment.deleted) continue;
    const sourcePost = postsById.get(postId);
    const description = sourcePost ? describeUnexpectedSource(topicsById.get(sourcePost.topicId)) : "isn't in the backup";
    problems.push(`Comment ${comment._id}: Discourse post ${postId} ${description}`);
  }
}

/**
 * Compares the Discourse backup with the migrated data. Content may have been
 * edited since the import, so bodies are only checked for being non-empty.
 */
export function checkSecondRenaissanceMigration(source: SourceData, target: TargetData): MigrationCheckResult {
  const problems: string[] = [];
  const notes: string[] = [];
  const { publicTopics, publicTopicIds, openingPosts, publicReplies, repliesByTopic } = selectPublicContent(source);

  const userIdMap = checkUsers(source, target, problems);
  const postIdMap = checkPosts(publicTopics, openingPosts, repliesByTopic, userIdMap, target, problems, notes);
  checkComments(publicReplies, userIdMap, postIdMap, target, problems);
  checkNothingExtra(source, publicTopicIds, new Set(publicReplies.map(r => r.id)), target, problems);

  return {
    expected: { users: source.users.length, posts: publicTopics.length, comments: publicReplies.length },
    migrated: { users: target.users.length, posts: target.posts.length, comments: target.comments.length },
    problems,
    notes,
  };
}

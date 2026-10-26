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
}

// The Staff category (#3) is private and its topics aren't migrated
export const CATEGORY_TAGS: CategoryTag[] = [
  { discourseCategoryId: 4, name: "General", slug: "general" },
  { discourseCategoryId: 6, name: "Ideas", slug: "ideas" },
  { discourseCategoryId: 7, name: "People and Orgs", slug: "people-and-orgs" },
  { discourseCategoryId: 11, name: "Welcome", slug: "welcome" },
  { discourseCategoryId: 12, name: "Events", slug: "events" },
];

export interface SourceUser {
  id: number
  username: string
  name: string | null
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
}

export interface TargetData {
  users: TargetUser[]
  posts: TargetPost[]
  comments: TargetComment[]
}

export interface MigrationCheckResult {
  expected: { users: number, posts: number, comments: number }
  migrated: { users: number, posts: number, comments: number }
  problems: string[]
}

const EMAIL_PATTERN = /\S+@\S+\.\S+/;

/** Public topics are regular, visible and outside restricted categories */
export function isPublicTopic(topic: SourceTopic): boolean {
  return topic.archetype === "regular" && topic.visible && !topic.restricted;
}

function groupBy<T, K>(items: T[], getKey: (item: T) => K): Map<K, T[]> {
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
    const expectedName = getExpectedDisplayName(sourceUser);
    if (user.displayName !== expectedName) {
      problems.push(`User ${sourceUser.username}: display name is "${user.displayName}", expected "${expectedName}"`);
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
  userIdMap: Map<number, string>,
  target: TargetData,
  problems: string[],
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
    if (post.title !== topic.title) problems.push(`${label}: title is "${post.title}"`);
    if (post.postedAt.getTime() !== opening.createdAt.getTime()) {
      problems.push(`${label}: postedAt is ${post.postedAt.toISOString()}, expected ${opening.createdAt.toISOString()}`);
    }
    if (post.userId !== userIdMap.get(opening.userId)) problems.push(`${label}: wrong author`);
    if (post.discourseOpeningPostId !== String(opening.id)) problems.push(`${label}: wrong opening post ID`);
    if (post.draft || post.deletedDraft) problems.push(`${label}: post is a draft or deleted`);
    if (!post.hasContents) problems.push(`${label}: post has no content`);
    const tagSlug = topic.categoryId === null ? undefined : tagSlugByCategory.get(topic.categoryId);
    if (!tagSlug) problems.push(`${label}: category ${topic.categoryId} has no tag`);
    else if (!post.tagSlugs.includes(tagSlug)) problems.push(`${label}: missing tag "${tagSlug}"`);
  }
  return postIdMap;
}

/** Replies to the opening post (#1) are top-level comments */
function isTopLevelReply(reply: SourcePost): boolean {
  return reply.replyToPostNumber === null || reply.replyToPostNumber === 1;
}

function getParentReply(reply: SourcePost, repliesByNumber: Map<string, SourcePost>): SourcePost | null {
  if (isTopLevelReply(reply)) return null;
  return repliesByNumber.get(`${reply.topicId}:${reply.replyToPostNumber}`) ?? null;
}

function getMigratedCommentId(reply: SourcePost, targetByPostId: Map<string, TargetComment[]>): string | null {
  const matches = targetByPostId.get(String(reply.id)) ?? [];
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
  const repliesByNumber = new Map(publicReplies.map(r => [`${r.topicId}:${r.postNumber}`, r]));
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

    const parent = getParentReply(reply, repliesByNumber);
    if (!isTopLevelReply(reply) && !parent) {
      problems.push(`${label}: parent #${reply.replyToPostNumber} isn't a public reply`);
      continue;
    }
    let root = parent;
    let next = root && getParentReply(root, repliesByNumber);
    while (next) {
      root = next;
      next = getParentReply(next, repliesByNumber);
    }
    const expectedParentId = parent ? getMigratedCommentId(parent, targetByPostId) : null;
    const expectedTopLevelId = root ? getMigratedCommentId(root, targetByPostId) : null;
    if (comment.parentCommentId !== expectedParentId) problems.push(`${label}: wrong parent comment`);
    if (comment.topLevelCommentId !== expectedTopLevelId) problems.push(`${label}: wrong top-level comment`);
  }
}

/** Why a migrated record's source shouldn't have been migrated */
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
    if (publicTopicIds.has(topicId)) continue;
    problems.push(`Post ${post._id}: Discourse topic ${topicId} ${describeUnexpectedSource(topicsById.get(topicId))}`);
  }
  for (const comment of target.comments) {
    const postId = Number(comment.discoursePostId);
    if (publicReplyIds.has(postId)) continue;
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
  const publicTopics = source.topics.filter(isPublicTopic);
  const publicTopicIds = new Set(publicTopics.map(t => t.id));
  const publicPosts = source.posts.filter(p => publicTopicIds.has(p.topicId) && !p.hidden && !p.userDeleted);
  const openingPosts = new Map(publicPosts.filter(p => p.postNumber === 1).map(p => [p.topicId, p]));
  const publicReplies = publicPosts.filter(p => p.postNumber > 1);

  const userIdMap = checkUsers(source, target, problems);
  const postIdMap = checkPosts(publicTopics, openingPosts, userIdMap, target, problems);
  checkComments(publicReplies, userIdMap, postIdMap, target, problems);
  checkNothingExtra(source, publicTopicIds, new Set(publicReplies.map(r => r.id)), target, problems);

  return {
    expected: { users: source.users.length, posts: publicTopics.length, comments: publicReplies.length },
    migrated: { users: target.users.length, posts: target.posts.length, comments: target.comments.length },
    problems,
  };
}

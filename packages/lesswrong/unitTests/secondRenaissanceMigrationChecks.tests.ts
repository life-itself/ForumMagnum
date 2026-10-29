import {
  checkSecondRenaissanceMigration,
  type SourceData,
  type TargetData,
} from '../scripts/secondRenaissanceMigrationChecks';

const date = (day: number) => new Date(`2025-01-${String(day).padStart(2, "0")}T12:00:00.000Z`);

// Topic 10 is public with a reply chain (#2 <- #3 <- #4) and a top-level reply
// (#5). Topic 20 is a Staff topic and topic 30 a private message; neither
// should be migrated.
function makeSource(): SourceData {
  return {
    users: [
      { id: -1, username: "system", name: null, createdAt: date(1), email: null },
      { id: 1, username: "alice", name: "Alice A", createdAt: date(1), email: "Alice@Example.com" },
      { id: 2, username: "bob", name: "", createdAt: date(1), email: "bob@example.com" },
    ],
    topics: [
      { id: 10, title: "Hello", archetype: "regular", visible: true, categoryId: 4, restricted: false },
      { id: 20, title: "Staff notes", archetype: "regular", visible: true, categoryId: 3, restricted: true },
      { id: 30, title: "DM", archetype: "private_message", visible: true, categoryId: null, restricted: false },
    ],
    posts: [
      { id: 100, topicId: 10, postNumber: 1, replyToPostNumber: null, userId: 1, createdAt: date(1), hidden: false, userDeleted: false, cooked: "<p>Text</p>" },
      { id: 101, topicId: 10, postNumber: 2, replyToPostNumber: null, userId: 2, createdAt: date(2), hidden: false, userDeleted: false, cooked: "<p>Text</p>" },
      { id: 102, topicId: 10, postNumber: 3, replyToPostNumber: 2, userId: 1, createdAt: date(3), hidden: false, userDeleted: false, cooked: "<p>Text</p>" },
      { id: 103, topicId: 10, postNumber: 4, replyToPostNumber: 3, userId: -1, createdAt: date(4), hidden: false, userDeleted: false, cooked: "<p>Text</p>" },
      { id: 104, topicId: 10, postNumber: 5, replyToPostNumber: 1, userId: 2, createdAt: date(5), hidden: false, userDeleted: false, cooked: "<p>Text</p>" },
      { id: 200, topicId: 20, postNumber: 1, replyToPostNumber: null, userId: 1, createdAt: date(6), hidden: false, userDeleted: false, cooked: "<p>Text</p>" },
      { id: 300, topicId: 30, postNumber: 1, replyToPostNumber: null, userId: 2, createdAt: date(7), hidden: false, userDeleted: false, cooked: "<p>Text</p>" },
    ],
    // Bob likes the opening post and Alice likes reply #2; the like on the
    // private message isn't migrated
    likes: [
      { postId: 100, userId: 2, createdAt: date(8) },
      { postId: 101, userId: 1, createdAt: date(8) },
      { postId: 300, userId: 1, createdAt: date(8) },
    ],
  };
}

function comment(_id: string, discoursePostId: string, userId: string, day: number, parentCommentId: string | null, topLevelCommentId: string | null) {
  return { _id, discoursePostId, postId: "post10", userId, postedAt: date(day), parentCommentId, topLevelCommentId, deleted: false, hasContents: true, hasSelfVote: true, voterIds: [userId] };
}

function makeTarget(): TargetData {
  const target: TargetData = {
    users: [
      { _id: "userSystem", discourseUserId: "-1", displayName: "system", email: null, claimed: false, reviewed: true, karma: 5 },
      { _id: "userAlice", discourseUserId: "1", displayName: "Alice A", email: "alice@example.com", claimed: false, reviewed: true, karma: 12 },
      { _id: "userBob", discourseUserId: "2", displayName: "bob", email: "bob@example.com", claimed: false, reviewed: true, karma: 5 },
    ],
    otherAccounts: [],
    posts: [{
      _id: "post10", discourseTopicId: "10", discourseOpeningPostId: "100", title: "Hello", postedAt: date(1),
      userId: "userAlice", draft: false, deletedDraft: false, hasContents: true, hasSelfVote: true, voterIds: ["userAlice", "userBob"], commentCount: 4, forumCommentCount: 0, tagSlugs: ["general"],
    }],
    comments: [
      comment("c101", "101", "userBob", 2, null, null),
      comment("c102", "102", "userAlice", 3, "c101", "c101"),
      comment("c103", "103", "userSystem", 4, "c102", "c101"),
      comment("c104", "104", "userBob", 5, null, null),
    ],
  };
  target.comments[0].voterIds.push("userAlice");
  return target;
}

function getProblems(target: TargetData, source = makeSource()) {
  return checkSecondRenaissanceMigration(source, target).problems;
}

describe('checkSecondRenaissanceMigration', () => {
  it('passes when the migrated data matches the backup', () => {
    const result = checkSecondRenaissanceMigration(makeSource(), makeTarget());
    expect(result.problems).toEqual([]);
    expect(result.expected).toEqual({ users: 3, posts: 1, comments: 4 });
  });

  it('reports missing and duplicated records', () => {
    const target = makeTarget();
    target.users = target.users.filter(u => u.discourseUserId !== "2");
    target.comments.push({ ...target.comments[3], _id: "c104dup" });
    const problems = getProblems(target);
    expect(problems).toContainEqual(expect.stringMatching(/User bob .*expected 1 migrated user, found 0/));
    expect(problems).toContainEqual(expect.stringMatching(/Reply 104 .*expected 1 migrated comment, found 2/));
  });

  it('reports a missing post', () => {
    const target = makeTarget();
    target.posts = [];
    expect(getProblems(target)).toContainEqual(expect.stringMatching(/Topic 10 "Hello": expected 1 migrated post, found 0/));
  });

  it('reports wrong post fields', () => {
    const target = makeTarget();
    target.posts[0] = { ...target.posts[0], title: "Bye", postedAt: date(9), userId: "userBob", draft: true, hasContents: false, tagSlugs: [] };
    const problems = getProblems(target);
    expect(problems).toContainEqual(expect.stringMatching(/title is "Bye"/));
    expect(problems).toContainEqual(expect.stringMatching(/Topic 10 .*postedAt/));
    expect(problems).toContainEqual(expect.stringMatching(/Topic 10 .*wrong author/));
    expect(problems).toContainEqual(expect.stringMatching(/post has no content/));
    expect(problems).toContainEqual(expect.stringMatching(/missing tag "general"/));
  });

  it('reports wrong comment nesting', () => {
    const target = makeTarget();
    target.comments[2] = { ...target.comments[2], parentCommentId: "c101", topLevelCommentId: "c102" };
    target.comments[3] = { ...target.comments[3], parentCommentId: "c101", topLevelCommentId: "c101" };
    const problems = getProblems(target);
    expect(problems).toContainEqual(expect.stringMatching(/Reply 103 .*wrong parent comment/));
    expect(problems).toContainEqual(expect.stringMatching(/Reply 103 .*wrong top-level comment/));
    expect(problems).toContainEqual(expect.stringMatching(/Reply 104 .*wrong parent comment/));
  });

  it('notes posts their authors unpublished, without failing', () => {
    const target = makeTarget();
    target.posts[0] = { ...target.posts[0], draft: true };
    const result = checkSecondRenaissanceMigration(makeSource(), target);
    expect(result.problems).toEqual([]);
    expect(result.notes).toContainEqual(expect.stringMatching(/Topic 10 .*unpublished by its author/));
  });

  it('reports content missing its self-vote', () => {
    const target = makeTarget();
    target.posts[0] = { ...target.posts[0], hasSelfVote: false };
    target.comments[0] = { ...target.comments[0], hasSelfVote: false };
    const problems = getProblems(target);
    expect(problems).toContainEqual(expect.stringMatching(/Topic 10 .*missing its author's self-vote/));
    expect(problems).toContainEqual(expect.stringMatching(/Reply 101 .*missing its author's self-vote/));
  });

  it('reports likes that are not upvotes', () => {
    const target = makeTarget();
    target.posts[0] = { ...target.posts[0], voterIds: ["userAlice"] };
    target.comments[0] = { ...target.comments[0], voterIds: ["userBob"] };
    const problems = getProblems(target);
    expect(problems).toContainEqual("Topic 10: 1 Discourse like(s) aren't upvotes");
    expect(problems).toContainEqual("Reply 101 (topic 10 #2): 1 Discourse like(s) aren't upvotes");
  });

  it('ignores likes on content that is not migrated', () => {
    const source = makeSource();
    source.posts[4] = { ...source.posts[4], hidden: true };
    source.likes.push({ postId: 104, userId: 1, createdAt: date(9) });
    const target = makeTarget();
    target.comments = target.comments.filter(c => c._id !== "c104");
    target.posts[0] = { ...target.posts[0], commentCount: 3 };
    expect(getProblems(target, source)).toEqual([]);
  });

  it('reports wrong comment fields', () => {
    const target = makeTarget();
    target.comments[0] = { ...target.comments[0], userId: "userAlice", postedAt: date(9), deleted: true, hasContents: false };
    const problems = getProblems(target);
    expect(problems).toContainEqual(expect.stringMatching(/Reply 101 .*wrong author/));
    expect(problems).toContainEqual(expect.stringMatching(/Reply 101 .*postedAt/));
    expect(problems).toContainEqual(expect.stringMatching(/Reply 101 .*comment is deleted/));
    expect(problems).toContainEqual(expect.stringMatching(/Reply 101 .*no content/));
  });

  it('reports a member treated as a new account', () => {
    const target = makeTarget();
    target.users[1] = { ...target.users[1], reviewed: false, karma: 0 };
    const problems = getProblems(target);
    expect(problems).toContainEqual(expect.stringMatching(/User alice: not marked as reviewed/));
    expect(problems).toContainEqual(expect.stringMatching(/User alice: karma is 0/));
  });

  it('reports a member whose email is missing', () => {
    const target = makeTarget();
    target.users[1] = { ...target.users[1], email: null };
    expect(getProblems(target)).toContainEqual(expect.stringMatching(/User alice: email isn't set/));
  });

  it('reports a member who already has another account', () => {
    const target = makeTarget();
    target.users[2] = { ...target.users[2], email: null };
    target.otherAccounts = [{ username: "bobby", email: "bob@example.com" }];
    expect(getProblems(target)).toContainEqual("User bob already has an account here (bobby); link it with claimDiscourseAccount");
  });

  it('accepts the name and email a claimed account chose', () => {
    const target = makeTarget();
    target.users[2] = { ...target.users[2], displayName: "Robert", email: "robert@example.org", claimed: true };
    expect(getProblems(target)).toEqual([]);
  });

  it('reports Staff topics and private messages as privacy problems', () => {
    const target = makeTarget();
    target.posts.push({ ...target.posts[0], _id: "post20", discourseTopicId: "20", title: "Staff notes" });
    target.comments.push({ ...target.comments[0], _id: "c300", discoursePostId: "300" });
    const problems = getProblems(target);
    expect(problems).toContainEqual("Post post20: Discourse topic 20 is private (PRIVACY)");
    expect(problems).toContainEqual("Comment c300: Discourse post 300 is private (PRIVACY)");
  });

  it('reports a display name that is an email address', () => {
    const source = makeSource();
    source.users[2] = { ...source.users[2], name: "bob@example.com" };
    const target = makeTarget();
    target.users[2] = { ...target.users[2], displayName: "bob@example.com" };
    expect(getProblems(target, source)).toContainEqual(expect.stringMatching(/userBob .*email address \(PRIVACY\)/));
  });

  it('expects the username when the Discourse name is an email address', () => {
    const source = makeSource();
    source.users[2] = { ...source.users[2], name: "bob@example.com" };
    expect(getProblems(makeTarget(), source)).toEqual([]);
  });

  it('does not expect hidden posts to be migrated', () => {
    const source = makeSource();
    source.posts[4] = { ...source.posts[4], hidden: true };
    const target = makeTarget();
    target.comments = target.comments.filter(c => c._id !== "c104");
    target.posts[0] = { ...target.posts[0], commentCount: 3 };
    expect(getProblems(target, source)).toEqual([]);
  });

  it('counts comments written on the forum', () => {
    const target = makeTarget();
    target.posts[0] = { ...target.posts[0], commentCount: 5, forumCommentCount: 1 };
    expect(getProblems(target)).toEqual([]);
  });

  it('reports a wrong comment count', () => {
    const target = makeTarget();
    target.posts[0] = { ...target.posts[0], commentCount: 0 };
    expect(getProblems(target)).toContainEqual(expect.stringMatching(/comment count is 0, expected 4/));
  });

  it('accepts records that were unpublished after their topic became private', () => {
    const target = makeTarget();
    target.posts.push({ ...target.posts[0], _id: "post20", discourseTopicId: "20", title: "Staff notes", draft: true });
    target.comments.push({ ...target.comments[0], _id: "c300", discoursePostId: "300", deleted: true });
    expect(getProblems(target)).toEqual([]);
  });

  it('expects a reply to a deleted post to be a top-level comment', () => {
    const source = makeSource();
    // #3 replied to #2, which was deleted in Discourse
    source.posts = source.posts.filter(p => p.id !== 101);
    const target = makeTarget();
    target.comments = target.comments
      .filter(c => c._id !== "c101")
      .map(c => c._id === "c102" ? { ...c, parentCommentId: null, topLevelCommentId: null }
        : c._id === "c103" ? { ...c, topLevelCommentId: "c102" } : c);
    target.posts[0] = { ...target.posts[0], commentCount: 3 };
    expect(getProblems(target, source)).toEqual([]);
  });
});

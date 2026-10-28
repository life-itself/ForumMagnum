import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  deleteComment,
  deletePost,
  expectCleanPage,
  getCurrentUserId,
  getOwnCommentIds,
  getSmokeAccount,
  getTestPostId,
  login,
  visible,
  watchPage,
} from "./smokeUtils";

// Account flows, run as the test account (SMOKE_USERNAME, SMOKE_PASSWORD).
// Nothing reaches the feed: drafts stay drafts and are deleted, and comments
// and votes go on an unlisted test post (SMOKE_TEST_POST_ID) and are removed
// afterwards.

const account = getSmokeAccount();
test.skip(!account, "Set SMOKE_USERNAME and SMOKE_PASSWORD to run the account tests");

const runId = () => `${Date.now()}`;

/** The test post whose comments by the test account are deleted after each test */
let commentCleanup: { postId: string, userId: string } | null = null;

// A hook gets its own time budget, so cleanup still runs after a test times out
test.afterEach(async ({ context }) => {
  if (!commentCleanup) return;
  const { postId, userId } = commentCleanup;
  commentCleanup = null;
  for (const commentId of await getOwnCommentIds(context, postId, userId)) {
    await deleteComment(context, commentId);
  }
});

async function fillPostEditor(page: Page, { title, body }: { title?: string, body?: string }) {
  if (title) {
    await page.getByPlaceholder("Post title").fill("");
    await page.getByPlaceholder("Post title").fill(title);
  }
  if (body) {
    const editor = page.locator('#postContent [contenteditable="true"], .EditorFormComponent-root [contenteditable="true"]').first();
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(body);
    await expect(editor).toContainText(body);
  }
}

/**
 * Accounts a moderator hasn't reviewed see a guidelines dialog when they first
 * focus a comment or post editor. Acknowledging it is saved in the background,
 * so the dialog can reopen once before that lands.
 */
async function dismissNewUserDialog(page: Page) {
  const understood = page.getByText("I have read and understood", { exact: false });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await understood.waitFor({ state: "visible", timeout: 3000 });
    } catch {
      return;
    }
    await understood.click();
    await understood.waitFor({ state: "hidden" });
  }
}

/** Types into a comment form, dismissing the new-user dialog that opens on focus */
async function writeComment(page: Page, form: Locator, text: string) {
  const editor = form.getByRole("textbox");
  await editor.click();
  await dismissNewUserDialog(page);
  await editor.click();
  await page.keyboard.type(text);
  await expect(editor).toContainText(text);
  // Low-karma accounts must wait a few seconds between comments, so retry
  // until the form clears, which means the comment was posted
  for (let attempt = 0; attempt < 4; attempt++) {
    await form.getByRole("button", { name: "Submit" }).click();
    try {
      await expect(editor).not.toContainText(text, { timeout: 4000 });
      return;
    } catch {
      await page.waitForTimeout(6000);
    }
  }
  throw new Error(`Couldn't post the comment "${text}"`);
}

/** "Save Draft" is in the editor's publish panel, which may need opening first */
async function saveDraft(page: Page) {
  const save = page.getByRole("button", { name: /save (as )?draft/i }).and(page.locator("*:visible")).first();
  if (!(await save.isVisible())) await visible(page, ".PostForm-publishIconButton").click();
  await save.click();
}

test("log in", async ({ page, context }) => {
  await login(context, account!);
  const watcher = watchPage(page);
  await page.goto("/");
  await expect(visible(page, ".UsersMenu-userButtonRoot, .UsersMenu-root")).toBeVisible();
  await expect(page.getByRole("button", { name: /^login$/i })).toHaveCount(0);
  expectCleanPage(watcher);
});

test("create, edit and delete a draft", async ({ page, context }) => {
  await login(context, account!);
  const id = runId();
  let postId: string | null = null;
  try {
    await page.goto("/newPost");
    await page.waitForURL(/\/editPost\?postId=/);
    postId = new URL(page.url()).searchParams.get("postId");
    await fillPostEditor(page, { title: `Smoke test draft ${id}`, body: `Draft body ${id}` });
    await saveDraft(page);
    await dismissNewUserDialog(page);
    await expect(page.getByText(/saved/i).first()).toBeVisible();

    await page.goto(`/editPost?postId=${postId}`);
    await expect(page.getByPlaceholder("Post title")).toHaveValue(`Smoke test draft ${id}`);
    await fillPostEditor(page, { body: `Edited draft body ${id}` });
    await saveDraft(page);

    await page.goto(`/editPost?postId=${postId}`);
    await expect(page.getByText(`Edited draft body ${id}`)).toBeVisible();
  } finally {
    if (postId) await deletePost(context, postId);
  }
});

test("comment, reply and vote", async ({ page, context }) => {
  const testPostId = getTestPostId();
  test.skip(!testPostId, "Set SMOKE_TEST_POST_ID to an unlisted post to run the comment and vote test");
  await login(context, account!);
  const id = runId();
  commentCleanup = { postId: testPostId!, userId: await getCurrentUserId(context) };
  const watcher = watchPage(page);
  await page.goto(`/posts/${testPostId}`);
  await expect(page.locator(".CommentsNewForm-root").first(), "the test post (SMOKE_TEST_POST_ID) should be viewable by the test account").toBeVisible();

  // Comment
  const comment = `Smoke test comment ${id}`;
  await writeComment(page, page.locator(".CommentsNewForm-root").first(), comment);
  const commentItem = page.locator(".CommentsItem-root").filter({ hasText: comment }).first();
  await expect(commentItem).toBeVisible();

  // Reply
  const reply = `Smoke test reply ${id}`;
  await commentItem.getByText("Reply", { exact: true }).first().click();
  await writeComment(page, page.locator(".CommentsNewForm-root:visible").last(), reply);
  await expect(page.locator(".CommentsItem-root").filter({ hasText: reply }).first()).toBeVisible();

  // Vote on the post, then take the vote back
  const score = visible(page, ".LWPostsPageTopHeaderVote-voteScore");
  const before = (await score.innerText()).trim();
  const upvote = visible(page, ".LWPostsPageTopHeaderVote-upvoteHorizontal button");
  await upvote.click();
  await expect(score).not.toHaveText(before);
  await upvote.click();
  await expect(score).toHaveText(before);

  expectCleanPage(watcher);
});

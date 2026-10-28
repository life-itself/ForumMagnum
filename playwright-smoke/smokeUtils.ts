import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/**
 * Content these tests rely on. It's migrated Discourse content, so it's
 * stable; update it if it changes.
 */
export const KNOWN = {
  /** A post with an image moved to Cloudinary */
  postWithImagePath: "/posts/xRrd4khvP6Az2kyCd/second-renaissance-ecosystem-map",
  postWithImageTitle: "Second Renaissance Ecosystem Map",
  /** Discourse topic 5, "First Steps for New Members" */
  oldTopicPath: "/t/first-steps-for-new-members/5",
  newTopicPathPrefix: "/posts/KWhJhb9QpCimoEj7i/",
  /** Reply #12 in topic 71 (the Ecosystem Map) */
  oldReplyPath: "/t/second-renaissance-ecosystem-map/71/12",
  oldCategoryPath: "/c/general/4",
  tagPath: "/w/general",
  tagName: "General",
  /** Bob's Discourse profile; his history is on the rbunge account */
  oldProfilePath: "/u/robertbunge",
  oldUploadPath: "/uploads/db6903/original/1X/1fd5eb10318e1b7ef220281f4d617ac4d9be5793.png",
  searchTerm: "oasis",
};

/**
 * Hosts the forum must not contact: LessWrong's own services and third-party
 * accounts (#23). LessWrong's public ET Book font file on its Cloudinary
 * account is allowed; upstream loads it for every deployment.
 */
const BLOCKED_HOSTS = [
  "lesswrong.com",
  "lesserwrong.com",
  "alignmentforum.org",
  "effectivealtruism.org",
  "use.typekit.net",
  "intercom.io",
  "intercomcdn.com",
  "logrocket",
  "recombee",
  "mapbox",
  "stripe.com",
];

/**
 * Console errors that aren't failures: React recovers from hydration
 * mismatches (upstream LessWrong logs them too), and the rest are browser
 * noise.
 */
const IGNORED_CONSOLE_ERRORS = [
  /Hydration failed|hydrat/i,
  /Minified React error #(418|423|425)/,
  /requestStorageAccess/,
  /Download the React DevTools/,
  /favicon/,
];

export interface PageWatcher {
  consoleErrors: string[]
  blockedRequests: string[]
}

/** Records console errors and requests to blocked hosts while a page is used */
export function watchPage(page: Page): PageWatcher {
  const watcher: PageWatcher = { consoleErrors: [], blockedRequests: [] };
  const recordError = (text: string) => {
    if (!IGNORED_CONSOLE_ERRORS.some(pattern => pattern.test(text))) watcher.consoleErrors.push(text);
  };
  page.on("console", message => {
    if (message.type() === "error") recordError(message.text());
  });
  page.on("pageerror", error => recordError(error.message));
  page.on("request", request => {
    const { hostname } = new URL(request.url());
    if (BLOCKED_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`) || hostname.includes(host))) {
      watcher.blockedRequests.push(request.url());
    }
  });
  return watcher;
}

export function expectCleanPage(watcher: PageWatcher) {
  expect(watcher.blockedRequests, "requests to LessWrong or third-party services").toEqual([]);
  expect(watcher.consoleErrors, "console errors").toEqual([]);
}

/** Visible element matching the locator (ignores hidden duplicates kept for client navigation) */
export function visible(page: Page, selector: string) {
  const visibleSelector = selector.split(",").map(part => `${part.trim()}:visible`).join(", ");
  return page.locator(visibleSelector).first();
}

export interface SmokeAccount {
  username: string
  password: string
}

/** The test account, or null when SMOKE_USERNAME and SMOKE_PASSWORD aren't set */
export function getSmokeAccount(): SmokeAccount | null {
  const username = process.env.SMOKE_USERNAME;
  const password = process.env.SMOKE_PASSWORD;
  return username && password ? { username, password } : null;
}

async function graphql<T>(request: APIRequestContext, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await request.post("/graphql", { data: { query, variables }, headers: { "content-type": "application/json" } });
  const body: { data?: T, errors?: Array<{ message?: string }> } = await response.json();
  if (body.errors?.length || !body.data) {
    throw new Error(`GraphQL error: ${body.errors?.map(e => e.message).join(", ") ?? "no data"}`);
  }
  return body.data;
}

/** Logs the browser context in as the test account (the same way upstream's suite does) */
export async function login(context: BrowserContext, account: SmokeAccount): Promise<void> {
  const data = await graphql<{ login: { token: string | null } | null }>(context.request, `
    mutation SmokeLogin($username: String, $password: String) {
      login(username: $username, password: $password) { token }
    }
  `, { username: account.username, password: account.password });
  const token = data.login?.token;
  if (!token) throw new Error("Smoke test login failed: check SMOKE_USERNAME and SMOKE_PASSWORD");
  const origin = new URL(process.env.SMOKE_BASE_URL ?? "https://forum.seedsofrenaissance.org").origin;
  await context.addCookies([{ name: "loginToken", value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
}

/**
 * An unlisted post an admin created for these tests (SMOKE_TEST_POST_ID), or
 * null. Members can't create unlisted posts, and comments on a listed post
 * would show in everyone's feed.
 */
export function getTestPostId(): string | null {
  return process.env.SMOKE_TEST_POST_ID || null;
}

/** Deletes a post (a draft, or a published post, which becomes a deleted draft) */
export async function deletePost(context: BrowserContext, postId: string): Promise<void> {
  await graphql(context.request, `
    mutation SmokeDeletePost($id: String!) {
      updatePost(selector: { _id: $id }, data: { draft: true, deletedDraft: true }) { data { _id } }
    }
  `, { id: postId });
}

/** Deletes a comment the test account wrote */
export async function deleteComment(context: BrowserContext, commentId: string): Promise<void> {
  await graphql(context.request, `
    mutation SmokeDeleteComment($id: String!) {
      updateComment(selector: { _id: $id }, data: { deleted: true, deletedPublic: false, deletedReason: "Automated smoke test" }) { data { _id } }
    }
  `, { id: commentId });
}

/** IDs of the test account's comments on a post, newest first */
export async function getOwnCommentIds(context: BrowserContext, postId: string, userId: string): Promise<string[]> {
  const data = await graphql<{ comments: { results: Array<{ _id: string, userId: string }> } }>(context.request, `
    query SmokeComments($postId: String) {
      comments(selector: { postCommentsNew: { postId: $postId } }, limit: 50) { results { _id userId } }
    }
  `, { postId });
  return data.comments.results.filter(c => c.userId === userId).map(c => c._id);
}

export async function getCurrentUserId(context: BrowserContext): Promise<string> {
  const data = await graphql<{ currentUser: { _id: string } | null }>(context.request, `query SmokeCurrentUser { currentUser { _id } }`, {});
  if (!data.currentUser) throw new Error("Not logged in");
  return data.currentUser._id;
}

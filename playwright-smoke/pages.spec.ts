import { test, expect } from "@playwright/test";
import { KNOWN, expectCleanPage, watchPage } from "./smokeUtils";

// Read-only: public pages load, show their content, make no requests to
// LessWrong or third-party services, and log no console errors.

test("home page lists posts", async ({ page }) => {
  const watcher = watchPage(page);
  await page.goto("/");
  await expect(page).toHaveTitle(/Seeds of Renaissance/);
  await expect(page.locator(".LWPostsItem-root:visible")).not.toHaveCount(0);
  expectCleanPage(watcher);
});

test("a post page shows its text and its image from Cloudinary", async ({ page }) => {
  const watcher = watchPage(page);
  await page.goto(KNOWN.postWithImagePath);
  await expect(page).toHaveTitle(new RegExp(KNOWN.postWithImageTitle));
  await expect(page.getByRole("heading", { name: KNOWN.postWithImageTitle }).first()).toBeVisible();
  const image = page.locator("#postContent img").first();
  await expect(image).toHaveAttribute("src", /res\.cloudinary\.com/);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Leftover Discourse lightbox captions mean a stale cached copy of the post
  await expect(page.locator("#postContent")).not.toContainText("KB");
  expectCleanPage(watcher);
});

test("All Posts lists posts", async ({ page }) => {
  const watcher = watchPage(page);
  await page.goto("/allPosts");
  await expect(page.locator(".LWPostsItem-root:visible")).not.toHaveCount(0);
  expectCleanPage(watcher);
});

test("Concepts and a tag page load", async ({ page }) => {
  const watcher = watchPage(page);
  await page.goto("/wikitags");
  await expect(page.getByText(KNOWN.tagName, { exact: true }).first()).toBeVisible();
  await page.goto(KNOWN.tagPath);
  await expect(page).toHaveTitle(new RegExp(KNOWN.tagName));
  await expect(page.locator(".LWPostsItem-root:visible")).not.toHaveCount(0);
  expectCleanPage(watcher);
});

for (const [path, text] of [
  ["/about", "Seeds of Renaissance and the Second Renaissance"],
  ["/faq", "Ground rules"],
  ["/contact", "support@nextwavedev.org"],
] as const) {
  test(`${path} shows its content`, async ({ page }) => {
    const watcher = watchPage(page);
    await page.goto(path);
    await expect(page.getByText(text).first()).toBeVisible();
    expectCleanPage(watcher);
  });
}

test("the login form is available", async ({ page }) => {
  const watcher = watchPage(page);
  await page.goto("/login");
  await expect(page.getByText("Reset Password", { exact: true }).first()).toBeVisible();
  expectCleanPage(watcher);
});

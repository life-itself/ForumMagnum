import { test, expect, type APIRequestContext } from "@playwright/test";
import { KNOWN } from "./smokeUtils";

// Read-only: links to the old Discourse forum redirect to the matching page
// (#51). Checks the redirect itself, so it also works before the old domain
// points here.

async function redirectTarget(request: APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0 });
  expect(response.status(), `${path} should redirect permanently`).toBe(308);
  return response.headers()["location"] ?? "";
}

test("an old topic link goes to its post", async ({ request }) => {
  expect(await redirectTarget(request, KNOWN.oldTopicPath)).toContain(KNOWN.newTopicPathPrefix);
});

test("an old reply link goes to its comment", async ({ request }) => {
  expect(await redirectTarget(request, KNOWN.oldReplyPath)).toMatch(/\/posts\/[^?]+\?commentId=/);
});

test("an old category link goes to its tag", async ({ request }) => {
  expect(await redirectTarget(request, KNOWN.oldCategoryPath)).toContain(KNOWN.tagPath);
});

test("an old upload link goes to Cloudinary", async ({ request }) => {
  expect(await redirectTarget(request, KNOWN.oldUploadPath)).toContain("res.cloudinary.com");
});

test("an unknown old topic goes to the home page", async ({ request }) => {
  expect(new URL(await redirectTarget(request, "/t/not-a-topic/999999")).pathname).toBe("/");
});

test("an old profile link reaches the member's profile", async ({ page }) => {
  await page.goto(KNOWN.oldProfilePath);
  await expect(page).toHaveURL(/\/users\//);
  await expect(page).not.toHaveTitle(/not found/i);
});

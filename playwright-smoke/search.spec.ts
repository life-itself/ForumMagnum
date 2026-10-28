import { test, expect } from "@playwright/test";
import { KNOWN, expectCleanPage, watchPage } from "./smokeUtils";

// Read-only: Elasticsearch search works for posts and tags.

test("search finds posts", async ({ page }) => {
  const watcher = watchPage(page);
  await page.goto(`/search?query=${KNOWN.searchTerm}`);
  await expect(page.getByText(/\d+ results?/).first()).toBeVisible();
  await expect(page.locator("a[href*='/posts/']").filter({ hasText: new RegExp(KNOWN.searchTerm, "i") }).first()).toBeVisible();
  expectCleanPage(watcher);
});

test("search finds tags", async ({ page }) => {
  const watcher = watchPage(page);
  await page.goto(`/search?query=${KNOWN.tagName}`);
  await page.getByText("Wikitags", { exact: true }).first().click();
  await expect(page.locator("a[href*='/w/']").filter({ hasText: KNOWN.tagName }).first()).toBeVisible();
  expectCleanPage(watcher);
});

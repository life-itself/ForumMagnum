import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests for a deployed Seeds of Renaissance forum (issue #37). Unlike
 * the upstream suite in playwright/, these run against a live deployment, not
 * a local test database, so they only read public pages, plus (when
 * SMOKE_USERNAME and SMOKE_PASSWORD are set) a few account flows that clean
 * up after themselves. See playwright-smoke/README.md.
 *
 * yarn smoke-test                                   # against forum.seedsofrenaissance.org
 * SMOKE_BASE_URL=http://localhost:3456 yarn smoke-test
 */
export default defineConfig({
  testDir: "./playwright-smoke",
  // One page at a time, so a run doesn't load the live site
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? "https://forum.seedsofrenaissance.org",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

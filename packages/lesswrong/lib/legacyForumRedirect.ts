/**
 * Redirects requests on the old Second Renaissance Discourse forum's hostnames
 * (LEGACY_FORUM_HOSTNAMES, e.g. forum.secondrenaissance.net) to this forum
 * (#51). Used by middleware.ts, so it must not import anything that pulls in
 * lodash.
 *
 * Old topic, reply, category, profile and upload links keep their path; the
 * routes under app/t, app/c, app/u and app/uploads then send them to the
 * matching page. Pages with an equivalent here map to it, and Discourse-only
 * pages (/latest, /categories, ...) go to the home page.
 */

/**
 * The old forum's service worker scripts. Browsers ignore a redirected service
 * worker script, so these are answered with public/service-worker.js, which
 * removes the old worker, instead of being redirected.
 */
export const LEGACY_SERVICE_WORKER_PATH = /^\/service-worker[\w.-]*\.js$/;

const KEPT_PATHS = [/^\/t\//, /^\/c\//, /^\/u\//, /^\/uploads\//, /^\/about\/?$/, /^\/faq\/?$/];

const RENAMED_PATHS: Record<string, string> = {
  "/guidelines": "/faq",
};

export function parseLegacyHostnames(value: string | undefined): string[] {
  return (value ?? "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
}

/** The URL on this forum for a request to an old forum hostname, or null for any other request */
export function isLegacyHostname(requestHostname: string, legacyHostnames: string[]): boolean {
  return legacyHostnames.includes(requestHostname.toLowerCase());
}

export function getLegacyForumRedirectUrl(requestUrl: URL, requestHostname: string, legacyHostnames: string[], siteUrl: string): string | null {
  if (!siteUrl || !isLegacyHostname(requestHostname, legacyHostnames)) return null;
  if (LEGACY_SERVICE_WORKER_PATH.test(requestUrl.pathname)) return null;
  const target = new URL(siteUrl);
  const { pathname, search, searchParams } = requestUrl;
  if (KEPT_PATHS.some(pattern => pattern.test(pathname))) {
    target.pathname = pathname;
    target.search = search;
  } else if (pathname === "/search" && searchParams.get("q")) {
    target.pathname = "/search";
    target.searchParams.set("query", searchParams.get("q")!);
  } else {
    target.pathname = RENAMED_PATHS[pathname.replace(/\/$/, "")] ?? "/";
  }
  return target.toString();
}

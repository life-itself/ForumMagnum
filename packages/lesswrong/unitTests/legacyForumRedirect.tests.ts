import { getLegacyForumRedirectUrl, parseLegacyHostnames } from '../lib/legacyForumRedirect';

const legacyHosts = parseLegacyHostnames(" forum.secondrenaissance.net, Forum.LifeItself.org ");
const site = "https://forum.seedsofrenaissance.org";
const redirect = (url: string) => {
  const parsed = new URL(url);
  return getLegacyForumRedirectUrl(parsed, parsed.hostname, legacyHosts, site);
};

describe('getLegacyForumRedirectUrl', () => {
  it('leaves requests on other hostnames alone', () => {
    expect(redirect("https://forum.seedsofrenaissance.org/t/some-topic/5")).toBeNull();
  });

  it('keeps the path of old topic, category, profile and upload links', () => {
    expect(redirect("https://forum.secondrenaissance.net/t/some-topic/5/3")).toBe(`${site}/t/some-topic/5/3`);
    expect(redirect("https://forum.lifeitself.org/c/general/4")).toBe(`${site}/c/general/4`);
    expect(redirect("https://forum.secondrenaissance.net/u/robertbunge")).toBe(`${site}/u/robertbunge`);
    expect(redirect("https://forum.secondrenaissance.net/uploads/db6903/original/1X/ab.png")).toBe(`${site}/uploads/db6903/original/1X/ab.png`);
    expect(redirect("https://forum.secondrenaissance.net/t/5?u=bob")).toBe(`${site}/t/5?u=bob`);
  });

  it('maps pages with an equivalent here', () => {
    expect(redirect("https://forum.secondrenaissance.net/about")).toBe(`${site}/about`);
    expect(redirect("https://forum.secondrenaissance.net/guidelines")).toBe(`${site}/faq`);
    expect(redirect("https://forum.secondrenaissance.net/search?q=oasis")).toBe(`${site}/search?query=oasis`);
  });

  it('sends everything else to the home page', () => {
    expect(redirect("https://forum.secondrenaissance.net/")).toBe(`${site}/`);
    expect(redirect("https://forum.lifeitself.org/latest")).toBe(`${site}/`);
    expect(redirect("https://forum.secondrenaissance.net/my/preferences")).toBe(`${site}/`);
  });

  it("doesn't redirect the old forum's service worker scripts", () => {
    expect(redirect("https://forum.secondrenaissance.net/service-worker.js")).toBeNull();
    expect(redirect("https://forum.secondrenaissance.net/service-worker-1a2b3c.js")).toBeNull();
  });

  it('does nothing without a site URL', () => {
    const url = new URL("https://forum.secondrenaissance.net/");
    expect(getLegacyForumRedirectUrl(url, url.hostname, legacyHosts, "")).toBeNull();
  });
});

import { base62Sha1, discourseUploadPath, findDiscourseUploadPaths } from '../scripts/secondRenaissanceDiscourseUploads';

describe('secondRenaissanceDiscourseUploads', () => {
  it('encodes a SHA-1 the way Discourse short URLs do', () => {
    expect(base62Sha1("0000000000000000000000000000000000000001")).toBe("1");
    expect(base62Sha1("000000000000000000000000000000000000003e")).toBe("10");
    expect(base62Sha1("000000000000000000000000000000000000003d")).toBe("Z");
  });

  it('finds upload links in Discourse HTML', () => {
    expect(findDiscourseUploadPaths('<a href="https://forum.secondrenaissance.net/uploads/db6903/original/1X/ab.png?dl=1"><img src="/uploads/short-url/xyz.pdf"></a> <a href="https://example.com/uploads/x.png">x</a>'))
      .toEqual(["/uploads/db6903/original/1X/ab.png", "/uploads/short-url/xyz.pdf"]);
  });

  it('ignores links that are not uploads', () => {
    expect(discourseUploadPath("https://forum.secondrenaissance.net/t/topic/12")).toBeNull();
    expect(discourseUploadPath("/uploads/db6903/original/1X/ab.png#top")).toBe("/uploads/db6903/original/1X/ab.png");
  });
});

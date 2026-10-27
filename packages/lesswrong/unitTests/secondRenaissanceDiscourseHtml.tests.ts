import {
  cleanDiscourseHtml,
  type DiscourseLinkTargets,
} from '../scripts/secondRenaissanceDiscourseHtml';
import { emojiForDiscourseName, replaceEmojiCodes } from '../scripts/secondRenaissanceDiscourseEmoji';

const targets: DiscourseLinkTargets = {
  userPathsByUsername: new Map([["martin", "/users/discourse-import-user-13"]]),
  postPathsByTopicId: new Map([[752, "/posts/abc123/the-meaning-of-life"]]),
  uploadUrlsByPath: new Map([
    ["/uploads/db6903/original/1X/43a3.png", "https://res.cloudinary.com/seeds/image/upload/43a3.png"],
    ["/uploads/short-url/5vpxF7U7.pdf", "https://res.cloudinary.com/seeds/raw/upload/report.pdf"],
  ]),
};

const clean = (html: string) => cleanDiscourseHtml(html, targets);

describe('emojiForDiscourseName', () => {
  it('maps gemoji aliases, Unicode names and skin tones', () => {
    expect(emojiForDiscourseName(":+1:")).toBe("👍");
    expect(emojiForDiscourseName(":folded_hands:")).toBe("🙏");
    expect(emojiForDiscourseName(":wave:t2:")).toBe("👋");
    expect(emojiForDiscourseName(":slight_smile:")).toBe("🙂");
  });

  it('keeps unknown names as text', () => {
    expect(emojiForDiscourseName(":not_an_emoji:")).toBe(":not_an_emoji:");
  });

  it('replaces emoji codes in titles', () => {
    expect(replaceEmojiCodes("First Steps for New Members :wave:")).toBe("First Steps for New Members 👋");
    expect(replaceEmojiCodes("Collabothon :wave: 4th April")).toBe("Collabothon 👋 4th April");
    expect(replaceEmojiCodes("Meeting at 10:30: agenda")).toBe("Meeting at 10:30: agenda");
  });
});

describe('cleanDiscourseHtml', () => {
  it('replaces emoji images with emoji', () => {
    expect(clean('<p>Well done <img src="https://forum.secondrenaissance.net/images/emoji/apple/trophy.png?v=12" title=":trophy:" class="emoji" alt=":trophy:" width="20" height="20"></p>'))
      .toBe("<p>Well done 🏆</p>");
  });

  it('points uploaded images and attachments at Cloudinary', () => {
    const html = clean('<p><img src="https://forum.secondrenaissance.net/uploads/db6903/original/1X/43a3.png" srcset="https://forum.secondrenaissance.net/uploads/db6903/optimized/1X/43a3_2_566x500.png 1.5x" alt="Map"> <a class="attachment" href="/uploads/short-url/5vpxF7U7.pdf">report.pdf</a></p>');
    expect(html).toContain('src="https://res.cloudinary.com/seeds/image/upload/43a3.png"');
    expect(html).not.toContain("srcset");
    expect(html).toContain('href="https://res.cloudinary.com/seeds/raw/upload/report.pdf"');
  });

  it('replaces a lightbox with the full-size image and drops its caption', () => {
    const html = clean(`<p><div class="lightbox-wrapper"><a class="lightbox" href="https://forum.secondrenaissance.net/uploads/db6903/original/1X/43a3.png" title="Screenshot"><img src="https://forum.secondrenaissance.net/uploads/db6903/optimized/1X/43a3_2_566x500.png" alt="Screenshot" width="566" height="500"><div class="meta"><span class="filename">image</span><span class="informations">1920×1092 149 KB</span></div></a></div></p>`);
    expect(html).toContain('src="https://res.cloudinary.com/seeds/image/upload/43a3.png"');
    expect(html).not.toContain("149 KB");
    expect(html).not.toContain("lightbox");
  });

  it('replaces a link preview with a plain link', () => {
    expect(clean(`<aside class="onebox allowlistedgeneric" data-onebox-src="https://www.memenomics.com/second-sapiens">
      <header class="source"><img src="https://forum.secondrenaissance.net/uploads/icon.png" class="site-icon" width="32" height="32"><a href="https://www.memenomics.com/second-sapiens">memenomics.com</a></header>
      <article class="onebox-body"><h3><a href="https://www.memenomics.com/second-sapiens">Second Sapiens</a></h3><p>A long description</p></article>
    </aside>`)).toBe('<p><a href="https://www.memenomics.com/second-sapiens">Second Sapiens</a></p>');
  });

  it('replaces a YouTube embed with a link', () => {
    expect(clean('<div class="lazy-video-container" data-video-id="abc123" data-video-title="A talk" data-provider-name="youtube"><a href="https://www.youtube.com/watch?v=abc123"><img src="x.jpg"></a></div>'))
      .toBe('<p><a href="https://www.youtube.com/watch?v=abc123">A talk</a></p>');
  });

  it('replaces a quote box with a blockquote naming the author', () => {
    const html = clean(`<aside class="quote no-group" data-username="RobertBunge" data-post="7" data-topic="752">
      <div class="title"><div class="quote-controls"></div><img alt="" width="24" height="24" src="https://forum.secondrenaissance.net/user_avatar/robertbunge/48/111_2.png" class="avatar"> RobertBunge:</div>
      <blockquote><p>planetary carrying capacity</p></blockquote>
    </aside><p>yep…</p>`);
    expect(html).toMatch(/^<blockquote>\s*<p><strong>RobertBunge:<\/strong><\/p>\s*<p>planetary carrying capacity<\/p>\s*<\/blockquote>/);
    expect(html).not.toContain("avatar");
    expect(html).toContain("<p>yep…</p>");
  });

  it('points mentions and topic links at forum pages', () => {
    expect(clean('<p><a class="mention" href="/u/martin">@Martin</a> see <a href="https://forum.secondrenaissance.net/t/the-meaning-of-life/752/3">this</a></p>'))
      .toBe('<p><a href="/users/discourse-import-user-13">@Martin</a> see <a href="/posts/abc123/the-meaning-of-life">this</a></p>');
  });

  it('turns mentions of unknown users into text and makes other links absolute', () => {
    expect(clean('<p><a class="mention" href="/u/nobody">@nobody</a> <a href="/c/general/4">General</a></p>'))
      .toBe('<p>@nobody <a href="https://forum.secondrenaissance.net/c/general/4">General</a></p>');
  });

  it('removes empty paragraphs', () => {
    expect(clean("<p>One</p><p> </p><div></div><p>Two</p>")).toBe("<p>One</p><p>Two</p>");
  });
});

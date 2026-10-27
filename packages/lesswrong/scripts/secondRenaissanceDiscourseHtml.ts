import type { CheerioAPI } from "cheerio";
import { cheerioParse } from "@/server/utils/htmlUtil";
import { sanitize } from "@/lib/utils/sanitize";
import { emojiForDiscourseName } from "./secondRenaissanceDiscourseEmoji";

/**
 * Converts Discourse-rendered ("cooked") HTML into clean HTML for the forum
 * (issue #41). Discourse markup relies on Discourse's own CSS, so without it
 * emoji render at full size, image lightboxes show their file metadata, and
 * link previews and quotes become unstyled blocks.
 */

export const DISCOURSE_ORIGIN = "https://forum.secondrenaissance.net";

export interface DiscourseLinkTargets {
  /** Forum profile path for each Discourse username (lowercased) */
  userPathsByUsername: Map<string, string>
  /** Forum post path for each migrated Discourse topic */
  postPathsByTopicId: Map<number, string>
  /** Cloudinary URL for each uploaded file, by its /uploads/... path (see secondRenaissanceDiscourseUploads) */
  uploadUrlsByPath: Map<string, string>
}

const TOPIC_PATH = /^\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?\/?(?:[?#].*)?$/;
const USER_PATH = /^\/u\/([^/?#]+)/;

/** Points a Discourse URL at the matching forum page, or makes it absolute */
function rewriteUrl(url: string, targets: DiscourseLinkTargets): string {
  const path = url.startsWith(DISCOURSE_ORIGIN) ? url.slice(DISCOURSE_ORIGIN.length) : url;
  if (!path.startsWith("/") || path.startsWith("//")) return url;
  const uploadUrl = path.startsWith("/uploads/") && targets.uploadUrlsByPath.get(path.split(/[?#]/)[0]);
  if (uploadUrl) return uploadUrl;
  const topicMatch = TOPIC_PATH.exec(path);
  const topicPath = topicMatch && targets.postPathsByTopicId.get(Number(topicMatch[1]));
  if (topicPath) return topicPath;
  const userMatch = USER_PATH.exec(path);
  const userPath = userMatch && targets.userPathsByUsername.get(decodeURIComponent(userMatch[1]).toLowerCase());
  if (userPath) return userPath;
  return `${DISCOURSE_ORIGIN}${path}`;
}

function replaceEmoji($: CheerioAPI): void {
  $("img.emoji").each((_, img) => {
    $(img).replaceWith(emojiForDiscourseName($(img).attr("alt") ?? ""));
  });
}

/** A lightbox becomes the full-size image, without the "image1920×1092 149 KB" caption */
function replaceLightboxes($: CheerioAPI): void {
  $("div.lightbox-wrapper").each((_, wrapper) => {
    const link = $(wrapper).find("a.lightbox").first();
    const img = $(wrapper).find("img").first();
    const src = link.attr("href") ?? img.attr("src");
    if (!src) {
      $(wrapper).remove();
      return;
    }
    $(wrapper).replaceWith($("<img>").attr("src", src).attr("alt", img.attr("alt") ?? ""));
  });
}

/** A link preview becomes a plain link with the page title */
function replaceOneboxes($: CheerioAPI): void {
  $("aside.onebox").each((_, aside) => {
    const box = $(aside);
    const href = box.attr("data-onebox-src") ?? box.find("a[href]").first().attr("href");
    if (!href) {
      box.remove();
      return;
    }
    const title = box.find("h3 a, h4 a").first().text().trim() || href;
    box.replaceWith($("<p>").append($("<a>").attr("href", href).text(title)));
  });
  $("div.lazy-video-container").each((_, video) => {
    const box = $(video);
    const videoId = box.attr("data-video-id");
    const href = box.attr("data-provider-name") === "youtube" && videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : box.find("a[href]").first().attr("href");
    const title = box.attr("data-video-title") || href;
    if (!href) {
      box.remove();
      return;
    }
    box.replaceWith($("<p>").append($("<a>").attr("href", href).text(title ?? href)));
  });
}

/** A quote box becomes a blockquote starting with "Name:", without the avatar */
function replaceQuotes($: CheerioAPI): void {
  // Innermost quotes first, so nested quotes are already converted
  const quotes = $("aside.quote").toArray().reverse();
  for (const aside of quotes) {
    const box = $(aside);
    const author = box.children(".title").text().trim().replace(/:$/, "") || box.attr("data-username");
    const blockquote = box.children("blockquote").first();
    const quote = $("<blockquote>");
    if (author) quote.append($("<p>").append($("<strong>").text(`${author}:`)));
    quote.append(blockquote.length ? blockquote.contents() : box.contents());
    box.replaceWith(quote);
  }
}

function rewriteLinks($: CheerioAPI, targets: DiscourseLinkTargets): void {
  $("a[href]").each((_, a) => {
    const link = $(a);
    const href = rewriteUrl(link.attr("href")!, targets);
    if (link.is(".mention, .mention-group")) {
      // Mentions of people without a forum profile become plain text
      if (href.startsWith(DISCOURSE_ORIGIN)) {
        link.replaceWith(link.text());
        return;
      }
      link.removeAttr("class");
    }
    link.attr("href", href);
  });
  $("img[src]").each((_, img) => {
    // srcset only lists other sizes on the Discourse server
    $(img).attr("src", rewriteUrl($(img).attr("src")!, targets)).removeAttr("srcset");
  });
}

/** Discourse leaves empty paragraphs and wrappers that add vertical gaps */
function removeEmptyBlocks($: CheerioAPI): void {
  $("p, div").each((_, block) => {
    const el = $(block);
    if (!el.text().trim() && !el.find("img, iframe, video").length) el.remove();
  });
}

export function cleanDiscourseHtml(cooked: string, targets: DiscourseLinkTargets): string {
  const $ = cheerioParse(cooked);
  replaceEmoji($);
  replaceLightboxes($);
  replaceOneboxes($);
  replaceQuotes($);
  rewriteLinks($, targets);
  removeEmptyBlocks($);
  return sanitize($.html()).trim();
}

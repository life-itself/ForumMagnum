import emojiList from "@/components/lexical/utils/emoji-list";

/**
 * Discourse emoji codes (":wave:") as Unicode emoji, for the Second
 * Renaissance Discourse import. Discourse renders them as images in post HTML
 * and leaves them as codes in topic titles.
 */

// Discourse emoji names that the gemoji list doesn't include
const EXTRA_EMOJI: Record<string, string> = {
  china: "🇨🇳",
  face_with_peeking_eye: "🫣",
  lotus: "🪷",
  nerd: "🤓",
  slight_smile: "🙂",
  united_kingdom: "🇬🇧",
  united_states: "🇺🇸",
};

const toEmojiName = (description: string) => description.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Discourse uses gemoji aliases (":+1:") and Unicode names (":folded_hands:")
const EMOJI_BY_NAME = new Map<string, string>([
  ...emojiList.map((e): [string, string] => [toEmojiName(e.description), e.emoji]),
  ...emojiList.flatMap(e => e.aliases.map((alias): [string, string] => [alias, e.emoji])),
  ...Object.entries(EXTRA_EMOJI),
]);

/** ":thumbsup:" or ":thumbsup:t2:" (skin tone) -> "👍"; unknown names keep their text */
export function emojiForDiscourseName(alt: string): string {
  const name = alt.replace(/^:|:$/g, "").replace(/:t\d$/, "");
  return EMOJI_BY_NAME.get(name) ?? alt;
}

const EMOJI_CODE = /:([a-z0-9_+-]+)(?::t\d)?:/g;

/** Replaces the emoji codes in plain text, such as a topic title; unknown codes stay as they are */
export function replaceEmojiCodes(text: string): string {
  return text.replace(EMOJI_CODE, code => emojiForDiscourseName(code));
}

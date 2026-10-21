# Seeds of Renaissance branding

This deployment runs `forumType: LessWrong` with a deployment-specific brand layer for
Seeds of Renaissance (Issue #16). The brand changes appearance only; LessWrong behaviour
is unchanged.

## Source of truth

The Seeds of Renaissance design system: https://design.seedsofrenaissance.org/
(repo `life-itself/design`, `projects/sor-design-system/`, v0.1). The values here come from
`system/tokens.css` at commit `3008c99b97c70a074706778dc7879b82d4b21b46`. Do not add colours
or fonts that aren't tokens there.

For coding agents, the design system recommends:

> On-brand work for Seeds of Renaissance uses the design system in the design repo.
> Read https://design.seedsofrenaissance.org/AGENTS.md and follow the route for your job.
> Where this repo's own rules differ, this repo wins.

## How it is wired

| Piece | Where |
|---|---|
| Brand switch | `brandTheme: "seedsOfRenaissance"` in `packages/lesswrong/server/settings/stage1Lw.ts` |
| Palette and typography | `packages/lesswrong/themes/brandThemes/seedsOfRenaissanceTheme.ts`, selected in `themes/siteThemes.ts` |
| Fonts | Google Fonts URL from the design system's website guide, loaded through `themes/globalStyles/externalStyles.ts` in place of LessWrong's Typekit kits |
| Page background | `body.seedsBrand` rules in `components/layout/pageBackground.css` |
| Logo, favicon, OG image | `public/brand/seeds-of-renaissance/`, unmodified copies of `system/logo/` assets |
| Names, tagline, header | `title`, `tagline`, `siteNameWithArticle`, `forumSettings.*` in `stage1Lw.ts` |
| Hidden navigation | `forumSettings.hiddenMenuTabs` (tab ids from `menuTabs.tsx`) |
| LW background art | `forumSettings.showLWBackgroundImage: false` |
| Intercom | `intercomAppId: ""` (disabled) |
| Content link underline | `link.underline` in the brand palette, read in `themes/stylePiping.ts` |

`stage1Lw.ts` merges `sharedSettings` over its own values. Brand keys that
`sharedSettings` also sets (`logoUrl`, `siteImage`, `intercomAppId`) are therefore applied
in a second merge after it.

## Token mapping

| Token | Value | Used for |
|---|---|---|
| `--paper` | `#fbfaf6` | page background, header (light) |
| `--white` | `#ffffff` | white-background routes |
| `--ink` | `#1b1916` | text, links, buttons, active tabs (light) |
| `--muted` | `#5d584f` | secondary text (light) |
| `--night` | `#171613` | page background, header (dark mode) |
| `--chalk` | `#ece7dc` | text, links, buttons (dark mode) |
| `--night-muted` | `#a49e93` | secondary text (dark mode) |
| `--night-rule` | `#38342e` | active tab fill (dark mode; `TabButton` always uses white text) |
| `--font-body` | Bricolage Grotesque | UI, post and comment bodies |
| `--font-display` fallback | Fraunces | header name, post page titles only |
| `--font-label` fallback | Hanken Grotesk | buttons |

The design system has no dark mode ("night is a section, not a theme"). Users can still pick
dark mode, which uses the night tokens.

Links in post and comment bodies are ink, so they are underlined (1px, offset 3px, as the
design system's `.link`) through the `link.underline` palette flag. On narrow screens the
header shows the mark alone in place of the short title.

All pairs in use meet WCAG AA. The lowest is muted on paper at 6.8:1. The logo red
(`#e5201c`) is 4.4:1 on paper, which is below AA for body text, so it is not used for links.

## Deliberately not used yet

- **Polyamine and Restora** (display faces) are commercial and not yet licensed. Fraunces is the
  design system's sanctioned fallback.
- **Wordmark and lockup logos** set the name in Polyamine, so they need that licence before
  public use. The header uses the swallow mark plus the text name.
- **Apfel Grotezk** (OFL) is embedded in the design system's `fonts.css`. Hanken Grotesk stands
  in until it is self-hosted.
- **`components.css` and `tokens.css`** are not linked. Their global `.sor` styles would
  conflict with ForumMagnum's JSS, so values are copied into the theme instead.
- **Photography and graphics sets**: everything except the woodcuts and sprite is uncleared.

## Follow-ups

- About, FAQ and Contact post ids still point at LessWrong posts.
- About 150 hard-coded "LessWrong" strings remain in less prominent UI (emails, review and
  library pages, tooltips).
- LessWrong-only routes (`/library`, `/hpmor`, `/codex`, `/leaderboard`, ...) are hidden from the
  menu but still reachable.

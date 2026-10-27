// Seeds of Renaissance brand theme, layered on top of the LessWrong site theme
// when the `brandTheme` instance setting is "seedsOfRenaissance".
//
// Every colour below comes from the Seeds of Renaissance design system
// (https://design.seedsofrenaissance.org/system/tokens.css); the token name is
// noted next to each value. Do not add colours that aren't tokens there. Fonts
// are LessWrong's (see docs/branding/seeds-of-renaissance.md for why). See that
// doc for the full mapping.

const tokens = {
  white: "#ffffff",       // --white
  paper: "#fbfaf6",       // --paper
  night: "#171613",       // --night
  ink: "#1b1916",         // --ink
  muted: "#5d584f",       // --muted
  chalk: "#ece7dc",       // --chalk
  nightMuted: "#a49e93",  // --night-muted
  nightRule: "#38342e",   // --night-rule
};

// Text colours use light-dark() (like the default palette's greyAlpha) so they
// follow surfaces that flip color-scheme locally, such as sent-message bubbles.
const inkText = `light-dark(${tokens.ink},${tokens.chalk})`;
const mutedText = `light-dark(${tokens.muted},${tokens.nightMuted})`;

export const seedsOfRenaissanceTheme: SiteThemeSpecification = {
  componentPalette: (dark: boolean) => {
    const ground = dark ? tokens.night : tokens.paper;
    return {
      text: {
        primary: inkText,
        normal: inkText,
        secondary: mutedText,
      },
      // Links inherit the ink colour, per the design system; the logo red is
      // reserved and fails WCAG AA as body-text link colour on paper.
      link: {
        color: inkText,
        visited: inkText,
        underline: true, // as the design system's .link: 1px, offset 3px
      },
      background: {
        default: ground,
        profilePageBackground: ground,
      },
      header: {
        text: inkText,
        background: ground,
      },
      // TabButton always uses white text on the active tab, so in dark mode
      // the active fill is the darker --night-rule rather than chalk.
      tab: {
        active: {
          background: dark ? tokens.nightRule : tokens.ink,
          text: tokens.white,
          hover: {
            background: dark ? tokens.nightRule : tokens.muted,
          },
        },
      },
      // Buttons and marks are ink. Light mode only: many components put white
      // text on primary.main, which a chalk fill would make unreadable, so dark
      // mode keeps LessWrong's mid-tone defaults. primary.light is both a fill
      // behind ink text and a text/icon colour, so it is the mid-tone
      // --night-muted (6.6:1 under ink, 2.55:1 on paper; LessWrong's is 2.3:1).
      ...(!dark && {
        primary: {
          main: tokens.ink,
          dark: tokens.ink,
          light: tokens.nightMuted,
          contrastText: tokens.paper,
        },
        secondary: {
          main: tokens.ink,
          dark: tokens.ink,
          light: tokens.nightMuted,
          contrastText: tokens.paper,
        },
        lwTertiary: {
          main: tokens.muted,
          dark: tokens.ink,
        },
      }),
    };
  },
  make: (palette: ThemePalette) => ({
    isLW: true,
    isAF: false,
  }),
};

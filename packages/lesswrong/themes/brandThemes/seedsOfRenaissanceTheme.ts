// Seeds of Renaissance brand theme, layered on top of the LessWrong site theme
// when the `brandTheme` instance setting is "seedsOfRenaissance".
//
// Every colour and font below comes from the Seeds of Renaissance design system
// (https://design.seedsofrenaissance.org/system/tokens.css); the token name is
// noted next to each value. Do not add colours or fonts that aren't tokens
// there. See docs/branding/seeds-of-renaissance.md for the full mapping.

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

// GreekFallback (declared in Layout.tsx) only covers Greek code points, so that
// Greek letters render consistently; everything else falls through to the brand faces.
const bodyStack = ['GreekFallback', '"Bricolage Grotesque"', 'system-ui', 'sans-serif'].join(','); // --font-body
// Fraunces is the design system's sanctioned fallback for the (not yet
// licensed) Polyamine/Restora display faces. Used only for titles.
const titleStack = ['"Fraunces"', 'Georgia', 'serif'].join(','); // --font-display fallback
// Hanken Grotesk is the design system's fallback for Apfel Grotezk, which
// isn't on Google Fonts. Used for (uppercase) buttons.
const labelStack = ['"Hanken Grotesk"', 'system-ui', 'sans-serif'].join(','); // --font-label fallback

export const seedsOfRenaissanceGoogleFontsUrl = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..700&family=Hanken+Grotesk:wght@400;500;700&family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..500,100;1,9..144,300..500,100&display=swap";

export const seedsOfRenaissanceTheme: SiteThemeSpecification = {
  componentPalette: (dark: boolean) => {
    const ground = dark ? tokens.night : tokens.paper;
    const ink = dark ? tokens.chalk : tokens.ink;
    const muted = dark ? tokens.nightMuted : tokens.muted;
    return {
      fonts: {
        sansSerifStack: bodyStack,
        serifStack: bodyStack,
        headerStack: titleStack,
      },
      text: {
        primary: ink,
        normal: ink,
        secondary: muted,
      },
      // Links inherit the ink colour, per the design system; the logo red is
      // reserved and fails WCAG AA as body-text link colour on paper.
      link: {
        color: ink,
        visited: ink,
        underline: true, // as the design system's .link: 1px, offset 3px
      },
      background: {
        default: ground,
        profilePageBackground: ground,
      },
      header: {
        text: ink,
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
      // Buttons and marks are ink
      primary: {
        main: ink,
        dark: ink,
        light: muted,
        contrastText: ground,
      },
      secondary: {
        main: ink,
        dark: ink,
        light: muted,
        contrastText: ground,
      },
      lwTertiary: {
        main: muted,
        dark: ink,
      },
    };
  },
  make: (palette: ThemePalette) => ({
    isLW: true,
    isAF: false,
    typography: {
      title: {
        fontFamily: titleStack,
        fontWeight: 400,
      },
      headerStyle: {
        fontFamily: titleStack,
      },
      button: {
        fontFamily: labelStack,
      },
    },
  }),
};

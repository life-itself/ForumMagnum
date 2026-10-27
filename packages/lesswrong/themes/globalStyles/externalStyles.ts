import type { BrandThemeName } from '@/lib/instanceSettings';

export const globalExternalStylesheets = [
  "https://use.typekit.net/jvr1gjm.css",
  "https://use.typekit.net/tqv5rhd.css"
];

/**
 * LessWrong's Typekit kits are licensed to and restricted to its domains, so
 * brand themes don't load them. LessWrong's font stacks then fall back to
 * system fonts (Palatino, Gill Sans, Calibri) and the self-hosted ET Book.
 */
export const getGlobalExternalStylesheets = (brandTheme: BrandThemeName | null): string[] => {
  if (brandTheme === 'seedsOfRenaissance') return [];
  return globalExternalStylesheets;
};

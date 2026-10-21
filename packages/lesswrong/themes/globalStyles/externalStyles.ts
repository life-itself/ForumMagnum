import type { BrandThemeName } from '@/lib/instanceSettings';
import { seedsOfRenaissanceGoogleFontsUrl } from '../brandThemes/seedsOfRenaissanceTheme';

export const globalExternalStylesheets = [
  "https://use.typekit.net/jvr1gjm.css",
  "https://use.typekit.net/tqv5rhd.css"
];

/**
 * Brand themes replace the (LessWrong-licensed, domain-restricted) Typekit
 * fonts with their own.
 */
export const getGlobalExternalStylesheets = (brandTheme: BrandThemeName | null): string[] => {
  if (brandTheme === 'seedsOfRenaissance') return [seedsOfRenaissanceGoogleFontsUrl];
  return globalExternalStylesheets;
};

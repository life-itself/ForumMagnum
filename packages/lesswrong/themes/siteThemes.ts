import { brandThemeSetting, ForumTypeString } from '@/lib/instanceSettings';
import { seedsOfRenaissanceTheme } from './brandThemes/seedsOfRenaissanceTheme';

export const lessWrongTheme: SiteThemeSpecification = {
  componentPalette: (dark: boolean) => ({
  }),
  make: (palette: ThemePalette) => ({
    isLW: true,
    isAF: false,
  }),
};
export const alignmentForumTheme: SiteThemeSpecification = {
  componentPalette: (dark: boolean) => ({
  }),
  make: (palette: ThemePalette) => ({
    isLW: false,
    isAF: true,
  }),
};

export const getSiteTheme = (forumType: ForumTypeString): SiteThemeSpecification => {
  if (forumType === 'AlignmentForum') return alignmentForumTheme;
  else if (brandThemeSetting.get(forumType) === 'seedsOfRenaissance') return seedsOfRenaissanceTheme;
  else return lessWrongTheme;
}

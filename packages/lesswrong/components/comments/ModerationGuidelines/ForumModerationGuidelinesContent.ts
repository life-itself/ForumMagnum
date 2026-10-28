import {frontpageGuidelinesLW, defaultGuidelinesLW} from './LWModerationGuidelinesContent'
import { commentGuidelinesHtmlSetting, type ForumTypeString } from '@/lib/instanceSettings'

export const getFrontpageGuidelines = (forumType: ForumTypeString) => commentGuidelinesHtmlSetting.get(forumType) ?? frontpageGuidelinesLW
export const getDefaultGuidelines = (forumType: ForumTypeString) => commentGuidelinesHtmlSetting.get(forumType) ?? defaultGuidelinesLW


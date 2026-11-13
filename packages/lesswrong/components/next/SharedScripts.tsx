'use client';

import React, { useMemo } from 'react';

import { getEmbeddedStyleLoaderScript } from "@/components/hooks/embedStyles";
import { getSsrInjectedGraphqlLoaderScript } from "@/components/hooks/ssrInjectedGraphql";
import { toEmbeddableJson } from "@/lib/utils/jsonUtils";
import { getInstanceSettings } from "@/lib/getInstanceSettings";
import { getGlobalExternalStylesheets } from "@/themes/globalStyles/externalStyles";
import { brandThemeSetting, umamiDomainsSetting, umamiScriptUrlSetting, umamiWebsiteIdSetting } from "@/lib/instanceSettings";
import { forumTypeSetting } from "@/lib/forumTypeUtils";

// These exist as a client component to avoid the RSC rehydration protocol
// putting them into the initial streamed response chunk twice.
const SharedScriptsInner = () => {
  // Include both forums so this bootstrap stays synchronous and independent
  // of request headers. Setting getters select the forum supplied by callers.
  const publicInstanceSettings = {
    LessWrong: getInstanceSettings('LessWrong').public,
    AlignmentForum: getInstanceSettings('AlignmentForum').public,
  };
  const umamiScriptUrl = umamiScriptUrlSetting.get(forumTypeSetting.get());
  const umamiWebsiteId = umamiWebsiteIdSetting.get(forumTypeSetting.get());
  const umamiDomains = umamiDomainsSetting.get(forumTypeSetting.get()) ?? undefined;
  return (<>
      {getGlobalExternalStylesheets(brandThemeSetting.get(forumTypeSetting.get())).map(stylesheet => <link key={stylesheet} rel="stylesheet" type="text/css" href={stylesheet}/>)}
      <script dangerouslySetInnerHTML={{__html: `window.publicInstanceSettings = ${toEmbeddableJson(publicInstanceSettings)}`}}/>
      <script dangerouslySetInnerHTML={{__html: getEmbeddedStyleLoaderScript()}}/>
      <script dangerouslySetInnerHTML={{__html: getSsrInjectedGraphqlLoaderScript()}}/>
      {umamiScriptUrl && umamiWebsiteId && <script defer src={umamiScriptUrl} data-website-id={umamiWebsiteId} data-domains={umamiDomains}/>}
      
      <meta httpEquiv='delegate-ch' content='sec-ch-dpr https://res.cloudinary.com;' />
      <meta httpEquiv="Accept-CH" content="DPR, Viewport-Width, Width"/>
      {/* HACK: These insertion-point markers are <script> tags (rather than
        * <style> tags) because <style> is special-cased in a way that
        * interacts badly with our dynamic insertion leading to a hydration
        * mismatch */}
      <script id="jss-insertion-start"/>
      {/*Style tags are dynamically inserted here*/}
      <script id="jss-insertion-end"/>
  </>)
};

export const SharedScripts = () => {
  return useMemo(() => <SharedScriptsInner/>, []);
}

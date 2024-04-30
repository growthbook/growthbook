# Changelog

## **1.0.0** - Apr 31, 2024

- New `init` function as a replacement for `loadFeatures`.
- Support payload import/export via `init({ payload })`, `setPayload`, and `getPayload`. Better supports hybrid apps, as well as externalizing the SDK Payload.
- Ability to block or control experiments by various context properties
  - `blockedChangeIds` targets individual experiments
  - `disableVisualExperiments` prevents visual experiments from running
  - `disableJsInjection` blocks any visual experiments which write <script\> code
  - `disableUrlRedirectExperiments` prevents redirect experiments from running
  - `disableCrossOriginUrlRedirectExperiments` blocks redirects if the origin changes
  - `jsInjectionNonce` injects a nonce string onto any generated <sript\> tags
  - `disableExperimentsOnLoad` prevents AutoExperiments from running automatically; `triggerAutoExperiments` manually triggers them.
- Provide a custom DOM mutation method by setting context `applyDomChangesCallback`. Useful for server-side rendering visual experiments.
- Get a list of triggered experiments by their `changeId` (a new, more-specific AutoExperiment identifier) via `getCompletedChangeIds`.
- Disable in-memory cache via `configureCache({ disableLocalCache: true })`
- Easier streaming customization via `init({ streaming: true })`.
- Prefetch payloads on backend SDK instances via `prefetchPayload()`. Also allows feature repository SSE streaming without connection each SDK instance to streaming (useful for NodeJS).
- Many improvements to `auto.min.js` script
  - Payload hydration via `payload` context property
  - Support sticky bucketing via `useStickyBucketService` context property (accepts "cookie" and "localStorage"); override cookie or localStorage key via `stickyBucketPrefix` context property.
  - Hydrate sticky bucket docs by setting context `stickyBucketAssignmentDocs` (useful for SSR hydration without reliance on cookies)
  - Customize attributes/cookies via `uuidCookieName` (default "gbuuid") and `uuidKey` (default "id").
  - Force a uuid cookie write on load via `persistUuidOnLoad` (useful for SSR hydration)

## **0.36.0** - Mar 21, 2024

- Support for URL Redirect tests. New context options `navigate` (default `(url) => window.location.replace(url)`) and `navigateDelay` (default 100ms) for browsers. Plus, new method `getRedirectUrl()` for back-end/edge implementations.
- Built-in anti-flicker snippet. Set context option `antiFlicker` to true to enable (defualt false). Control timeout with option `antiFlickerTimeout` (default 3500ms)
- New methods to deal with deferred tracking calls and server/client hydration
  - `setTrackingCallback` - Set or update the trackingCallback after initialization. Until a trackingCallback is set, all calls will be queued up.
  - `getDeferredTrackingCalls` - Get all queued tracking calls (in JSON format)
  - `setDeferredTrackingCalls` - Hydrate the GrowthBook instance with queued tracking calls (in JSON format). Does not fire these calls immediately.
  - `fireDeferredTrackingCalls` - Manually fire all queued tracking calls.
- Various improvements to `auto.min.js` script
  - New `uuid` context property to use your own user id instead of the auto-generated one.
  - New `data-no-auto-cookies` script attribute and `growthbookpersist` event listener to more easily work with cookie consent banners
  - New `growthbookdata` DOM event to attach multiple renderers to a single GrowthBook instance
- Fix bug with prerequisite feature checks failing on initial page load when used with visual editor experiments

## **0.35.0** - Mar 8, 2024

- New `updateAttributes` method to make partial updates
- Fix missing `await` in RedisStickyBucketService
- New `context.renderer` option
- Various improvements to `auto.min.js` script
  - New `window.growthbook_queue` to make it easier to work with an async script tag
  - New `pageTitle` auto attribute
  - Fixed bugs with built-in GA4 and GTM tracking calls
  - New `growthbookrefresh` DOM event you can trigger to for re-evaluation of auto attributes

## **0.34.0** - Feb 20, 2024

- Prerequisite feature support for feature rules and experiments
- Fix bug feature repository would cache non-2xx responses when fetching features

## **0.33.0** - Jan 31, 2024

- Add new `maxAge` cache setting that limits how old cached features can be before we force a re-fetch from the server. Defaults to 24 hours.
- Fix broken visual editor preview links for multi-page experiments

## **0.32.0** - Jan 11, 2024

- Fix bug when visual editor loaded before `document.body` was available
- Sticky Bucketing support with built-in implementations for persisting in localStorage, cookies (both browser and Node.js), and Redis. Off by default, an implementation must be passed into the GrowthBook constructor to enable.
- The following methods are now async and return a Promise: `setAttributes`, `setAttributeOverrides`, `setForcedVariations`, `setURL`. No code changes are required since these all returned `void` prior to this.

## **0.31.0** - Nov 14, 2023

- Fix bug with multi-page visual editor experiments
- Add additional unit tests for comparison operators
- Fix auto-generated types when using JSON feature flags

## **0.30.0** - Oct 18, 2023

- Pause and resume streaming connections when the browser tab is hidden or visible. Can be disabled by setting `disableIdleStreams: false` via `configureCache()`. A 20sec idle timeout is used by default before pausing the connection; this can be configured by setting `idleStreamInterval` via `configureCache()`.
- Fix bug with `$exists` operator and undefined values
- Improvements and bug fixes when moving elements via the visual editor
- New `auto.js` pre-bundled script for simpler SDK integration on no/low code platforms

## **0.29.0** - Oct 4, 2023

- Add optional `remoteEval` mode for client-side applications (plus `cacheKeyAttributes` option to control when to re-fetch from the server)
- New options to better control network requests (useful for corporate proxies): `apiHostRequestHeaders`, `streamingHost`, and `streamingHostRequestHeaders`
- New public methods `getForcedVariations` and `getForcedFeatures` to see what's currently being overridden by DevTools, etc.
- Fix bug when using the GrowthBook DevTools Extension with Visual Editor experiments
- New `maxEntries` cache setting to enable garbage collection on the localStorage cache

## **0.28.0** - Aug 29, 2023

- Fix bug with streaming SSE connections only working on initial page load
- New context option `backgroundSync`. Set to false (default true) to disable opening a streaming connection to GrowthBook in the background
- New context option `subscribeToChanges`. Set to true (default false) to update the instance in realtime as features change in GrowthBook. This replaces the old `autoRefresh` setting (the old setting continues to work for backwards compatibility)
- Add missing types for TypeScript 5
- Add additional type exports `AutoExperiment` and `AutoExperimentVariation`

## **0.27.0** - May 23, 2023

- SemVer targeting conditions support (and other SemVer-like version strings)
- Make targeting condition `$in` and `$nin` operators work with arrays
- Support for custom JS injection as part of the visual editor
- Fix bug - localStorage cache not getting updated TTL when features are refreshed

## **0.26.0** - May 1, 2023

- Update GrowthBook test suite to v0.4.2
- Fix bug when targeting condition value is null
- Fix bug when an improper hashVersion is specified
- Bump dom-mutator to v0.5.0 to support re-arranging page elements

## **0.25.0** - Apr 4, 2023

- More graceful EventSource connection handling with exponential backoff

## **0.24.0** - Mar 30, 2023

- Support for the new GrowthBook Visual Editor
- Advanced URL targeting support

## **0.23.0** - Feb 27, 2023

- Update GrowthBook test suite to v0.4.0
- Support for holdout groups
- Experiment dependencies (e.g. only run this experiment if user is in Variation B of another experiment)
- Ability to force re-randomization when making changes in the middle of an experiment
- Make experiment name and variation name/id available to the tracking callback
- More flexibile configuration of hashing and variation bucketing
- Fix bias in hashing algorithm when nested experiments have similar tracking keys

## **0.22.0** - Feb 27, 2023

- Strongly typed feature flag support

## **0.21.2** - Feb 9, 2023

- Fix localStorage incognito bug

## **0.21.1** - Jan 22, 2023

- Enable more aggressive minification (Reduced bundle size by 10%)

## **0.21.0** - Jan 18, 2023

- Built-in fetching, caching, and background sync

## **0.20.1** - Dec 8, 2022

- Bug fix - `coverage` ignored when set to 0

## **0.20.0** - Nov 13, 2022

- Built-in decryption support

## **0.19.1** - Nov 2, 2022

- Increase browser support to include iOS 12.2+

## **0.19.0** - Oct 17, 2022

- Disable Chrome DevTools by default. Require `enableDevTools: true` opt-in instead.
- Upgrade Typescript to 4.7

## **0.18.1** - Jul 20, 2022

- Make the `featureId` available from `trackingCallback`

## **0.18.0** - May 23, 2022

- Don't skip experiment rules that are forced

## **0.17.1** - May 17, 2022

- Fix edge case when nested attribute is null

## **0.17.0** - Feb 20, 2022

- ReactNative support (remove reliance on `document`)
- Fix typescript errors
- (alpha) Realtime feature usage tracking

## **0.16.2** - Jan 25, 2022

- Fix when forcing a falsy feature value

## **0.16.1** - Jan 20, 2022

- Deprecate `context.overrides`
- Deprecate `includes` callback for experiments

## **0.16.0** - Jan 5, 2022

- Support new GrowthBook DevTools Chrome extension

## **0.15.1** - Dec 30, 2021

- Fix missing exports for Typescript types

## **0.15.0** - Dec 27, 2021

- Initial support for feature flags

## **0.14.0** - Oct 29, 2021

- Add mutual exclusion support via namespaces

## **0.13.0** - Sep 13, 2021

- Improved debugging support

_Versions older than 0.13.0 were in a different repository, which is now archived_

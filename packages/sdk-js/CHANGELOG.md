# Changelog

## **0.25.0** - Apr 4, 2023

- More graceful EventSource connection handling with exponential backoff

## **0.24.0** - Mar 30, 2023

- Support for the new GrowthBook Visual Editor
- Advanced URL targeting support

## **0.23.0** - Feb 27, 2023

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

// The entry point for dist/bundles/index*.js and dist/bundles/esm*.js.
//
// Sites load these straight from a CDN, often without a version, so they get
// every new release without changing their code. Here `GrowthBook` still runs
// visual editor and URL redirect experiments the way it did before 3.0, and
// still takes the options that controlled them.
//
// The npm package (./index) does not do this. It needs the plugins.

import type {
  Attributes,
  NoInferType,
  Options,
  RegisteredAttributes,
  RegisteredFeatures,
} from "./types/growthbook";
import { GrowthBook as CoreGrowthBook } from "./GrowthBook";
import {
  legacyAutoExperimentPlugins,
  LegacyAutoExperimentOptions,
} from "./legacy-auto-experiments";

export * from "./index";

export class GrowthBook<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AppFeatures extends Record<string, any> = RegisteredFeatures,
  AppAttributes extends Attributes = RegisteredAttributes,
> extends CoreGrowthBook<AppFeatures, AppAttributes> {
  constructor(
    options: Options<NoInferType<AppAttributes>> &
      LegacyAutoExperimentOptions = {},
  ) {
    super({
      ...options,
      plugins: [
        ...legacyAutoExperimentPlugins(options),
        ...(options.plugins || []),
      ],
    });
  }
}

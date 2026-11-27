// The entry point for dist/bundles/index*.js and dist/bundles/esm*.js.
//
// Sites load these straight from a CDN, often without a version, so they get
// every new release without changing their code. Here `GrowthBook` still runs
// visual editor and URL redirect experiments the way it did before 3.0, and
// still takes the options that controlled them.
//
// The npm package (./index) does not do this. It needs the plugins.

import type { Options } from "./types/growthbook";
import { GrowthBook as CoreGrowthBook } from "./GrowthBook";
import {
  legacyAutoExperimentPlugins,
  LegacyAutoExperimentOptions,
} from "./legacy-auto-experiments";

export * from "./index";

export class GrowthBook extends CoreGrowthBook {
  constructor(options: Options & LegacyAutoExperimentOptions = {}) {
    // GrowthBook keeps the object it is given, and sites change that object
    // after creating the instance. So pass theirs, not a copy.
    const plugins = options.plugins;
    options.plugins = [
      ...legacyAutoExperimentPlugins(options),
      ...(plugins || []),
    ];
    super(options);
    options.plugins = plugins;
  }
}

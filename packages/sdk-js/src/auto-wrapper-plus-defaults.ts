import { wrapperDefaults } from "./auto-wrapper-defaults";

// Imported first by auto-wrapper-plus.ts so this runs before auto-wrapper.ts
// reads wrapperDefaults. Babel ignores this file; only the rollup
// core+sessions bundle includes it.
//
// core+sessions is a fresh opt-in, so the low-risk categories are on out of
// the box at the plugin defaults (10% sample, hashed on the auto-attributes
// id). Clickstream stays opt-in because it captures element text.
wrapperDefaults.autoEvents = { pageEvents: true, errors: true, cwv: true };

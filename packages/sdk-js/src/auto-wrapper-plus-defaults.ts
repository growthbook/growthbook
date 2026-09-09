import { wrapperDefaults } from "./auto-wrapper-defaults";

// core+sessions is a fresh opt-in, so the low-risk categories are on out of
// the box at the plugin defaults (10% sample, hashed on the auto-attributes
// id). Clickstream stays opt-in because it captures element text.
wrapperDefaults.autoEvents = { pageEvents: true, errors: true, cwv: true };

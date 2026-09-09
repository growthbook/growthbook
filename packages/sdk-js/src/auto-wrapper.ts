// auto.js: the standard script-tag bundle. Auto-events stay off until listed
// on the script tag, set in window.growthbook_config, or enabled remotely.
import { bootstrap } from "./auto-wrapper-core";

// Default export only: the IIFE assigns it to window._growthbook, which must
// be the instance itself
export default bootstrap().gb;

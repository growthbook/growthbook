// auto.js: auto-events stay off until configured locally or remotely
import { buildCore } from "./auto-wrapper-core";

// Default export only: the IIFE assigns it to window._growthbook
export default buildCore().gb;

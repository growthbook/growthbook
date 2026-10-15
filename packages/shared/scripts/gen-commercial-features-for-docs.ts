import {
  accountFeatures,
  CommercialFeature,
} from "../src/enterprise/license-consts";
import { writeSnippetConst } from "./docs-snippet-data";

// Determine the lowest plan that has access to a feature
function getLowestPlan(feature: CommercialFeature): "pro" | "enterprise" {
  // Check plans in order from lowest to highest
  if (accountFeatures.pro.has(feature)) {
    return "pro";
  }
  return "enterprise";
}

// Convert kebab-case to Title Case display name
function toDisplayName(feature: CommercialFeature): string {
  // Special cases for acronyms and specific naming
  const specialCases: Record<string, string> = {
    sso: "SSO",
    scim: "SCIM",
    "ai-suggestions": "AI Suggestions",
    "json-validation": "JSON Validation",
    "url-redirects": "URL Redirects",
    "visual-editor": "AI Visual Editor",
    "regression-adjustment": "CUPED",
    saveSqlExplorerQueries: "Save SQL Explorer Queries",
  };

  if (specialCases[feature]) {
    return specialCases[feature];
  }

  // Convert kebab-case to Title Case
  return feature
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Get all commercial features from the enterprise plan (which has all features)
const allFeatures = Array.from(accountFeatures.enterprise);

// Build the features map
const featuresMap: Record<
  string,
  { plan: "pro" | "enterprise"; displayName: string }
> = {};

for (const feature of allFeatures) {
  featuresMap[feature] = {
    plan: getLowestPlan(feature),
    displayName: toDisplayName(feature),
  };
}

// Sort features alphabetically for consistent output
const sortedFeaturesMap = Object.fromEntries(
  Object.entries(featuresMap).sort(([a], [b]) => a.localeCompare(b)),
);

writeSnippetConst(
  "CommercialFeature.jsx",
  "commercialFeatures",
  sortedFeaturesMap,
);

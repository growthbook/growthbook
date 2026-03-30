import { SavedGroupInterface } from "shared/types/saved-group";
import {
  renderSavedGroupSettings,
  renderSavedGroupTargeting,
  renderSavedGroupValues,
  renderSavedGroupProjects,
  getSavedGroupSettingsBadges,
  getSavedGroupTargetingBadges,
  getSavedGroupValuesBadges,
  getSavedGroupProjectsBadges,
} from "@/components/SavedGroups/SavedGroupDiffRenders";
import { RevisionDiffConfig } from "./useRevisionDiff";

export const REVISION_SAVED_GROUP_DIFF_CONFIG: RevisionDiffConfig<SavedGroupInterface> =
  {
    sections: [
      {
        label: "Settings",
        keys: [
          "groupName",
          "owner",
          "description",
        ] as (keyof SavedGroupInterface)[],
        render: renderSavedGroupSettings,
        getBadges: getSavedGroupSettingsBadges,
      },
      {
        label: "Targeting",
        keys: ["type", "condition"] as (keyof SavedGroupInterface)[],
        render: renderSavedGroupTargeting,
        getBadges: getSavedGroupTargetingBadges,
      },
      {
        label: "Values",
        keys: ["attributeKey", "values"] as (keyof SavedGroupInterface)[],
        render: renderSavedGroupValues,
        getBadges: getSavedGroupValuesBadges,
      },
      {
        label: "Projects",
        keys: ["projects"] as (keyof SavedGroupInterface)[],
        render: renderSavedGroupProjects,
        getBadges: getSavedGroupProjectsBadges,
      },
    ],
    normalizeSnapshot: (snapshot: SavedGroupInterface): SavedGroupInterface => {
      let result = { ...snapshot };

      // Parse condition from JSON string
      if (result.condition && typeof result.condition === "string") {
        try {
          result = { ...result, condition: JSON.parse(result.condition) };
        } catch {
          // Ignore parse errors
        }
      }

      // Truncate large values arrays
      if (Array.isArray(result.values) && result.values.length > 100) {
        result = {
          ...result,
          values: [
            ...result.values.slice(0, 100),
            `— ${result.values.length - 100} more values...`,
          ] as string[],
        };
      }

      return result;
    },
  };

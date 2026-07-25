import type { BulkPublishTargetType } from "back-end/src/revisions/bulkPublish/types";

// User-facing entity noun per the copy glossary: first-class resources are
// Title Case. Kept in one place so every message naming an entity agrees.
export function displayEntityName(entityType: BulkPublishTargetType): string {
  switch (entityType) {
    case "feature":
      return "Feature Flag";
    case "saved-group":
      return "Saved Group";
    case "config":
      return "Config";
    case "constant":
      return "Constant";
    default:
      return entityType;
  }
}

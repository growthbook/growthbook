import type { RevisionTargetType } from "shared/enterprise";

// Every entity type that has revisions. The generic engine covers
// RevisionTargetType; Feature Flags keep their own revision model, so the union
// widens it. Lives here rather than in bulkPublish/ because it is not a
// bulk-publish concept — bulk is one consumer of it, alongside naming and
// landing.
export type RevisionedEntityType = RevisionTargetType | "feature";

// User-facing entity noun per the copy glossary: first-class resources are
// Title Case. Kept in one place so every message naming an entity agrees.
export function displayEntityName(entityType: RevisionedEntityType): string {
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

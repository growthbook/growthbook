import type { RevisionedEntityType } from "back-end/src/revisions/entityNames";
import type {
  BypassedGate,
  PublishGate,
} from "back-end/src/revisions/publishGates";
import type { BulkRevisionRef } from "back-end/src/revisions/bulkPublish/BulkPublishableAdapter";

export type BulkPublishTargetType = RevisionedEntityType;

export type BulkPublishItemRef = {
  entityType: BulkPublishTargetType;
  entityId: string;
  version: number;
  /** Caller-facing identifier used instead of internal IDs in messages. */
  displayId?: string;
};

// Approval gates are cleared by authority, not a request bypassApproval flag.
export type BulkPublishFlags = {
  /** Acknowledge-class gates: guards, stale-base, warn-mode schema failures. */
  ignoreWarnings: boolean;
  /** Validation-class gates; honored only with FlagsBypassApprovals. */
  skipSchemaValidation: boolean;
  /** Custom-hook rejections; honored only with FlagsBypassApprovals. */
  skipHooks: boolean;
  /** The org REST-bypass setting applies to this caller (key/PAT, not JWT). */
  restApiBypassesReviews: boolean;
  comment?: string;
};

/** A publish gate attributed to the item that raised it. */
export type BulkPublishGate = PublishGate & {
  entityType: BulkPublishTargetType;
  entityId: string;
  version: number;
};

// Commit verifies entityDateUpdated and CAS-claims revision status/dateUpdated.
export type ClaimBaseline = {
  revisionStatus: string;
  revisionDateUpdated: Date;
  entityDateUpdated: Date | null;
};

export type PlannedItemPublish = {
  ref: BulkPublishItemRef;
  /** Live entity state retained for compensation. */
  entityPreImage: Record<string, unknown>;
  revision: BulkRevisionRef;
  desiredState: Record<string, unknown>;
  proposedEntity: Record<string, unknown>;
  hasChanges: boolean;
  baseline: ClaimBaseline;
  isApprovalBypass: boolean;
  bypassedGates: BypassedGate[];
};

/** Read-only plan shared by dry-run and commit. */
export type BulkPublishPlan = {
  items: PlannedItemPublish[];
  gates: BulkPublishGate[];
  blockingGates: BulkPublishGate[];
  warnings: string[];
  flags: BulkPublishFlags;
};

export type BulkPublishItemResult = {
  ref: BulkPublishItemRef;
  status: "published" | "rolled-back" | "not-applied";
  revisionId: string;
};

export type BulkPublishResult = {
  items: BulkPublishItemResult[];
  warnings: string[];
  /** Correlation token stamped on every event this publish emitted. */
  bulkPublishId: string;
};

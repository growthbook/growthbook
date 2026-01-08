export type ApprovalFlowStatus =
  | "draft"
  | "pending-review"
  | "approved"
  | "changes-requested"
  | "merged"
  | "closed";

export type ReviewDecision = "approve" | "request-changes" | "comment";

export type ApprovalEntityType = "experiment" | "fact-metric" | "fact-table" | "metric";

export interface Review {
  id: string;
  userId: string;
  decision: ReviewDecision;
  comment: string;
  createdAt: Date | string;
}

export interface ActivityLogEntry {
  id: string;
  userId: string;
  action:
    | "created"
    | "updated"
    | "reviewed"
    | "approved"
    | "requested-changes"
    | "commented"
    | "merged"
    | "closed"
    | "reopened";
  details?: string;
  createdAt: Date | string;
}

export interface ApprovalFlowInterface {
  id: string;
  organization: string;
  dateCreated: Date | string; // this against
  dateUpdated: Date | string;
  
  // Entity information
  entityType: ApprovalEntityType;
  entityId: string;
  
  // Metadata
  title: string;
  description?: string;
  status: ApprovalFlowStatus;
  
  // Author
  author: string;
  
  // Reviews and comments
  reviews: Review[];
  
  // The proposed changes
  proposedChanges: Record<string, unknown>;
  
  originalEntity: Record<string, unknown>; // metric state at that time include everything
  
  // Activity log
  activityLog: ActivityLogEntry[];
  
  // Timestamps
  mergedAt?: Date | string;
  closedAt?: Date | string;
  mergedBy?: string;
  closedBy?: string;
  
  // Labels/tags
  labels?: string[];
}

export interface Conflict {
  field: string;
  baseValue: unknown;
  liveValue: unknown;
  proposedValue: unknown;
}

export interface MergeResult {
  success: boolean;
  conflicts: Conflict[];
  canAutoMerge: boolean;
  fieldsChanged: string[];
  mergedChanges?: Record<string, unknown>;
}

export type EntityType =
  | "experiment"
  | "feature"
  | "metric"
  | "datasource"
  | "comment"
  | "user"
  | "organization"
  | "savedGroup";

export type EventType =
  | "experiment.create"
  | "experiment.update"
  | "experiment.start"
  | "experiment.phase"
  | "experiment.phase.delete"
  | "experiment.stop"
  | "experiment.status"
  | "experiment.archive"
  | "experiment.unarchive"
  | "experiment.delete"
  | "experiment.results"
  | "experiment.analysis"
  | "experiment.screenshot.create"
  | "experiment.screenshot.delete"
  | "experiment.refresh"
  | "feature.create"
  | "feature.publish"
  | "feature.update"
  | "feature.toggle"
  | "feature.archive"
  | "feature.delete"
  | "metric.create"
  | "metric.update"
  | "metric.delete"
  | "metric.analysis"
  | "datasource.create"
  | "datasource.update"
  | "datasource.delete"
  | "datasource.import"
  | "comment.create"
  | "comment.update"
  | "comment.delete"
  | "user.create"
  | "user.update"
  | "user.delete"
  | "user.invite"
  | "organization.create"
  | "organization.update"
  | "organization.delete"
  | "savedGroup.created"
  | "savedGroup.deleted"
  | "savedGroup.updated";

export interface AuditUserLoggedIn {
  id: string;
  email: string;
  name: string;
}

export interface AuditUserApiKey {
  apiKey: string;
}

export interface AuditInterface {
  id: string;
  organization: string;
  user: AuditUserLoggedIn | AuditUserApiKey;
  event: EventType;
  entity: {
    object: EntityType;
    id: string;
    name?: string;
  };
  parent?: {
    object: EntityType;
    id: string;
  };
  reason?: string;
  details?: string;
  dateCreated: Date;
}

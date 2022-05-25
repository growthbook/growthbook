export type EntityType =
  | "experiment"
  | "feature"
  | "metric"
  | "datasource"
  | "comment"
  | "user"
  | "organization";

export type EventType =
  | "experiment.create"
  | "experiment.update"
  | "experiment.updatemeta"
  | "experiment.start"
  | "experiment.phase"
  | "experiment.phase.delete"
  | "experiment.stop"
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
  | "organization.delete";

export interface AuditInterface {
  id: string;
  organization: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
  event: EventType;
  entity: {
    object: EntityType;
    id: string;
  };
  parent?: {
    object: EntityType;
    id: string;
  };
  details?: string;
  dateCreated: Date;
}

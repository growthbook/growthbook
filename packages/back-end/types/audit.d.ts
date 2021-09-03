export type EntityType =
  | "experiment"
  | "metric"
  | "datasource"
  | "comment"
  | "user"
  | "organization"
  | "snapshot";

export type EventType =
  | "experiment.create"
  | "experiment.update"
  | "experiment.start"
  | "experiment.phase"
  | "experiment.stop"
  | "experiment.archive"
  | "experiment.delete"
  | "experiment.results"
  | "experiment.screenshot.create"
  | "experiment.screenshot.delete"
  | "metric.create"
  | "metric.update"
  | "metric.delete"
  | "datasource.create"
  | "datasource.update"
  | "datasource.delete"
  | "commet.create"
  | "comment.update"
  | "comment.delete"
  | "user.create"
  | "user.update"
  | "user.delete"
  | "user.invite"
  | "organization.create"
  | "organization.update"
  | "organization.delete"
  | "snapshot.create.auto"
  | "snapshot.create.manual"
  | "snapshot.delete";

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

import { EntityType } from "../src/types/Audit";

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
  | "experiment.launchChecklist.updated"
  | "feature.create"
  | "feature.publish"
  | "feature.revert"
  | "feature.update"
  | "feature.toggle"
  | "feature.archive"
  | "feature.delete"
  | "metric.autocreate"
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
  | "savedGroup.updated"
  | "archetype.created"
  | "archetype.deleted"
  | "archetype.updated"
  | "team.create"
  | "team.delete"
  | "team.update";

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

import { EventAuditUser } from "../src/events/event-types";
import {FeaturePrerequisite, FeatureRule} from "./feature";

export interface RevisionLog {
  user: EventAuditUser;
  timestamp: Date;
  action: string;
  subject: string;
  value: string;
}

export interface FeatureRevisionInterface {
  featureId: string;
  organization: string;
  baseVersion: number;
  version: number;
  dateCreated: Date;
  dateUpdated: Date;
  datePublished: null | Date;
  publishedBy: null | EventAuditUser;
  createdBy: EventAuditUser;
  comment: string;
  status: "draft" | "published" | "discarded";
  defaultValue: string;
  rules: Record<string, FeatureRule[]>;
  prerequisites?: FeaturePrerequisite[];
  log?: RevisionLog[];
}

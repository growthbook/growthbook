import { EventUser } from "../src/events/event-types";
import { FeatureRule } from "./feature";

export interface RevisionLog {
  user: EventUser;
  approvedBy?: EventUser;
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
  publishedBy: null | EventUser;
  createdBy: EventUser;
  comment: string;
  status:
    | "draft"
    | "published"
    | "discarded"
    | "approved"
    | "changes-requested"
    | "pending-review";
  defaultValue: string;
  rules: Record<string, FeatureRule[]>;
  log?: RevisionLog[];
}

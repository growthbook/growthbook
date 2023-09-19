import { FeatureRule } from "./feature";
import { UserRef } from "./user";

export interface FeatureRevisionInterface {
  featureId: string;
  organization: string;
  version: number;
  dateCreated: Date;
  revisionDate: Date;
  publishedBy: UserRef;
  comment: string;
  status?: "draft" | "published";
  defaultValue: string;
  rules: Record<string, FeatureRule[]>;
}

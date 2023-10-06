import { FeatureRule } from "./feature";
import { UserRef } from "./user";

export interface FeatureRevisionInterface {
  id?: string;
  creatorUserId?: string;
  featureId: string;
  organization: string;
  version: number;
  dateCreated: Date | string;
  revisionDate: Date | string;
  publishedBy: UserRef | null;
  comment: string;
  status?: "draft" | "published" | "discarded";
  defaultValue: string;
  rules: Record<string, FeatureRule[]>;
}

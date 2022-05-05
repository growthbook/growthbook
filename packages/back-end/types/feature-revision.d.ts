import { FeatureRule } from "./feature";

export interface FeatureRevisionInterface {
  featureId: string;
  organization: string;
  revision: number;
  dateCreated: Date;
  revisionDate: Date;
  userId: string;
  userEmail: string;
  userName: string;
  comment: string;

  defaultValue: string;
  rules: Record<string, FeatureRule[]>;
}

import { FeatureDefinition } from "../../api";
import { FeatureEnvironment, FeatureValueType } from "../../feature";

export type ApiV1Feature = {
  id: string;
  archived?: boolean;
  description?: string;
  owner?: string;
  project?: string;
  dateCreated: Date;
  dateUpdated: Date;
  valueType: FeatureValueType;
  defaultValue: string;
  tags?: string[];
  environments: Record<string, FeatureEnvironment>;
  draftEnvironments: Record<string, FeatureEnvironment>;
  definition: FeatureDefinition;
}

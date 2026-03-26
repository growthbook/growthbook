import {
  ExperimentRefVariation,
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "shared/types/feature";

export type FeatureFormValueType = FeatureValueType | "";

export type FeatureFormFieldsValues = {
  id: string;
  description: string;
  project?: string;
  tags: string[];
  customFields: Record<string, string>;
  valueType: FeatureFormValueType;
  environmentSettings: Record<string, FeatureEnvironment>;
};

export type CreateFeatureFormValues = Pick<
  FeatureInterface,
  "defaultValue" | "holdout"
> &
  FeatureFormFieldsValues;

export type FeatureFromExperimentFormValues = Omit<
  FeatureInterface,
  | "organization"
  | "dateCreated"
  | "dateUpdated"
  | "defaultValue"
  | "customFields"
> & {
  customFields: Record<string, string>;
  variations: ExperimentRefVariation[];
  existing: string;
};

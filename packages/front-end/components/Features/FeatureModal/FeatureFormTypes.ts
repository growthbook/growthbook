import {
  ExperimentRefVariation,
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "shared/types/feature";

export type FeatureFormValueType = FeatureValueType | "";

export type FeatureFormCustomFields = Record<string, string>;

export type FeatureFormFieldsValues = {
  id: string;
  description: string;
  project?: string;
  tags: string[];
  customFields: FeatureFormCustomFields;
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
  customFields: FeatureFormCustomFields;
  variations: ExperimentRefVariation[];
  existing: string;
};

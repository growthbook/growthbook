export type CustomFieldTypes =
  | "text"
  | "textarea"
  | "markdown"
  | "enum"
  | "multiselect"
  | "url"
  | "number"
  | "boolean"
  | "date"
  | "datetime";

export type CustomFieldValues = Record<string, string>;

export type CustomFieldSection = "experiment" | "feature";

export type CustomField = {
  id: string;
  name: string;
  description: string;
  placeholder: string;
  defaultValue?: boolean | string;
  type: CustomFieldTypes;
  values?: string;
  required: boolean;
  index?: boolean;
  owner?: string;
  projects?: string[];
  section: CustomFieldSection;
  dateCreated: string | Date;
  dateUpdated: string | Date;
};

export type CustomFieldsInterface = {
  id: string;
  organization: string;
  fields: CustomField[];
};

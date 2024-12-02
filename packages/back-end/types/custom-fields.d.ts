import { CreateProps } from "back-end/src/models/BaseModel";

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

export type CustomFieldSection = "experiment" | "feature";

export type CustomField = {
  id: string;
  name: string;
  description?: string;
  placeholder?: string;
  defaultValue?: boolean | string;
  type: CustomFieldTypes;
  values?: string;
  required: boolean;
  index?: boolean;
  creator?: string;
  projects?: string[];
  section: CustomFieldSection;
  dateCreated: Date;
  dateUpdated: Date;
  active?: boolean;
};

export type CustomFieldsInterface = {
  id: string;
  organization: string;
  fields: CustomField[];
};

export type CreateCustomFieldsProps = CreateProps<CustomFieldsInterface>;

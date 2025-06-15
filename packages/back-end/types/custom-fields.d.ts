import { z } from "zod/v4";
import { CreateProps } from "back-end/src/models/BaseModel";
import {
  customFieldTypes,
  customFieldSectionTypes,
  customFieldsPropsValidator,
  customFieldsValidator,
} from "back-end/src/routers/custom-fields/custom-fields.validators";

export type CustomFieldTypes = z.infer<typeof customFieldTypes>;

export type CustomFieldSection = z.infer<typeof customFieldSectionTypes>;

export type CustomField = z.infer<typeof customFieldsPropsValidator>;

export type CustomFieldsInterface = z.infer<typeof customFieldsValidator>;

export type CreateCustomFieldProps = CreateProps<CustomField>;

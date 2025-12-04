import { z } from "zod";
import { CreateProps } from "shared/types/baseModel";
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

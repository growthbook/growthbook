import { z } from "zod";
import {
  customFieldTypes,
  customFieldSectionTypes,
  customFieldsPropsValidator,
  customFieldsValidator,
} from "shared/validators";
import { CreateProps } from "shared/types/base-model";

export type CustomFieldTypes = z.infer<typeof customFieldTypes>;

export type CustomFieldSection = z.infer<typeof customFieldSectionTypes>;

export type CustomField = z.infer<typeof customFieldsPropsValidator>;

export type CustomFieldsInterface = z.infer<typeof customFieldsValidator>;

export type CreateCustomFieldProps = CreateProps<CustomField>;

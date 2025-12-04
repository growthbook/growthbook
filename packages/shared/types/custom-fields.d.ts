import { z } from "zod";
import { CreateProps } from "shared/types/base-model";
import {
  customFieldTypes,
  customFieldSectionTypes,
  customFieldsPropsValidator,
  customFieldsValidator,
} from "shared/src/validators/custom-fields";

export type CustomFieldTypes = z.infer<typeof customFieldTypes>;

export type CustomFieldSection = z.infer<typeof customFieldSectionTypes>;

export type CustomField = z.infer<typeof customFieldsPropsValidator>;

export type CustomFieldsInterface = z.infer<typeof customFieldsValidator>;

export type CreateCustomFieldProps = CreateProps<CustomField>;

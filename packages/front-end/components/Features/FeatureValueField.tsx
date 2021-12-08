import { UseFormReturn } from "react-hook-form";
import { FeatureValueType } from "back-end/types/feature";
import Field from "../Forms/Field";
import Toggle from "../Forms/Toggle";

export interface Props {
  valueType: FeatureValueType;
  label: string;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  field: string;
  helpText?: string;
}

export default function FeatureValueField({
  valueType,
  label,
  form,
  field,
  helpText,
}: Props) {
  return (
    <Field
      label={label}
      {...form.register(field)}
      {...(valueType === "boolean"
        ? {
            render: function BooleanToggle(id) {
              return (
                <div>
                  <Toggle
                    id={id}
                    label=""
                    value={form.watch(field) !== "false"}
                    setValue={(value) =>
                      form.setValue(field, value ? "true" : "false")
                    }
                  />
                </div>
              );
            },
          }
        : valueType === "number"
        ? {
            type: "number",
            step: "any",
            min: "any",
            max: "any",
          }
        : {
            textarea: true,
            minRows: 1,
          })}
      helpText={helpText}
    />
  );
}

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
  type?: string;
}

export default function FeatureValueField({
  valueType,
  label,
  form,
  field,
  helpText,
}: Props) {
  if (valueType === "boolean") {
    return (
      <div className="form-group">
        <label>{label}</label>
        <div>
          <Toggle
            id={field + "__toggle"}
            value={form.watch(field) === "true"}
            setValue={(v) => {
              form.setValue(field, v ? "true" : "false");
            }}
            type="featureValue"
          />
          <span className="text-muted pl-2">
            <strong>{form.watch(field) === "true" ? "on" : "off"}</strong>
          </span>
        </div>
      </div>
    );
  }

  return (
    <Field
      label={label}
      {...form.register(field)}
      {...(valueType === "number"
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

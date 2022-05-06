import { UseFormReturn } from "react-hook-form";
import { FeatureValueType } from "back-end/types/feature";
import Field from "../Forms/Field";

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
  if (valueType === "boolean") {
    return (
      <div className="form-group">
        <label>{label}</label>
        <div>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              {...form.register(field)}
              id={field + "__off"}
              value="false"
            />
            <label className="form-check-label" htmlFor={field + "__off"}>
              OFF
            </label>
          </div>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              {...form.register(field)}
              id={field + "__on"}
              value="true"
            />
            <label className="form-check-label" htmlFor={field + "__on"}>
              ON
            </label>
          </div>
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

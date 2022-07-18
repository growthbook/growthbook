import { FeatureValueType } from "back-end/types/feature";
import Field from "../Forms/Field";
import Toggle from "../Forms/Toggle";

export interface Props {
  valueType: FeatureValueType;
  label: string;
  value: string;
  setValue: (v: string) => void;
  id: string;
  helpText?: string;
  type?: string;
  placeholder?: string;
}

export default function FeatureValueField({
  valueType,
  label,
  value,
  setValue,
  id,
  helpText,
  placeholder,
}: Props) {
  if (valueType === "boolean") {
    return (
      <div className="form-group">
        <label>{label}</label>
        <div>
          <Toggle
            id={id + "__toggle"}
            value={value === "true"}
            setValue={(v) => {
              setValue(v ? "true" : "false");
            }}
            type="featureValue"
          />
          <span className="text-muted pl-2">
            <strong>{value === "true" ? "on" : "off"}</strong>
          </span>
        </div>
      </div>
    );
  }

  return (
    <Field
      label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        setValue(e.target.value);
      }}
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

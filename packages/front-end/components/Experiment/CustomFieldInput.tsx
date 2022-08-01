import { FC } from "react";
import { CustomField } from "back-end/types/organization";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Field from "../Forms/Field";
import { UseFormReturn } from "react-hook-form";
import SelectField from "../Forms/SelectField";
import MultiSelectField from "../Forms/MultiSelectField";
import Toggle from "../Forms/Toggle";

const CustomFieldInput: FC<{
  customFields: CustomField[];
  form: UseFormReturn<Partial<ExperimentInterfaceStringDates>>;
  className?: string;
}> = ({ customFields, className, form }) => {
  return (
    <>
      <div className={className}>
        {customFields.map((v, i) => {
          return (
            <div key={i}>
              {v.type === "boolean" ? (
                <div className="mb-3 mt-3">
                  <Toggle
                    id="bool"
                    value={
                      form.watch(`customFields.${i}.fieldValue`) === "true"
                    }
                    setValue={(t) => {
                      form.setValue(
                        `customFields.${i}.fieldValue`,
                        JSON.stringify(t)
                      );
                      form.setValue(`customFields.${i}.fieldId`, v.id);
                    }}
                  />
                  <label htmlFor="bool">{v.name}</label>
                  {v.description && (
                    <div>
                      <small className="text-muted">{v.description}</small>
                    </div>
                  )}
                </div>
              ) : v.type === "enum" ? (
                <SelectField
                  label={v.name}
                  value={form.watch(`customFields.${i}.fieldValue`)}
                  options={v.values
                    .split(",")
                    .map((k) => k.trim())
                    .map((j) => ({ value: j, label: j }))}
                  onChange={(s) => {
                    form.setValue(`customFields.${i}.fieldValue`, s);
                    form.setValue(`customFields.${i}.fieldId`, v.id);
                  }}
                  helpText={v.description}
                />
              ) : v.type === "multiselect" ? (
                <MultiSelectField
                  label={v.name}
                  value={
                    form.watch(`customFields.${i}.fieldValue`)
                      ? JSON.parse(form.watch(`customFields.${i}.fieldValue`))
                      : []
                  }
                  options={v.values
                    .split(",")
                    .map((k) => k.trim())
                    .map((j) => ({ value: j, label: j }))}
                  onChange={(values) => {
                    form.setValue(
                      `customFields.${i}.fieldValue`,
                      JSON.stringify(values)
                    );
                    form.setValue(`customFields.${i}.fieldId`, v.id);
                  }}
                  helpText={v.description}
                />
              ) : v.type === "textarea" ? (
                <Field
                  textarea
                  minRows={2}
                  maxRows={6}
                  value={form.watch(`customFields.${i}.fieldValue`)}
                  label={v.name}
                  type={v.type}
                  required={v.required}
                  onChange={(e) => {
                    form.setValue(
                      `customFields.${i}.fieldValue`,
                      e.target.value
                    );
                    form.setValue(`customFields.${i}.fieldId`, v.id);
                  }}
                  helpText={v.description}
                />
              ) : (
                <Field
                  value={form.watch(`customFields.${i}.fieldValue`)}
                  label={v.name}
                  type={v.type}
                  required={v.required}
                  onChange={(e) => {
                    form.setValue(
                      `customFields.${i}.fieldValue`,
                      e.target.value
                    );
                    form.setValue(`customFields.${i}.fieldId`, v.id);
                  }}
                  helpText={v.description}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default CustomFieldInput;

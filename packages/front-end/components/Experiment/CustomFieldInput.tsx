import { FC } from "react";
import { CustomField, CustomFieldSection } from "back-end/types/organization";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { UseFormReturn } from "react-hook-form";
import { filterCustomFieldsForSectionAndProject } from "@/services/experiments";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import MultiSelectField from "../Forms/MultiSelectField";
import Toggle from "../Forms/Toggle";

const CustomFieldInput: FC<{
  customFields: CustomField[];
  form: UseFormReturn<Partial<ExperimentInterfaceStringDates>>;
  section: CustomFieldSection;
  project?: string;
  className?: string;
}> = ({ customFields, project, className, form, section }) => {
  const availableFields = filterCustomFieldsForSectionAndProject(
    customFields,
    section,
    project
  );
  return (
    <>
      <div className={className}>
        {!availableFields?.length ? (
          <div className="p-3 text-center">
            No fields available for this experiment or project
          </div>
        ) : (
          <>
            {availableFields.map((v, i) => {
              return (
                <div key={i}>
                  {v.type === "boolean" ? (
                    <div className="mb-3 mt-3">
                      <Toggle
                        id="bool"
                        value={form.watch(`customFields.${v.id}`) === "true"}
                        setValue={(t) => {
                          form.setValue(
                            `customFields.${v.id}`,
                            JSON.stringify(t)
                          );
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
                      value={form.watch(`customFields.${v.id}`)}
                      options={v.values
                        .split(",")
                        .map((k) => k.trim())
                        .map((j) => ({ value: j, label: j }))}
                      onChange={(s) => {
                        form.setValue(`customFields.${v.id}`, s);
                      }}
                      helpText={v.description}
                    />
                  ) : v.type === "multiselect" ? (
                    <MultiSelectField
                      label={v.name}
                      value={
                        form.watch(`customFields.${v.id}`)
                          ? JSON.parse(form.watch(`customFields.${v.id}`))
                          : []
                      }
                      options={v.values
                        .split(",")
                        .map((k) => k.trim())
                        .map((j) => ({ value: j, label: j }))}
                      onChange={(values) => {
                        form.setValue(
                          `customFields.${v.id}`,
                          JSON.stringify(values)
                        );
                      }}
                      helpText={v.description}
                    />
                  ) : v.type === "textarea" ? (
                    <Field
                      textarea
                      minRows={2}
                      maxRows={6}
                      value={form.watch(`customFields.${v.id}`)}
                      label={v.name}
                      type={v.type}
                      required={v.required}
                      onChange={(e) => {
                        form.setValue(`customFields.${v.id}`, e.target.value);
                      }}
                      helpText={v.description}
                    />
                  ) : (
                    <Field
                      value={form.watch(`customFields.${v.id}`)}
                      label={v.name}
                      type={v.type}
                      required={v.required}
                      onChange={(e) => {
                        form.setValue(`customFields.${v.id}`, e.target.value);
                      }}
                      helpText={v.description}
                    />
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
};

export default CustomFieldInput;

import { FC } from "react";
import { CustomField, CustomFieldSection } from "back-end/types/custom-fields";
import { UseFormReturn } from "react-hook-form";
import { filterCustomFieldsForSectionAndProject } from "@/hooks/useCustomFields";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import MultiSelectField from "../Forms/MultiSelectField";
import Toggle from "../Forms/Toggle";

const CustomFieldInput: FC<{
  customFields: CustomField[];
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  section: CustomFieldSection;
  project?: string;
  className?: string;
}> = ({ customFields, project, className, form, section }) => {
  const availableFields = filterCustomFieldsForSectionAndProject(
    customFields,
    section,
    project
  );

  let currentCustomFields = {};
  try {
    const customFieldStrings = form.watch("customFields");
    currentCustomFields = customFieldStrings
      ? JSON.parse(customFieldStrings)
      : {};
  } catch (e) {
    console.error(e);
  }
  const updateCustomField = (name, value) => {
    currentCustomFields[name] = value;
    form.setValue("customFields", JSON.stringify(currentCustomFields));
  };

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
                        value={
                          currentCustomFields?.[v.id]
                            ? currentCustomFields[v.id] === "true"
                            : false
                        }
                        setValue={(t) => {
                          updateCustomField(v.id, "" + JSON.stringify(t));
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
                      value={
                        currentCustomFields?.[v.id] ?? v?.defaultValue ?? ""
                      }
                      options={
                        v.values
                          ? v.values
                              .split(",")
                              .map((k) => k.trim())
                              .map((j) => ({ value: j, label: j }))
                          : []
                      }
                      onChange={(s) => {
                        updateCustomField(v.id, s);
                      }}
                      helpText={v.description}
                    />
                  ) : v.type === "multiselect" ? (
                    <MultiSelectField
                      label={v.name}
                      value={
                        currentCustomFields?.[v.id]
                          ? JSON.parse(currentCustomFields[v.id])
                          : []
                      }
                      options={
                        v.values
                          ? v.values
                              .split(",")
                              .map((k) => k.trim())
                              .map((j) => ({ value: j, label: j }))
                          : []
                      }
                      onChange={(values) => {
                        updateCustomField(v.id, JSON.stringify(values));
                      }}
                      helpText={v.description}
                    />
                  ) : v.type === "textarea" ? (
                    <Field
                      textarea
                      minRows={2}
                      maxRows={6}
                      value={currentCustomFields?.[v.id] ?? ""}
                      label={v.name}
                      type={v.type}
                      required={v.required}
                      onChange={(e) => {
                        updateCustomField(v.id, e.target.value);
                      }}
                      helpText={v.description}
                    />
                  ) : (
                    <Field
                      value={currentCustomFields?.[v.id] ?? ""}
                      label={v.name}
                      type={v.type}
                      required={v.required}
                      onChange={(e) => {
                        updateCustomField(v.id, e.target.value);
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

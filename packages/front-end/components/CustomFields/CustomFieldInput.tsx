import { FC, useEffect, useState } from "react";
import { CustomField, CustomFieldSection } from "back-end/types/custom-fields";
import Switch from "@/ui/Switch";
import { filterCustomFieldsForSectionAndProject } from "@/hooks/useCustomFields";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";

const CustomFieldInput: FC<{
  customFields: CustomField[];
  currentCustomFields: Record<string, string>;
  section: CustomFieldSection;
  setCustomFields: (customFields: Record<string, string>) => void;
  project?: string;
  className?: string;
}> = ({
  customFields,
  currentCustomFields = {},
  project,
  className,
  section,
  setCustomFields,
}) => {
  const availableFields = filterCustomFieldsForSectionAndProject(
    customFields,
    section,
    project,
  );
  const [loadedDefaults, setLoadedDefaults] = useState(false);

  // todo: investigate further: sometimes custom fields are incorrectly provided as strings (e.g. duplicate exp)
  if (typeof currentCustomFields === "string") {
    try {
      currentCustomFields = JSON.parse(currentCustomFields);
    } catch (e) {
      currentCustomFields = {};
    }
  }

  useEffect(() => {
    if (!loadedDefaults) {
      // here we are setting the default values in the form, otherwise
      // boolean/toggles or inputs with default values will not be saved.
      if (availableFields) {
        availableFields.forEach((v) => {
          if (!currentCustomFields?.[v.id] && v.defaultValue) {
            if (v.type === "multiselect") {
              currentCustomFields[v.id] = JSON.stringify([v.defaultValue]);
            } else {
              currentCustomFields[v.id] = v.defaultValue;
            }

            if (v.type === "boolean") {
              currentCustomFields[v.id] = "" + JSON.stringify(v.defaultValue);
            }
          }
        });
        setCustomFields(currentCustomFields);
        setLoadedDefaults(true);
      }
    }
  }, [availableFields, loadedDefaults, currentCustomFields, setCustomFields]);

  const updateCustomField = (name, value) => {
    setCustomFields({ ...currentCustomFields, [name]: value });
  };

  const getMultiSelectValue = (value) => {
    if (value) {
      try {
        return JSON.parse(value);
      } catch (e) {
        return [];
      }
    }
    return value;
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
                      <Switch
                        id="bool"
                        mr="3"
                        value={
                          currentCustomFields?.[v.id]
                            ? currentCustomFields[v.id] === "true"
                            : false
                        }
                        onChange={(t) => {
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
                      label={
                        <>
                          {v.name}
                          {v.required && (
                            <span className="text-danger ml-1">*</span>
                          )}
                        </>
                      }
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
                      label={
                        <>
                          {v.name}
                          {v.required && (
                            <span className="text-danger ml-1">*</span>
                          )}
                        </>
                      }
                      value={
                        currentCustomFields?.[v.id]
                          ? getMultiSelectValue(currentCustomFields[v.id])
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
                      label={
                        <>
                          {v.name}
                          {v.required && (
                            <span className="text-danger ml-1">*</span>
                          )}
                        </>
                      }
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
                      label={
                        <>
                          {v.name}
                          {v.required && (
                            <span className="text-danger ml-1">*</span>
                          )}
                        </>
                      }
                      type={v.type}
                      required={v.required}
                      placeholder={v?.placeholder ?? ""}
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

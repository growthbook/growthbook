import { FC, useEffect, useState } from "react";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { Flex, Box, Text } from "@radix-ui/themes";
import { filterCustomFieldsForSectionAndProject } from "@/hooks/useCustomFields";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import DatePicker from "@/components/DatePicker";
import Link from "@/ui/Link";
import Checkbox from "@/ui/Checkbox";

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
    <Flex direction="column" gap="6" my="2" className={className}>
      {!availableFields?.length ? (
        <Text align="center" color="gray">
          No fields available for this experiment or project
        </Text>
      ) : (
        <>
          {availableFields.map((v, i) => {
            return (
              <Box key={i}>
                {v.type === "boolean" ? (
                  <Checkbox
                    id={`bool-${v.id}`}
                    label={v.name}
                    description={v.description}
                    value={
                      currentCustomFields?.[v.id]
                        ? currentCustomFields[v.id] === "true"
                        : false
                    }
                    setValue={(t) => {
                      updateCustomField(v.id, "" + JSON.stringify(t));
                    }}
                  />
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
                    containerClassName="mb-0"
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
                    containerClassName="mb-0"
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
                    containerClassName="mb-0"
                  />
                ) : v.type === "date" || v.type === "datetime" ? (
                  <Box>
                    <DatePicker
                      date={currentCustomFields?.[v.id] || undefined}
                      setDate={(d) => {
                        updateCustomField(v.id, d?.toISOString() ?? "");
                      }}
                      label={
                        <>
                          {v.name}
                          {v.required && (
                            <span className="text-danger ml-1">*</span>
                          )}
                        </>
                      }
                      precision={v.type === "datetime" ? "datetime" : "date"}
                      containerClassName="mb-0"
                    />
                    {(v.description || (!v.required && currentCustomFields?.[v.id])) && (
                      <Flex justify="between" align="start" mt="1">
                        {v.description ? (
                          <Text size="1" color="gray">
                            {v.description}
                          </Text>
                        ) : (
                          <Box />
                        )}
                        {!v.required && currentCustomFields?.[v.id] && (
                          <Link
                            onClick={() => updateCustomField(v.id, "")}
                            color="gray"
                            size="1"
                          >
                            Clear
                          </Link>
                        )}
                      </Flex>
                    )}
                  </Box>
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
                    containerClassName="mb-0"
                  />
                )}
              </Box>
            );
          })}
        </>
      )}
    </Flex>
  );
};

export default CustomFieldInput;

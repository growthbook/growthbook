import { FC, useEffect, useMemo, useState } from "react";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { Flex, Box } from "@radix-ui/themes";
import { filterCustomFieldsForSectionAndProject } from "@/hooks/useCustomFields";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import DatePicker from "@/components/DatePicker";
import Link from "@/ui/Link";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";

const CustomFieldInput: FC<{
  customFields: CustomField[];
  currentCustomFields: Record<string, string>;
  section: CustomFieldSection;
  setCustomFields: (customFields: Record<string, string>) => void;
  project: string | undefined;
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
  const normalizedCustomFields = useMemo<Record<string, string>>(() => {
    // todo: investigate further: sometimes custom fields are incorrectly provided as strings (e.g. duplicate exp)
    if (typeof currentCustomFields === "string") {
      try {
        return JSON.parse(currentCustomFields);
      } catch (e) {
        return {};
      }
    }

    return currentCustomFields;
  }, [currentCustomFields]);

  useEffect(() => {
    if (!loadedDefaults) {
      // here we are setting the default values in the form, otherwise
      // boolean/toggles or inputs with default values will not be saved.
      if (availableFields) {
        const nextCustomFields = { ...normalizedCustomFields };
        availableFields.forEach((v) => {
          const currentValue = nextCustomFields?.[v.id];
          const missingCurrentValue =
            currentValue === undefined ||
            currentValue === null ||
            currentValue === "";
          const hasDefaultValue =
            v.defaultValue !== undefined &&
            v.defaultValue !== null &&
            (Array.isArray(v.defaultValue)
              ? v.defaultValue.length > 0
              : v.defaultValue !== "");

          if (missingCurrentValue && hasDefaultValue) {
            if (v.type === "multiselect") {
              nextCustomFields[v.id] = Array.isArray(v.defaultValue)
                ? JSON.stringify(v.defaultValue)
                : JSON.stringify([v.defaultValue]);
            } else if (v.type === "boolean") {
              const normalizedDefault =
                typeof v.defaultValue === "boolean"
                  ? v.defaultValue
                  : String(v.defaultValue).toLowerCase() === "true";
              nextCustomFields[v.id] = String(normalizedDefault);
            } else {
              nextCustomFields[v.id] = String(v.defaultValue);
            }
          }
        });
        setCustomFields(nextCustomFields);
        setLoadedDefaults(true);
      }
    }
  }, [
    availableFields,
    loadedDefaults,
    normalizedCustomFields,
    setCustomFields,
  ]);

  // Clear previously set fields if they change so we don't send
  // fields that are not accepted when changing projects for example
  useEffect(() => {
    if (!availableFields) return;

    const allowedFields = new Set(availableFields.map((v) => v.id));
    const currentEntries = Object.entries(normalizedCustomFields);
    const filteredEntries = currentEntries.filter(([key]) =>
      allowedFields.has(key),
    );

    // Only update when we actually need to remove disallowed keys.
    if (filteredEntries.length !== currentEntries.length) {
      setCustomFields(Object.fromEntries(filteredEntries));
    }
  }, [availableFields, normalizedCustomFields, setCustomFields]);

  const updateCustomField = (name, value) => {
    setCustomFields({ ...normalizedCustomFields, [name]: value });
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
                      normalizedCustomFields?.[v.id]
                        ? normalizedCustomFields[v.id] === "true"
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
                      normalizedCustomFields?.[v.id] ?? v?.defaultValue ?? ""
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
                    required={v.required}
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
                      normalizedCustomFields?.[v.id]
                        ? getMultiSelectValue(normalizedCustomFields[v.id])
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
                    required={v.required}
                    containerClassName="mb-0"
                  />
                ) : v.type === "textarea" ? (
                  <Field
                    textarea
                    minRows={2}
                    maxRows={6}
                    value={normalizedCustomFields?.[v.id] ?? ""}
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
                      date={normalizedCustomFields?.[v.id] || undefined}
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
                    {(v.description ||
                      (!v.required && normalizedCustomFields?.[v.id])) && (
                      <Flex justify="between" align="start" mt="1">
                        {v.description ? (
                          <Text size="1" color="gray">
                            {v.description}
                          </Text>
                        ) : (
                          <Box />
                        )}
                        {!v.required && normalizedCustomFields?.[v.id] && (
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
                    value={normalizedCustomFields?.[v.id] ?? ""}
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

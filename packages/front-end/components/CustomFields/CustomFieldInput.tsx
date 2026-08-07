import { FC, useEffect, useMemo, useRef } from "react";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { Flex, Box } from "@radix-ui/themes";
import { filterCustomFieldsForSectionAndProject } from "@/hooks/useCustomFields";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import DatePicker from "@/components/DatePicker";
import Link from "@/ui/Link";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import {
  isCustomFieldBooleanTrue,
  toCustomFieldBooleanString,
} from "./constants";

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
  // react-hook-form ignores setValue called synchronously from a child mount
  // effect; seed once after mount instead. Ref avoids re-seeding over user edits.
  const hasSeededDefaults = useRef(false);
  const normalizedCustomFields = useMemo<Record<string, string>>(() => {
    // todo: investigate further: sometimes custom fields are incorrectly provided as strings (e.g. duplicate exp)
    let fields: Record<string, unknown>;
    if (typeof currentCustomFields === "string") {
      try {
        fields = JSON.parse(currentCustomFields);
      } catch {
        fields = {};
      }
    } else {
      fields = currentCustomFields ?? {};
    }

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "boolean") {
        normalized[key] = toCustomFieldBooleanString(value);
      } else if (value === undefined || value === null) {
        normalized[key] = "";
      } else {
        normalized[key] = String(value);
      }
    }
    return normalized;
  }, [currentCustomFields]);

  useEffect(() => {
    if (hasSeededDefaults.current || !availableFields) return;

    const nextCustomFields = { ...normalizedCustomFields };
    let changed = false;

    availableFields.forEach((v) => {
      const currentValue = nextCustomFields[v.id];
      // "false" is a real boolean value — do not treat it as missing
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
          nextCustomFields[v.id] = toCustomFieldBooleanString(
            isCustomFieldBooleanTrue(v.defaultValue),
          );
        } else {
          nextCustomFields[v.id] = String(v.defaultValue);
        }
        changed = true;
      } else if (missingCurrentValue && v.type === "boolean") {
        // Persist unchecked as an explicit "false" so saves include the key
        nextCustomFields[v.id] = "false";
        changed = true;
      }
    });

    hasSeededDefaults.current = true;
    // Defer so parent react-hook-form setValue applies after mount
    queueMicrotask(() => {
      if (changed) {
        setCustomFields(nextCustomFields);
      }
    });
  }, [availableFields, normalizedCustomFields, setCustomFields]);

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

  const updateCustomField = (name: string, value: string) => {
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
        <Text align="center" color="text-low">
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
                    value={isCustomFieldBooleanTrue(
                      normalizedCustomFields?.[v.id],
                    )}
                    setValue={(checked) => {
                      updateCustomField(
                        v.id,
                        toCustomFieldBooleanString(checked),
                      );
                    }}
                  />
                ) : v.type === "enum" ? (
                  <SelectField
                    size="legacy"
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
                    legacyHeight
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
                    size="legacy"
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
                          <Text size="sm" color="text-low">
                            {v.description}
                          </Text>
                        ) : (
                          <Box />
                        )}
                        {!v.required && normalizedCustomFields?.[v.id] && (
                          <Link
                            onClick={() => updateCustomField(v.id, "")}
                            color="gray"
                            size="sm"
                          >
                            Clear
                          </Link>
                        )}
                      </Flex>
                    )}
                  </Box>
                ) : (
                  <Field
                    size="legacy"
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

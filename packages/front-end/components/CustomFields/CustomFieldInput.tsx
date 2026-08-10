import { FC, useEffect, useMemo } from "react";
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

/**
 * The stored string value to seed for a field that has no value yet, or
 * `undefined` when the field has no configured default (leave it unset).
 */
function getSeededDefaultValue(field: CustomField): string | undefined {
  const { defaultValue } = field;
  const hasDefaultValue =
    defaultValue !== undefined &&
    defaultValue !== null &&
    (Array.isArray(defaultValue)
      ? defaultValue.length > 0
      : defaultValue !== "");
  if (!hasDefaultValue) return undefined;

  if (field.type === "multiselect") {
    return Array.isArray(defaultValue)
      ? JSON.stringify(defaultValue)
      : JSON.stringify([defaultValue]);
  }
  if (field.type === "boolean") {
    return toCustomFieldBooleanString(isCustomFieldBooleanTrue(defaultValue));
  }
  return String(defaultValue);
}

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

  // Drop values for fields that no longer apply (e.g. after a project change)
  // and seed configured defaults for fields that don't have a value yet.
  // Re-runs when availableFields change, so switching projects re-seeds the
  // new fields.
  useEffect(() => {
    if (!availableFields) return;

    const reconciled: Record<string, string> = {};
    for (const v of availableFields) {
      const currentValue = normalizedCustomFields[v.id];
      // "false" is a real value; only "" / missing counts as unset
      if (currentValue !== undefined && currentValue !== "") {
        reconciled[v.id] = currentValue;
        continue;
      }
      const seededDefault = getSeededDefaultValue(v);
      if (seededDefault !== undefined) {
        reconciled[v.id] = seededDefault;
      } else if (v.type === "boolean") {
        // Booleans always serialize explicitly, so unchecked saves as "false"
        reconciled[v.id] = "false";
      }
    }

    const changed =
      Object.keys(reconciled).length !==
        Object.keys(normalizedCustomFields).length ||
      Object.entries(reconciled).some(
        ([key, value]) => normalizedCustomFields[key] !== value,
      );
    if (!changed) return;

    // Defer so parent react-hook-form setValue applies after mount
    queueMicrotask(() => setCustomFields(reconciled));
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

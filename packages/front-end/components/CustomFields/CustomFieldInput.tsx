import { FC } from "react";
import { CustomField } from "shared/types/custom-fields";
import { Flex, Box } from "@radix-ui/themes";
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
  fields: CustomField[];
  value: Record<string, string>;
  onChange: (customFields: Record<string, string>) => void;
  className?: string;
}> = ({ fields, value, onChange, className }) => {
  const updateCustomField = (name: string, fieldValue: string) => {
    onChange({ ...value, [name]: fieldValue });
  };

  const getMultiSelectValue = (raw: string) => {
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return [];
      }
    }
    return raw;
  };

  return (
    <Flex direction="column" gap="6" my="2" className={className}>
      {!fields.length ? (
        <Text align="center" color="text-low">
          No fields available for this experiment or project
        </Text>
      ) : (
        <>
          {fields.map((v, i) => {
            return (
              <Box key={i}>
                {v.type === "boolean" ? (
                  <Checkbox
                    id={`bool-${v.id}`}
                    label={v.name}
                    description={v.description}
                    value={isCustomFieldBooleanTrue(value[v.id])}
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
                    value={value[v.id] ?? v.defaultValue ?? ""}
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
                    value={value[v.id] ? getMultiSelectValue(value[v.id]) : []}
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
                    value={value[v.id] ?? ""}
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
                      date={value[v.id] || undefined}
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
                    {(v.description || (!v.required && value[v.id])) && (
                      <Flex justify="between" align="start" mt="1">
                        {v.description ? (
                          <Text size="sm" color="text-low">
                            {v.description}
                          </Text>
                        ) : (
                          <Box />
                        )}
                        {!v.required && value[v.id] && (
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
                    value={value[v.id] ?? ""}
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
                    placeholder={v.placeholder ?? ""}
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

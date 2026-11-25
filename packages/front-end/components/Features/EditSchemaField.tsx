import { FeatureValueType, SchemaField } from "shared/types/feature";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { useLingui } from "@lingui/react/macro";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import Checkbox from "@/ui/Checkbox";

// TODO: enable this when we have a GUI for entering feature values based on the schema
const SUPPORTS_DEFAULT_VALUES = false;

// Per-field editor for a single SimpleSchema field (key, type, description,
// required, enum, min/max). Shared by the feature schema modal and the config
// editor so both author schema fields the same way.
export default function EditSchemaField({
  i,
  value,
  inObject,
  onChange,
  valueType,
  hideKey = false,
  hideType = false,
  hideRequired = false,
  allowNullable = false,
}: {
  i: number;
  value: SchemaField;
  inObject: boolean;
  onChange: (value: SchemaField) => void;
  valueType?: FeatureValueType;
  // The config editor keeps key + type on its own aligned row, so it can hide
  // those inputs here and reuse the rest (description, required, enum, min/max).
  hideKey?: boolean;
  hideType?: boolean;
  // Config fields are always required (present in the resolved object), so the
  // Required toggle is hidden there.
  hideRequired?: boolean;
  // Configs support nullable fields (value may be null); features don't, so the
  // Nullable toggle is opt-in.
  allowNullable?: boolean;
}) {
  const { t } = useLingui();
  // String features only have 1 type option, so hide the selector
  const hideTypeSelector = valueType === "string" || hideType;
  const allTypeOptions = [
    { value: "string", label: t`Text String` },
    { value: "integer", label: t`Integer` },
    { value: "float", label: t`Float (Decimal)` },
    { value: "boolean", label: t`Boolean (True/False)` },
  ];
  const typeOptions =
    valueType === "number"
      ? allTypeOptions.filter((o) => ["integer", "float"].includes(o.value))
      : allTypeOptions;
  const showKey = inObject && !hideKey;
  return (
    <div>
      {(showKey || !hideTypeSelector) && (
        <Flex gap="3">
          {showKey && (
            <Box flexGrow="1" flexBasis="0">
              <Field
                label={t`Property Key`}
                value={value.key}
                onChange={(e) => onChange({ ...value, key: e.target.value })}
                required
                maxLength={64}
              />
            </Box>
          )}
          {!hideTypeSelector && (
            <Box flexGrow="1" flexBasis="0">
              <SelectField
                label={t`Type`}
                value={value.type}
                onChange={(type) =>
                  onChange({ ...value, type: type as SchemaField["type"] })
                }
                sort={false}
                options={typeOptions}
                required
              />
            </Box>
          )}
        </Flex>
      )}
      <Field
        label={t`Description`}
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
        maxLength={256}
      />
      {inObject && (!hideRequired || allowNullable) && (
        <Box mb="3">
          {!hideRequired && (
            <Checkbox
              id={`schema_required_${i}`}
              value={value.required}
              setValue={(v) => onChange({ ...value, required: v })}
              description={t`Check if this property is required`}
              label={t`Required`}
            />
          )}
          {allowNullable && (
            <Checkbox
              id={`schema_nullable_${i}`}
              value={value.nullable === true}
              setValue={(v) => onChange({ ...value, nullable: v })}
              description={t`Allow the value to be null`}
              label={t`Nullable`}
            />
          )}
        </Box>
      )}
      {value.type !== "boolean" && (
        <>
          <MultiSelectField
            label={t`Restrict to Specific Values`}
            placeholder={t`(Optional)`}
            value={value.enum}
            onChange={(e) => {
              if (e.length > 256) return;
              e = e.filter(
                (v) =>
                  v !== "" && v !== null && v !== undefined && v.length <= 256,
              );
              onChange({ ...value, enum: e });
            }}
            options={value.enum.map((v) => ({ value: v, label: v }))}
            creatable
            noMenu
          />
          {value.enum.length === 0 && (
            <Grid columns="2" gap="3">
              <Field
                label={value.type === "string" ? t`Min Length` : t`Minimum`}
                value={value.min}
                max={value.max ?? undefined}
                min={value.type === "string" ? 0 : undefined}
                type="number"
                step={value.type !== "float" ? 1 : "any"}
                onChange={(e) =>
                  onChange({
                    ...value,
                    min:
                      value.type === "float"
                        ? parseFloat(e.target.value)
                        : parseInt(e.target.value),
                  })
                }
              />
              <Field
                label={value.type === "string" ? t`Max Length` : t`Maximum`}
                value={value.max}
                type="number"
                min={value.min ?? undefined}
                max={value.type === "string" ? 256 : undefined}
                step={value.type !== "float" ? 1 : "any"}
                onChange={(e) =>
                  onChange({
                    ...value,
                    max:
                      value.type === "float"
                        ? parseFloat(e.target.value)
                        : parseInt(e.target.value),
                  })
                }
              />
            </Grid>
          )}
        </>
      )}
      {inObject && SUPPORTS_DEFAULT_VALUES && (
        <>
          {value.type === "boolean" ? (
            <SelectField
              label={t`Default Value`}
              sort={false}
              value={
                ["false", ""].includes(value.default) ? value.default : "true"
              }
              onChange={(v) => onChange({ ...value, default: v })}
              options={[
                {
                  value: "true",
                  label: t`True`,
                },
                {
                  value: "false",
                  label: t`False`,
                },
              ]}
              initialOption={t`No Default`}
              required
            />
          ) : value.enum.length > 0 ? (
            <SelectField
              label={t`Default Value`}
              sort={false}
              value={value.default}
              onChange={(v) => onChange({ ...value, default: v })}
              options={value.enum.map((v) => ({ value: v, label: v }))}
              initialOption={t`No Default`}
            />
          ) : (
            <Field
              label={t`Default Value`}
              value={value.default}
              onChange={(e) => onChange({ ...value, default: e.target.value })}
              {...(value.type === "string"
                ? {
                    minLength: value.min,
                    maxLength: value.max,
                  }
                : {
                    type: "number",
                    step: value.type === "float" ? "any" : 1,
                    min: value.min,
                    max: value.max,
                  })}
            />
          )}
        </>
      )}
    </div>
  );
}

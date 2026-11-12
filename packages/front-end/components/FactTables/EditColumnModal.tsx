import { useState } from "react";
import {
  ColumnInterface,
  FactTableColumnType,
  FactTableInterface,
  JSONColumnFields,
  NumberFormat,
  UpdateColumnProps,
} from "shared/types/fact-table";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/settings";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import useSaveFactTableColumn from "@/hooks/useSaveFactTableColumn";
import {
  COLUMN_DATATYPE_OPTIONS,
  getColumnEligibility,
  getColumnRole,
  getSecondaryFilterColumnOptions,
  NUMBER_FORMAT_OPTIONS,
  toConditionalInlineFilters,
} from "@/services/columnEditModel";
import { TextField } from "@/ui/TextField";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";

const JSON_FIELD_DATATYPE_OPTIONS = COLUMN_DATATYPE_OPTIONS.filter(
  (o) => o.value !== "json",
);

// Edits one physical column on the redesigned page: the everyday settings up
// top, the rest under Advanced settings.
export default function EditColumnModal({
  factTable,
  column,
  close,
}: {
  factTable: FactTableInterface;
  column: ColumnInterface;
  close: () => void;
}) {
  const saveColumn = useSaveFactTableColumn(factTable);
  const { hasCommercialFeature, settings } = useUser();
  const maxLevels =
    settings?.maxMetricSliceLevels ?? DEFAULT_MAX_METRIC_SLICE_LEVELS;

  const [description, setDescription] = useState(column.description || "");
  const [datatype, setDatatype] = useState<FactTableColumnType>(
    column.datatype,
  );
  const [numberFormat, setNumberFormat] = useState<NumberFormat>(
    column.numberFormat || "",
  );
  const [filter, setFilter] = useState(!!column.alwaysInlineFilter);
  const [autoSlice, setAutoSlice] = useState(!!column.isAutoSliceColumn);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [name, setName] = useState(
    column.name && column.name !== column.column ? column.name : "",
  );
  const [levels, setLevels] = useState(column.autoSlices || []);
  const [lockedLevels, setLockedLevels] = useState(
    column.lockedAutoSlices || [],
  );
  const [mappings, setMappings] = useState(() =>
    Object.entries(column.conditionalInlineFilters ?? {}).map(
      ([value, column]) => ({ value, column }),
    ),
  );
  const [jsonFields, setJsonFields] = useState<JSONColumnFields>(
    column.jsonFields || {},
  );
  const [newJsonField, setNewJsonField] = useState<{
    key: string;
    datatype: FactTableColumnType;
  }>({ key: "", datatype: "string" });

  // The mapping roles are set in the SQL, so they replace the other settings
  const role = getColumnRole(factTable, column.column);
  const eligibility = getColumnEligibility(factTable, { ...column, datatype });
  const canFilter = eligibility.canFilter;
  const canAutoSlice =
    eligibility.canAutoSlice && hasCommercialFeature("metric-slices");
  // Boolean levels are fixed to true and false
  const showLevels = canAutoSlice && autoSlice && datatype === "string";
  const showMappings = canFilter && filter;

  const topValues = column.topValues || [];
  const mappingColumnOptions = getSecondaryFilterColumnOptions(
    factTable,
    column.column,
  );
  // Only offered when the column has a setting to tuck away
  const hasAdvanced =
    showLevels ||
    (showMappings && mappingColumnOptions.length > 0) ||
    datatype === "json";

  const addJsonField = () => {
    const key = newJsonField.key.trim();
    if (!key) return;
    setJsonFields({
      ...jsonFields,
      [key]: { datatype: newJsonField.datatype },
    });
    setNewJsonField({ ...newJsonField, key: "" });
  };

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header="Edit Column"
      subheader={column.column}
      cta="Save"
      submit={async () => {
        const data: UpdateColumnProps = {
          description,
          name: name.trim() || column.column,
        };
        if (!column.datatype) data.datatype = datatype;
        if (datatype === "number") data.numberFormat = numberFormat;
        if (datatype === "json") data.jsonFields = jsonFields;
        if (canFilter) {
          data.alwaysInlineFilter = filter;
          if (filter) {
            data.conditionalInlineFilters =
              toConditionalInlineFilters(mappings);
          }
        }
        if (canAutoSlice) data.isAutoSliceColumn = autoSlice;
        if (showLevels) {
          // Left empty on a new Auto Slice, the save loads the top values
          data.autoSlices = levels;
          data.lockedAutoSlices = lockedLevels.filter((l) =>
            levels.includes(l),
          );
        }
        await saveColumn(column, data);
      }}
    >
      <Flex direction="column" gap="4">
        <TextField
          label="Display name"
          placeholder={column.column}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="Description"
          placeholder="What this column holds"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {!column.datatype && (
          <SelectField
            label="Data type"
            value={datatype}
            onChange={(v) => setDatatype(v as FactTableColumnType)}
            initialOption="Unknown"
            sort={false}
            options={COLUMN_DATATYPE_OPTIONS}
            containerClassName="mb-0"
          />
        )}

        {role ? (
          <Text as="p" color="text-mid">
            This column is the {role} for this fact table. That mapping is set
            in the SQL.
          </Text>
        ) : datatype === "number" ? (
          <SelectField
            label="Number format"
            value={numberFormat}
            onChange={(v) => setNumberFormat(v as NumberFormat)}
            sort={false}
            options={NUMBER_FORMAT_OPTIONS}
            containerClassName="mb-0"
          />
        ) : null}

        {canFilter && (
          <Checkbox
            label="Filter: always ask for a value when creating metrics"
            value={filter}
            setValue={(v) => setFilter(v === true)}
          />
        )}
        {canAutoSlice && (
          <Checkbox
            label="Auto Slice: break experiment results down by this column"
            value={autoSlice}
            setValue={(v) => setAutoSlice(v === true)}
          />
        )}

        {hasAdvanced && (
          <Box>
            <CollapseTrigger
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
              caret="start"
            >
              <Text weight="semibold">Advanced settings</Text>
            </CollapseTrigger>
            <Collapse open={advancedOpen}>
              <Flex direction="column" gap="4" pt="3">
                {showLevels && (
                  <MultiSelectField
                    label="Auto Slice levels"
                    helpText={`Up to ${maxLevels}. Leave empty to use the column's top values.`}
                    value={levels}
                    options={[...new Set([...topValues, ...levels])].map(
                      (v) => ({
                        label: v,
                        value: v,
                      }),
                    )}
                    creatable
                    placeholder="Select or enter levels..."
                    onChange={(values) => {
                      const next = values.slice(0, maxLevels);
                      // Scheduled updates drop levels that aren't top values
                      // unless they're locked
                      if (factTable.autoSliceUpdatesEnabled) {
                        const added = next.filter(
                          (v) => !levels.includes(v) && !topValues.includes(v),
                        );
                        setLockedLevels([...lockedLevels, ...added]);
                      }
                      setLevels(next);
                    }}
                    containerClassName="mb-0"
                  />
                )}
                {showLevels && factTable.autoSliceUpdatesEnabled && (
                  <MultiSelectField
                    label="Locked levels"
                    helpText="Kept when scheduled Auto Slice updates run."
                    value={lockedLevels.filter((l) => levels.includes(l))}
                    options={levels.map((v) => ({ label: v, value: v }))}
                    onChange={setLockedLevels}
                    containerClassName="mb-0"
                  />
                )}

                {showMappings && mappingColumnOptions.length > 0 && (
                  <Box>
                    <Text as="div" weight="semibold">
                      Secondary filters
                    </Text>
                    <Text as="p" size="sm" color="text-mid" mb="2">
                      When certain values are chosen, ask for an additional
                      filter.
                    </Text>
                    <Flex direction="column" gap="2">
                      {mappings.map((m, i) => (
                        <Flex key={i} gap="2" align="center">
                          <SelectField
                            containerStyle={{ flex: 1, minWidth: 0 }}
                            containerClassName="mb-0"
                            value={m.value}
                            createable
                            onChange={(value) =>
                              setMappings((prev) =>
                                // A value maps once; a duplicate would overwrite on save
                                prev.some(
                                  (x, j) => j !== i && x.value === value,
                                )
                                  ? prev
                                  : prev.map((x, j) =>
                                      j === i ? { ...x, value } : x,
                                    ),
                              )
                            }
                            options={topValues
                              .filter(
                                (v) =>
                                  v === m.value ||
                                  !mappings.some((x) => x.value === v),
                              )
                              .map((v) => ({ label: v, value: v }))}
                            placeholder="Value..."
                          />
                          <Text>→</Text>
                          <SelectField
                            containerStyle={{ flex: 1, minWidth: 0 }}
                            containerClassName="mb-0"
                            value={m.column}
                            onChange={(value) =>
                              setMappings((prev) =>
                                prev.map((x, j) =>
                                  j === i ? { ...x, column: value } : x,
                                ),
                              )
                            }
                            options={mappingColumnOptions}
                            placeholder="Filter on..."
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Remove"
                            onClick={() =>
                              setMappings((prev) =>
                                prev.filter((_, j) => j !== i),
                              )
                            }
                          >
                            <PiX />
                          </Button>
                        </Flex>
                      ))}
                      {mappings.every((m) => m.value && m.column) && (
                        <Flex>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<PiPlus />}
                            onClick={() =>
                              setMappings((prev) => [
                                ...prev,
                                { value: "", column: "" },
                              ])
                            }
                          >
                            Add value
                          </Button>
                        </Flex>
                      )}
                    </Flex>
                  </Box>
                )}

                {datatype === "json" && (
                  <Box>
                    <Text as="div" weight="semibold">
                      JSON fields
                    </Text>
                    <Text as="p" size="sm" color="text-mid" mb="2">
                      Detected from recent rows on each refresh. Add fields the
                      detection missed.
                    </Text>
                    <Flex direction="column" gap="2">
                      {Object.entries(jsonFields).map(([key, field]) => (
                        <Flex key={key} gap="2" align="center">
                          <Box flexGrow="1">
                            <Text>{key}</Text>
                          </Box>
                          <Text color="text-mid">{field.datatype}</Text>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${key}`}
                            onClick={() => {
                              const next = { ...jsonFields };
                              delete next[key];
                              setJsonFields(next);
                            }}
                          >
                            <PiX />
                          </Button>
                        </Flex>
                      ))}
                      <Flex gap="2" align="center">
                        <Box flexGrow="1">
                          <TextField
                            placeholder="Field key"
                            aria-label="New JSON field key"
                            value={newJsonField.key}
                            onChange={(e) =>
                              setNewJsonField({
                                ...newJsonField,
                                key: e.target.value,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addJsonField();
                              }
                            }}
                          />
                        </Box>
                        <SelectField
                          containerStyle={{ minWidth: 140 }}
                          containerClassName="mb-0"
                          value={newJsonField.datatype}
                          onChange={(v) =>
                            setNewJsonField({
                              ...newJsonField,
                              datatype: v as FactTableColumnType,
                            })
                          }
                          sort={false}
                          options={JSON_FIELD_DATATYPE_OPTIONS}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!newJsonField.key.trim()}
                          onClick={addJsonField}
                        >
                          Add field
                        </Button>
                      </Flex>
                    </Flex>
                  </Box>
                )}
              </Flex>
            </Collapse>
          </Box>
        )}
      </Flex>
    </ModalStandard>
  );
}

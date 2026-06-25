import React from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiPencilSimpleFill } from "react-icons/pi";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import SelectField from "@/components/Forms/SelectField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import ValueDisplay from "@/components/Features/ValueDisplay";
import {
  FIELD_COLS,
  ResolvedField,
  fieldTypeLabel,
  fieldValueType,
  typeDefault,
  valueToDisplayString,
} from "@/components/Configs/fieldSchema";

// A single resolved field row in the Form tab: key + value (read or inline
// edit) + type + source provenance + per-row actions. Owned fields also expose
// schema edit/delete in the overflow menu.
export default function ConfigFieldRow({
  field: f,
  configKey,
  isOwnField,
  canEditInline,
  constantContext,
  squashConstants,
  editing,
  editText,
  editKind,
  editError,
  setEditText,
  setEditKind,
  onStartEdit,
  onSubmit,
  onCancelEdit,
  onEditDefinition,
  onDeleteDefinition,
}: {
  field: ResolvedField;
  configKey: string;
  isOwnField: boolean;
  canEditInline: boolean;
  constantContext: { project?: string; excludeKeys?: string[] };
  // Recursively resolves `@const:` references for the read-only display only.
  squashConstants: (value: unknown) => unknown;
  editing: boolean;
  editText: string;
  editKind: "value" | "null";
  editError: string | null;
  setEditText: (v: string) => void;
  setEditKind: (k: "value" | "null") => void;
  onStartEdit: () => void;
  onSubmit: () => void;
  onCancelEdit: () => void;
  onEditDefinition: () => void;
  onDeleteDefinition: () => void;
}): React.ReactElement {
  const here = f.source === configKey;

  return (
    <Flex
      gap="2"
      align="start"
      py="2"
      px="3"
      style={{ borderBottom: "1px solid var(--slate-a3)" }}
    >
      <Box
        style={{
          width: FIELD_COLS.key,
          flexShrink: 0,
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        <Flex align="center" style={{ minHeight: 32 }}>
          <Box>
            {f.key}
            {f.field?.description && (
              <Text as="div" size="small" color="text-low">
                {f.field.description}
              </Text>
            )}
          </Box>
        </Flex>
      </Box>
      <Box
        style={{
          width: FIELD_COLS.value,
          flexShrink: 0,
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        <Flex align="center" style={{ minHeight: 32 }}>
          <Box style={{ width: "100%", minWidth: 0 }}>
            {editing ? (
              <>
                {(() => {
                  const nullable = f.field?.nullable === true;
                  const isNull = editKind === "null";
                  const vt = fieldValueType(f.field);
                  return (
                    <>
                      {vt === "boolean" ? (
                        <SelectField
                          value={editText}
                          onChange={setEditText}
                          options={[
                            { value: "true", label: "true" },
                            { value: "false", label: "false" },
                          ]}
                          initialOption="value…"
                          sort={false}
                          disabled={isNull}
                        />
                      ) : (
                        <FeatureValueField
                          id={`config-value-${f.key}`}
                          value={isNull ? "" : editText}
                          setValue={setEditText}
                          valueType={vt}
                          useCodeInput={vt === "json"}
                          showFullscreenButton={vt === "json"}
                          constantContext={constantContext}
                          disabled={isNull}
                        />
                      )}
                      {nullable && (
                        <Box mt="1">
                          <Checkbox
                            size="sm"
                            label="null"
                            value={isNull}
                            setValue={(v) => {
                              setEditKind(v ? "null" : "value");
                              if (v) setEditText("");
                            }}
                          />
                        </Box>
                      )}
                    </>
                  );
                })()}
                {editError && (
                  <Text size="small" color="text-mid">
                    {editError}
                  </Text>
                )}
              </>
            ) : f.value === undefined ? (
              <Text color="text-low">
                <code>{JSON.stringify(typeDefault(f.field))}</code> (default)
              </Text>
            ) : f.value === null ? (
              <ValueDisplay value="null" type="json" />
            ) : (
              (() => {
                const vt = fieldValueType(f.field);
                return (
                  <ValueDisplay
                    value={valueToDisplayString(squashConstants(f.value), vt)}
                    type={vt}
                    showFullscreenButton={vt === "json"}
                  />
                );
              })()
            )}
          </Box>
        </Flex>
      </Box>
      <Box style={{ width: FIELD_COLS.type, flexShrink: 0 }}>
        <Flex align="center" style={{ minHeight: 32 }}>
          <Text size="small" color="text-mid">
            <code>{fieldTypeLabel(f.field)}</code>
          </Text>
        </Flex>
      </Box>
      <Box style={{ flex: 1, minWidth: 80 }}>
        <Flex align="center" style={{ minHeight: 32 }}>
          {here ? (
            <Badge label="defined here" color="violet" variant="soft" />
          ) : (
            <Badge label={f.source ?? "default"} color="gray" variant="soft" />
          )}
        </Flex>
      </Box>
      <Flex
        gap="3"
        align="center"
        justify="end"
        style={{ flexShrink: 0, width: 120, minHeight: 32 }}
      >
        {editing ? (
          <>
            <Button size="sm" onClick={onSubmit}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelEdit}>
              Cancel
            </Button>
          </>
        ) : (
          canEditInline && (
            <>
              <Button
                variant="ghost"
                size="sm"
                title="Edit value"
                icon={<PiPencilSimpleFill />}
                onClick={onStartEdit}
              >
                Edit
              </Button>
              {isOwnField && (
                <DropdownMenu
                  trigger={
                    <IconButton
                      variant="ghost"
                      color="gray"
                      radius="full"
                      size="2"
                      highContrast
                    >
                      <BsThreeDotsVertical size={16} />
                    </IconButton>
                  }
                  triggerStyle={{ marginRight: 0, marginLeft: 0 }}
                  menuPlacement="end"
                >
                  <DropdownMenuItem onClick={onEditDefinition}>
                    Edit field definition
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem color="red" onClick={onDeleteDefinition}>
                    Delete field from schema
                  </DropdownMenuItem>
                </DropdownMenu>
              )}
            </>
          )
        )}
      </Flex>
    </Flex>
  );
}

import React, { ReactNode, useEffect, useRef } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiPencilSimple,
  PiInfo,
  PiRadioButton,
  PiArrowBendLeftUp,
  PiPlus,
  PiMagnifyingGlass,
} from "react-icons/pi";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import HelperText from "@/ui/HelperText";
import MarkdownLinks from "@/components/Markdown/MarkdownLinks";
import Checkbox from "@/ui/Checkbox";
import { Popover } from "@/ui/Popover";
import ScrollArea from "@/ui/ScrollArea";
import {
  DropdownMenu,
  DropdownMenuItem,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import { TableCell, TableRow, revealTableCell } from "@/ui/Table";
import SelectField from "@/components/Forms/SelectField";
import ConfigKeyUsageBadge from "@/components/Configs/ConfigKeyUsageBadge";
import { ConfigKeyImplementation } from "@/hooks/useConstantReferences";
import { FIVE_LINES_HEIGHT } from "@/components/Forms/CodeTextArea";
import FeatureValueField from "@/components/Features/FeatureValueField";
import ValueDisplay from "@/components/Features/ValueDisplay";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  ResolvedField,
  pinnedCellBackground,
  fieldTypeLabel,
  fieldValueType,
  fieldIsNullable,
  fieldSchemaPreview,
  normalizeField,
  valueToDisplayString,
} from "@/components/Configs/fieldSchema";
import {
  KeyNotice,
  KeyNoticesIcon,
  validationRuleNotice,
} from "@/components/Configs/ConfigKeyNotices";
import styles from "./ConfigFieldRow.module.scss";

// The Fields table's class, which leaves the gutter for row status icons.
export const fieldsTableClassName = styles.fieldsTable;

// A row's ⋮ menu, in a slot every row keeps even without one, so the buttons
// before it line up down the column.
export function FieldRowMenu({ children }: { children: ReactNode }) {
  return (
    <Box
      style={{
        width: 28,
        display: "flex",
        justifyContent: "center",
        flexShrink: 0,
        marginLeft: -6,
        marginRight: -12,
      }}
    >
      {children ? (
        <DropdownMenu
          variant="soft"
          trigger={<MoreMenuTrigger label="Field actions" />}
          menuPlacement="end"
        >
          {children}
        </DropdownMenu>
      ) : null}
    </Box>
  );
}

export default function ConfigFieldRow({
  field: f,
  configKey,
  inheritsValue = false,
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
  onRemoveField,
  onRemoveOverride,
  showParentValue = false,
  parentValue,
  hasValidationError = false,
  validationTooltip,
  keyNotices = [],
  keyImplementations = [],
}: {
  field: ResolvedField;
  configKey: string;
  // The config inherits from a parent, so its JSON edits deep-merge onto it.
  inheritsValue?: boolean;
  isOwnField: boolean;
  canEditInline: boolean;
  constantContext: { project?: string; excludeKeys?: string[] };
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
  onRemoveField: () => void;
  onRemoveOverride: () => void;
  // Render the inherited value struck-through beneath the current value.
  showParentValue?: boolean;
  parentValue?: unknown;
  // This field is referenced by a validation rule that currently fails.
  hasValidationError?: boolean;
  validationTooltip?: string;
  // Shown in the gutter left of the key, as its most severe icon.
  keyNotices?: KeyNotice[];
  // Feature rules / default values that override this field, for the usage badge.
  keyImplementations?: ConfigKeyImplementation[];
}): React.ReactElement {
  const here = f.source === configKey;
  // Read schema-derived info from the canonical simple form so raw-authored
  // fields (enum/nullable/bounds encoded in `jsonSchema`) behave like simple ones.
  const nf = f.field ? normalizeField(f.field) : null;
  const { getConfigByKey } = useDefinitions();
  const sourceName = f.source
    ? (getConfigByKey(f.source)?.name ?? f.source)
    : "default";
  // Editing a JSON value shows a code editor whose "Insert constant" button
  // floats just above it; give the row extra headroom so it doesn't crowd the
  // row above.
  // Editing is draft-only; ignore stale editing state if inline edit is off.
  const isEditing = editing && canEditInline;
  const hasJsonEditor = isEditing && fieldValueType(nf) === "json";
  // A terse type label (e.g. "advanced", "array", "enum<string>") hides the real
  // shape/validation; offer a click-to-inspect popover with the full JSON Schema.
  const schemaPreview = fieldSchemaPreview(f.field);

  const valueCellRef = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    const valueCell = valueCellRef.current;
    if (!isEditing || !valueCell) return;
    return revealTableCell(valueCell);
  }, [isEditing]);

  const tint = isEditing
    ? "var(--violet-a2)"
    : hasValidationError
      ? "var(--red-a2)"
      : null;
  const cellStyle = hasJsonEditor
    ? { paddingTop: "var(--space-6)" }
    : undefined;

  return (
    <TableRow align="start" style={tint ? { background: tint } : undefined}>
      <TableCell
        style={{
          ...cellStyle,
          ...(hasValidationError &&
            !isEditing && { boxShadow: "inset 3px 0 0 var(--red-9)" }),
        }}
      >
        <Flex
          align="center"
          gap="1"
          style={{ minHeight: 32, position: "relative" }}
        >
          <span className={styles.statusIcons}>
            <KeyNoticesIcon
              notices={[
                ...(hasValidationError
                  ? [
                      validationRuleNotice(
                        validationTooltip ?? "Fails a validation rule",
                      ),
                    ]
                  : []),
                ...keyNotices,
              ]}
            />
          </span>
          <Box style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <code
              style={{
                color: hasValidationError ? "var(--red-11)" : "var(--slate-12)",
              }}
            >
              {f.key}
            </code>
          </Box>
          {nf?.description && (
            <Tooltip content={nf.description}>
              <span
                style={{
                  display: "inline-flex",
                  flexShrink: 0,
                  color: "var(--slate-9)",
                }}
              >
                <PiInfo />
              </span>
            </Tooltip>
          )}
        </Flex>
      </TableCell>
      <TableCell
        ref={valueCellRef}
        className={styles.valueCell}
        style={{
          ...cellStyle,
          overflowWrap: "anywhere",
          // Keeps the code editor's scrollbar under the pinned column.
          ...(hasJsonEditor && { isolation: "isolate" }),
        }}
      >
        <Flex align="center" style={{ minHeight: 32 }}>
          <Box style={{ width: "100%", minWidth: 0 }}>
            {isEditing ? (
              <>
                {(() => {
                  const nullable = fieldIsNullable(nf);
                  const isNull = editKind === "null";
                  const disabled = isNull;
                  const vt = fieldValueType(nf);
                  const enumValues =
                    vt !== "json" && vt !== "boolean" ? (nf?.enum ?? []) : [];
                  return (
                    <>
                      {vt === "boolean" ? (
                        <SelectField
                          portalMenu
                          size="md"
                          value={editText}
                          onChange={setEditText}
                          options={[
                            { value: "true", label: "true" },
                            { value: "false", label: "false" },
                          ]}
                          initialOption="Not set"
                          sort={false}
                          disabled={disabled}
                        />
                      ) : enumValues.length > 0 ? (
                        <SelectField
                          portalMenu
                          size="md"
                          value={editText}
                          onChange={setEditText}
                          options={enumValues.map((v) => ({
                            value: v,
                            label: v,
                          }))}
                          initialOption="Not set"
                          sort={false}
                          disabled={disabled}
                        />
                      ) : (
                        <FeatureValueField
                          size="md"
                          id={`config-value-${f.key}`}
                          value={disabled ? "" : editText}
                          setValue={setEditText}
                          valueType={vt}
                          placeholder="Not set"
                          codeInputDefaultHeight={FIVE_LINES_HEIGHT}
                          constantContext={constantContext}
                          disabled={disabled}
                        />
                      )}
                      {vt === "json" && inheritsValue && !disabled && (
                        <Tooltip content="Nested JSON objects deep-merge onto the inherited value — set only the keys you want to change.">
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              marginTop: 4,
                              color: "var(--slate-10)",
                              fontSize: 11,
                            }}
                          >
                            <PiInfo /> Deep merge
                          </span>
                        </Tooltip>
                      )}
                      {nullable && vt !== "json" && (
                        <Flex mt="1" align="center">
                          <Checkbox
                            size="sm"
                            label={<code>null</code>}
                            value={isNull}
                            setValue={(v) => {
                              setEditKind(v ? "null" : "value");
                              if (v) setEditText("");
                            }}
                          />
                        </Flex>
                      )}
                    </>
                  );
                })()}
                {editError && (
                  <HelperText status="error" size="sm">
                    <MarkdownLinks text={editError} />
                  </HelperText>
                )}
              </>
            ) : (
              <>
                {f.value === undefined ? (
                  <Text color="text-low">Not set</Text>
                ) : f.value === null ? (
                  <ValueDisplay
                    value="null"
                    type="json"
                    copyButtonClassName={styles.copyButton}
                  />
                ) : (
                  (() => {
                    const vt = fieldValueType(nf);
                    // Render booleans as a code literal (true/false) like every
                    // other value here, not ValueDisplay's feature-flag ● TRUE
                    // style. (Don't change ValueDisplay — features rely on it.)
                    const displayType = vt === "boolean" ? "json" : vt;
                    return (
                      <ValueDisplay
                        value={valueToDisplayString(
                          squashConstants(f.value),
                          vt,
                        )}
                        type={displayType}
                        showFullscreenButton={vt === "json"}
                        copyButtonClassName={styles.copyButton}
                      />
                    );
                  })()
                )}
                {showParentValue && (
                  <Box
                    mt="1"
                    style={{ textDecoration: "line-through", opacity: 0.5 }}
                  >
                    {parentValue === undefined ? (
                      <Text color="text-low">Not set</Text>
                    ) : parentValue === null ? (
                      <ValueDisplay
                        value="null"
                        type="json"
                        copyButtonClassName={styles.copyButton}
                      />
                    ) : (
                      (() => {
                        const vt = fieldValueType(nf);
                        const displayType = vt === "boolean" ? "json" : vt;
                        return (
                          <ValueDisplay
                            value={valueToDisplayString(
                              squashConstants(parentValue),
                              vt,
                            )}
                            type={displayType}
                            copyButtonClassName={styles.copyButton}
                          />
                        );
                      })()
                    )}
                  </Box>
                )}
              </>
            )}
          </Box>
        </Flex>
      </TableCell>
      <TableCell style={cellStyle}>
        <Flex align="center" gap="1" style={{ minHeight: 32, minWidth: 0 }}>
          <code
            style={{
              color: "var(--slate-9)",
              fontSize: "0.8em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {fieldTypeLabel(nf)}
          </code>
          {schemaPreview && (
            <Popover
              side="left"
              align="start"
              showCloseButton
              triggerAsChild
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="1"
                  radius="full"
                  highContrast
                  title="View JSON Schema"
                  aria-label="View JSON Schema"
                  style={{ flexShrink: 0 }}
                >
                  <PiMagnifyingGlass />
                </IconButton>
              }
              content={
                <Box style={{ maxWidth: 440 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: 0.3,
                      textTransform: "uppercase",
                      color: "var(--slate-11)",
                      marginBottom: 6,
                    }}
                  >
                    JSON Schema
                  </div>
                  <ScrollArea
                    direction="both"
                    edgeCue="fade"
                    style={{
                      maxHeight: 360,
                      background: "var(--slate-a2)",
                      borderRadius: 6,
                    }}
                  >
                    <Box style={{ padding: "8px 10px" }}>
                      <InlineCode
                        language="json"
                        code={schemaPreview}
                        fontSize="12px"
                      />
                    </Box>
                  </ScrollArea>
                </Box>
              }
            />
          )}
        </Flex>
      </TableCell>
      <TableCell style={cellStyle}>
        <Flex align="center" style={{ minHeight: 32 }}>
          {isOwnField ? (
            <Badge
              color="gray"
              variant="soft"
              label={
                <>
                  <PiRadioButton /> Defined here
                </>
              }
            />
          ) : here ? (
            <Badge
              color="violet"
              variant="soft"
              label={
                <>
                  <PiPencilSimple /> Override
                </>
              }
            />
          ) : (
            <Badge
              color="gray"
              variant="soft"
              title={sourceName}
              style={{ maxWidth: "100%" }}
              label={
                <Flex align="center" gap="1" style={{ minWidth: 0 }}>
                  <PiArrowBendLeftUp style={{ flexShrink: 0 }} />
                  {f.source ? (
                    <Link
                      href={`/configs/${f.source}`}
                      title={`View Config: ${sourceName}`}
                      className="hover-underline"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        overflow: "hidden",
                        color: "var(--accent-11)",
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {sourceName}
                      </span>
                    </Link>
                  ) : (
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sourceName}
                    </span>
                  )}
                </Flex>
              }
            />
          )}
        </Flex>
      </TableCell>
      <TableCell style={cellStyle}>
        <Flex align="center" style={{ minHeight: 32 }}>
          <ConfigKeyUsageBadge implementations={keyImplementations} />
        </Flex>
      </TableCell>
      <TableCell
        style={{ ...cellStyle, background: pinnedCellBackground(tint) }}
      >
        <Flex
          gap="2"
          align="center"
          justify={isEditing ? "center" : "end"}
          style={{ minHeight: 32 }}
        >
          {isEditing ? (
            <Flex gap="3" align="center">
              <Button size="md" onClick={onSubmit}>
                Save
              </Button>
              <Link size="md" onClick={onCancelEdit}>
                Cancel
              </Link>
            </Flex>
          ) : (
            canEditInline && (
              <>
                {isOwnField || here ? (
                  <Button
                    variant="ghost"
                    size="md"
                    title={isOwnField ? "Edit field" : "Edit override"}
                    icon={<PiPencilSimple />}
                    onClick={isOwnField ? onEditDefinition : onStartEdit}
                  >
                    Edit
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="md"
                    title="Add override"
                    icon={<PiPlus />}
                    onClick={onStartEdit}
                  >
                    Override
                  </Button>
                )}
                <FieldRowMenu>
                  {isOwnField ? (
                    <DropdownMenuItem color="red" onClick={onRemoveField}>
                      Remove field
                    </DropdownMenuItem>
                  ) : here ? (
                    <DropdownMenuItem color="red" onClick={onRemoveOverride}>
                      Remove override
                    </DropdownMenuItem>
                  ) : null}
                </FieldRowMenu>
              </>
            )
          )}
        </Flex>
      </TableCell>
    </TableRow>
  );
}

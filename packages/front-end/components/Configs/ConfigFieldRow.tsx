import React, { ReactNode, useEffect, useRef } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiPencilSimple,
  PiInfo,
  PiRadioButton,
  PiArrowBendLeftUp,
  PiMagnifyingGlass,
} from "react-icons/pi";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
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
import TruncatedText from "@/ui/TruncatedText";
import EditableValueFrame, {
  inPlaceEditor,
} from "@/components/Features/EditableValueFrame";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  ResolvedField,
  pinnedCellBackground,
  fieldTypeLabel,
  fieldRowTransitionProps,
  fieldValueType,
  fieldIsNullable,
  fieldSchemaPreview,
  normalizeField,
  parseFieldValueInput,
  valueToDisplayString,
} from "@/components/Configs/fieldSchema";
import {
  KeyNotice,
  KeyNoticesIcon,
  validationRuleNotice,
} from "@/components/Configs/ConfigKeyNotices";
import ConfigEditActions from "@/components/Configs/ConfigEditActions";
import styles from "./ConfigFieldRow.module.scss";

// The Fields table's class, which leaves the gutter for row status icons.
export const fieldsTableClassName = styles.fieldsTable;
// While an edit is open, the Fields table's menu column folds away.
export const menuColumnHiddenClassName = styles.menuColumnHidden;

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
  isOwnField,
  canEditInline,
  constantContext,
  squashConstants,
  editing,
  editText,
  editKind,
  editError,
  saving = false,
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
  blockedReason = null,
  keyImplementations = [],
}: {
  field: ResolvedField;
  configKey: string;
  isOwnField: boolean;
  canEditInline: boolean;
  constantContext: { project?: string; excludeKeys?: string[] };
  squashConstants: (value: unknown) => unknown;
  editing: boolean;
  editText: string;
  editKind: "value" | "null";
  editError: string | null;
  saving?: boolean;
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
  // What the parent chain resolves this key to; JSON edits deep-merge onto an object.
  parentValue?: unknown;
  // This field is referenced by a validation rule that currently fails.
  hasValidationError?: boolean;
  validationTooltip?: string;
  // Shown in the gutter left of the key, as its most severe icon.
  keyNotices?: KeyNotice[];
  // Another edit is open, so this row's can't start.
  blockedReason?: string | null;
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
    // Opens with the value selected, ready to replace. A JSON editor does
    // this itself once it loads.
    const input = valueCell.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >("input:not([type='hidden']), textarea:not(.ace_text-input)");
    input?.focus();
    input?.select();
    return revealTableCell(valueCell);
  }, [isEditing]);

  // A non-empty object or array shows a key per line, so its edit button sits
  // at the top, apart from copy and fullscreen along the bottom.
  const tallValue =
    typeof f.value === "object" &&
    f.value !== null &&
    Object.keys(f.value).length > 0;
  // In a draft, the value opens its editor from a pencil on its frame.
  const valueEdit =
    canEditInline && !isEditing
      ? f.value === undefined
        ? "Set value"
        : isOwnField || here
          ? "Edit value"
          : "Override value"
      : null;

  const parsedEdit = isEditing
    ? parseFieldValueInput(editText, f.field, editKind === "null")
    : null;
  const saveBlockedReason =
    parsedEdit?.kind === "error" ? parsedEdit.error : null;

  const tint = isEditing
    ? "var(--violet-a2)"
    : hasValidationError
      ? "var(--amber-a2)"
      : null;

  return (
    <>
      <TableRow
        {...fieldRowTransitionProps(f.key)}
        align="start"
        style={tint ? { background: tint } : undefined}
      >
        <TableCell
          style={{
            ...(hasValidationError &&
              !isEditing && {
                // Kept with the row's bottom line, which is a shadow too.
                boxShadow:
                  "inset 3px 0 0 var(--amber-9), inset 0 -1px 0 var(--gray-a5)",
              }),
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
                  color: hasValidationError
                    ? "var(--amber-11)"
                    : "var(--slate-12)",
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
                    const vt = fieldValueType(nf);
                    const enumValues =
                      vt !== "json" && vt !== "boolean" ? (nf?.enum ?? []) : [];
                    const nullToggle = (nullable || isNull) && vt !== "json";
                    const deepMerges =
                      vt === "json" &&
                      !isNull &&
                      typeof parentValue === "object" &&
                      parentValue !== null &&
                      !Array.isArray(parentValue);
                    return (
                      <>
                        <Box className={inPlaceEditor}>
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
                              placeholder="Choose a value"
                              sort={false}
                              disabled={isNull}
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
                              placeholder="Choose a value"
                              sort={false}
                              disabled={isNull}
                            />
                          ) : (
                            <FeatureValueField
                              size="md"
                              id={`config-value-${f.key}`}
                              value={isNull ? "" : editText}
                              setValue={setEditText}
                              valueType={vt}
                              codeInputDefaultHeight={FIVE_LINES_HEIGHT}
                              constantContext={constantContext}
                              fullWidth
                              disabled={isNull}
                              autoSelect
                            />
                          )}
                        </Box>
                        {editError && (
                          <HelperText status="error" size="sm" mt="1">
                            <MarkdownLinks text={editError} />
                          </HelperText>
                        )}
                        {(deepMerges || nullToggle) && (
                          <Flex align="center" gap="3" mt="1">
                            {deepMerges && (
                              <Tooltip content="Nested objects merge onto the inherited value. Set only the keys to change.">
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    color: "var(--slate-10)",
                                    fontSize: 11,
                                  }}
                                >
                                  <PiInfo /> Deep merge
                                </span>
                              </Tooltip>
                            )}
                            {nullToggle && (
                              <Checkbox
                                size="sm"
                                label={<code>null</code>}
                                value={isNull}
                                setValue={(v) => {
                                  setEditKind(v ? "null" : "value");
                                  if (v) setEditText("");
                                }}
                              />
                            )}
                          </Flex>
                        )}
                      </>
                    );
                  })()}
                </>
              ) : (
                <>
                  <EditableValueFrame
                    code={f.value !== undefined}
                    tall={tallValue}
                    empty={f.value === undefined}
                    framed={!!valueEdit}
                    flush
                    edit={
                      valueEdit
                        ? {
                            label: valueEdit,
                            tooltip: valueEdit,
                            onEdit: onStartEdit,
                            blockedReason,
                          }
                        : null
                    }
                  >
                    {({ actionsOverlay, extraActions }) =>
                      f.value === undefined ? (
                        <Text color="text-low">Not set</Text>
                      ) : f.value === null ? (
                        <ValueDisplay
                          value="null"
                          type="json"
                          actionsOverlay={actionsOverlay}
                          extraActions={extraActions}
                        />
                      ) : (
                        <ValueDisplay
                          value={valueToDisplayString(
                            squashConstants(f.value),
                            fieldValueType(nf),
                          )}
                          // Booleans show as a code literal (true/false) like
                          // every other value here, not ValueDisplay's ● TRUE.
                          type={
                            fieldValueType(nf) === "boolean"
                              ? "json"
                              : fieldValueType(nf)
                          }
                          showFullscreenButton={fieldValueType(nf) === "json"}
                          multiline
                          lineHeight={1.3}
                          actionsOverlay={actionsOverlay}
                          extraActions={extraActions}
                        />
                      )
                    }
                  </EditableValueFrame>
                  {showParentValue && parentValue !== undefined && (
                    <Box
                      mt="1"
                      style={{ textDecoration: "line-through", opacity: 0.5 }}
                    >
                      {parentValue === null ? (
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
                              multiline
                              lineHeight={1.3}
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
        <TableCell>
          <Flex align="center" gap="1" style={{ minHeight: 32, minWidth: 0 }}>
            <code
              style={{
                display: "flex",
                minWidth: 0,
                color: "var(--slate-9)",
                fontSize: "0.8em",
              }}
            >
              <TruncatedText maxWidth="100%" text={fieldTypeLabel(nf)} />
            </code>
            {schemaPreview && (
              // Around the button, so its padding and keyboard focus open it.
              <Tooltip content="View JSON Schema">
                <span style={{ display: "inline-flex", flexShrink: 0 }}>
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
                </span>
              </Tooltip>
            )}
          </Flex>
        </TableCell>
        <TableCell>
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
                style={{ maxWidth: "100%" }}
                label={
                  <Flex align="center" gap="1" style={{ minWidth: 0 }}>
                    <PiArrowBendLeftUp style={{ flexShrink: 0 }} />
                    {f.source ? (
                      <Link
                        href={`/configs/${f.source}`}
                        style={{
                          display: "flex",
                          minWidth: 0,
                          color: "var(--accent-11)",
                        }}
                      >
                        <TruncatedText
                          maxWidth="100%"
                          className="hover-underline"
                          text={sourceName}
                        />
                      </Link>
                    ) : (
                      <TruncatedText maxWidth="100%" text={sourceName} />
                    )}
                  </Flex>
                }
              />
            )}
          </Flex>
        </TableCell>
        <TableCell>
          <Flex align="center" style={{ minHeight: 32 }}>
            <ConfigKeyUsageBadge implementations={keyImplementations} />
          </Flex>
        </TableCell>
        <TableCell style={{ background: pinnedCellBackground(tint) }}>
          <Flex gap="2" align="center" justify="end" style={{ minHeight: 32 }}>
            {isEditing
              ? null
              : canEditInline && (
                  <FieldRowMenu>
                    {valueEdit && (
                      <DropdownMenuItem onClick={onStartEdit}>
                        {valueEdit}
                      </DropdownMenuItem>
                    )}
                    {isOwnField ? (
                      <>
                        <DropdownMenuItem onClick={onEditDefinition}>
                          Edit field
                        </DropdownMenuItem>
                        <DropdownMenuItem color="red" onClick={onRemoveField}>
                          Remove field
                        </DropdownMenuItem>
                      </>
                    ) : here ? (
                      <DropdownMenuItem color="red" onClick={onRemoveOverride}>
                        Remove override
                      </DropdownMenuItem>
                    ) : null}
                  </FieldRowMenu>
                )}
          </Flex>
        </TableCell>
      </TableRow>
      {isEditing && (
        <ConfigEditActions
          colSpan={6}
          background={tint ?? undefined}
          saving={saving}
          saveBlockedReason={saveBlockedReason}
          onSave={onSubmit}
          onCancel={onCancelEdit}
        />
      )}
    </>
  );
}

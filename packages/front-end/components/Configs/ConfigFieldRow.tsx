import React from "react";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  PiPencilSimpleFill,
  PiInfo,
  PiRadioButton,
  PiArrowBendLeftUp,
  PiPencil,
  PiPlusBold,
  PiMagnifyingGlass,
  PiWarningOctagonFill,
} from "react-icons/pi";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import HelperText from "@/ui/HelperText";
import Checkbox from "@/ui/Checkbox";
import { Popover } from "@/ui/Popover";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import SelectField from "@/components/Forms/SelectField";
import ConfigKeyUsageBadge from "@/components/Configs/ConfigKeyUsageBadge";
import { ConfigKeyImplementation } from "@/hooks/useConstantReferences";
import { FIVE_LINES_HEIGHT } from "@/components/Forms/CodeTextArea";
import FeatureValueField from "@/components/Features/FeatureValueField";
import ValueDisplay from "@/components/Features/ValueDisplay";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  FIELD_GRID_TEMPLATE,
  ResolvedField,
  fieldTypeLabel,
  fieldValueType,
  fieldIsNullable,
  fieldSchemaPreview,
  normalizeField,
  valueToDisplayString,
} from "@/components/Configs/fieldSchema";
import styles from "./ConfigFieldRow.module.scss";

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
  editKind: "value" | "null" | "undefined";
  editError: string | null;
  setEditText: (v: string) => void;
  setEditKind: (k: "value" | "null" | "undefined") => void;
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

  return (
    <Grid
      columns={FIELD_GRID_TEMPLATE}
      gapX="5"
      align="start"
      pt={hasJsonEditor ? "6" : "2"}
      pb="2"
      px="3"
      style={{
        background: isEditing
          ? "var(--violet-a2)"
          : hasValidationError
            ? "var(--red-a2)"
            : undefined,
        // Always reserve the 3px left border so toggling the edit/validation
        // states never shifts row content on the x-axis.
        borderLeft:
          hasValidationError && !isEditing
            ? "3px solid var(--red-9)"
            : "3px solid transparent",
        // Editing reads as a rounded (padded) box; the row divider is kept.
        borderRadius: isEditing ? 8 : undefined,
        borderBottom: "1px solid var(--slate-a3)",
      }}
    >
      <Box style={{ minWidth: 0 }}>
        <Flex align="center" gap="1" style={{ minHeight: 32 }}>
          <Box style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <code
              style={{
                color: hasValidationError ? "var(--red-11)" : "var(--slate-12)",
              }}
            >
              {f.key}
            </code>
          </Box>
          {hasValidationError && (
            <Tooltip
              body={validationTooltip ?? "Fails a validation rule"}
              style={{
                display: "inline-flex",
                flexShrink: 0,
                color: "var(--red-9)",
              }}
            >
              <PiWarningOctagonFill />
            </Tooltip>
          )}
          {nf?.description && (
            <Tooltip
              body={nf.description}
              style={{
                display: "inline-flex",
                flexShrink: 0,
                color: "var(--slate-9)",
              }}
            >
              <PiInfo />
            </Tooltip>
          )}
        </Flex>
      </Box>
      <Box
        className={styles.valueCell}
        style={{ minWidth: 0, overflowWrap: "anywhere" }}
      >
        <Flex align="center" style={{ minHeight: 32 }}>
          <Box style={{ width: "100%", minWidth: 0 }}>
            {isEditing ? (
              <>
                {(() => {
                  const nullable = fieldIsNullable(nf);
                  const optional = nf?.required === false;
                  const isNull = editKind === "null";
                  const isUndefined = editKind === "undefined";
                  const disabled = isNull || isUndefined;
                  const vt = fieldValueType(nf);
                  const enumValues =
                    vt !== "json" && vt !== "boolean" ? (nf?.enum ?? []) : [];
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
                          disabled={disabled}
                        />
                      ) : enumValues.length > 0 ? (
                        <SelectField
                          value={editText}
                          onChange={setEditText}
                          options={enumValues.map((v) => ({
                            value: v,
                            label: v,
                          }))}
                          initialOption="value…"
                          sort={false}
                          disabled={disabled}
                        />
                      ) : (
                        <FeatureValueField
                          id={`config-value-${f.key}`}
                          value={disabled ? "" : editText}
                          setValue={setEditText}
                          valueType={vt}
                          useCodeInput={vt === "json"}
                          showFullscreenButton={vt === "json"}
                          codeInputDefaultHeight={FIVE_LINES_HEIGHT}
                          constantContext={constantContext}
                          inlineConstantButton
                          disabled={disabled}
                        />
                      )}
                      {vt === "json" && inheritsValue && !disabled && (
                        <Tooltip
                          body="Nested JSON objects deep-merge onto the inherited value — set only the keys you want to change."
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
                        </Tooltip>
                      )}
                      {((nullable && vt !== "json") || optional) && (
                        <Flex mt="1" gap="4" align="center">
                          {nullable && vt !== "json" && (
                            <Checkbox
                              size="sm"
                              label="null"
                              disabled={isUndefined}
                              value={isNull}
                              setValue={(v) => {
                                setEditKind(v ? "null" : "value");
                                if (v) setEditText("");
                              }}
                            />
                          )}
                          {optional && (
                            <Checkbox
                              size="sm"
                              label="undefined"
                              value={isUndefined}
                              setValue={(v) => {
                                setEditKind(v ? "undefined" : "value");
                                if (v) setEditText("");
                              }}
                            />
                          )}
                        </Flex>
                      )}
                    </>
                  );
                })()}
                {editError && (
                  <HelperText status="error" size="sm">
                    {editError}
                  </HelperText>
                )}
              </>
            ) : (
              <>
                {f.value === undefined ? (
                  <Text color="text-low">
                    <code>undefined</code>
                  </Text>
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
                      <Text color="text-low">
                        <code>undefined</code>
                      </Text>
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
      </Box>
      <Box style={{ minWidth: 0 }}>
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
                  <Box
                    style={{
                      maxHeight: 360,
                      overflow: "auto",
                      background: "var(--slate-a2)",
                      padding: "8px 10px",
                      borderRadius: 6,
                    }}
                  >
                    <InlineCode
                      language="json"
                      code={schemaPreview}
                      fontSize="12px"
                    />
                  </Box>
                </Box>
              }
            />
          )}
        </Flex>
      </Box>
      <Box style={{ minWidth: 0 }}>
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
                  <PiPencil /> Override
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
                      title={`View config: ${sourceName}`}
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
      </Box>
      <Box style={{ minWidth: 0 }}>
        <Flex align="center" style={{ minHeight: 32 }}>
          <ConfigKeyUsageBadge implementations={keyImplementations} />
        </Flex>
      </Box>
      <Flex
        gap="2"
        align="center"
        justify={isEditing ? "center" : "end"}
        style={{ minWidth: 0, minHeight: 32 }}
      >
        {isEditing ? (
          <Flex gap="3" align="center">
            <Button size="sm" onClick={onSubmit}>
              Save
            </Button>
            <Link size="2" onClick={onCancelEdit}>
              Cancel
            </Link>
          </Flex>
        ) : (
          canEditInline && (
            <>
              {isOwnField || here ? (
                <Button
                  variant="ghost"
                  size="sm"
                  title={isOwnField ? "Edit field" : "Edit override"}
                  icon={<PiPencilSimpleFill />}
                  onClick={isOwnField ? onEditDefinition : onStartEdit}
                >
                  Edit
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Add override"
                  icon={<PiPlusBold />}
                  onClick={onStartEdit}
                >
                  Override
                </Button>
              )}
              {/* Reserve the menu slot even when there's no menu (override
                  rows) so the Edit/Override buttons stay column-aligned. */}
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
                {(isOwnField || here) && (
                  <DropdownMenu
                    variant="soft"
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
                    menuPlacement="end"
                  >
                    {isOwnField ? (
                      <DropdownMenuItem color="red" onClick={onRemoveField}>
                        Remove field
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem color="red" onClick={onRemoveOverride}>
                        Remove override
                      </DropdownMenuItem>
                    )}
                  </DropdownMenu>
                )}
              </Box>
            </>
          )
        )}
      </Flex>
    </Grid>
  );
}

import {
  FeatureInterface,
  FeatureValueType,
  SchemaField,
  SimpleSchema,
} from "shared/types/feature";
import {
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { Ace } from "ace-builds";
import { ConstantWithoutValue } from "shared/types/constant";
import {
  getValidation,
  stripDefaultsForSparse,
  expandSparseToFull,
  getConfigBackingKey,
  getConfigBackingPatch,
  setConfigBacking,
  orderConfigsByLineage,
  isScopedConfig,
} from "shared/util";
import { FaMagic, FaRegTrashAlt } from "react-icons/fa";
import stringify from "json-stringify-pretty-compact";
import { BsBoxArrowUpRight } from "react-icons/bs";
import clsx from "clsx";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiCheck,
  PiCopy,
  PiBracketsCurly,
  PiCaretDownFill,
} from "react-icons/pi";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/ui/DropdownMenu";
import { formatJSON, LARGE_FILE_SIZE } from "@/services/features";
import Field from "@/components/Forms/Field";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import Modal from "@/components/Modal";
import { GBAddCircle } from "@/components/Icons";
import Tooltip from "@/components/Tooltip/Tooltip";
import RadioGroup from "@/ui/RadioGroup";
import ConfigOverrideEditor from "@/components/Features/ConfigOverrideEditor";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Text from "@/ui/Text";
import SparsePatchToggle from "@/components/Features/SparsePatchToggle";
import SparseTabbedEditor from "@/components/Features/SparseTabbedEditor";
import InsertConstantButton, {
  UsedConstantTags,
} from "@/components/Constants/InsertConstantButton";
import {
  addJsonConstantExtends,
  buildStringRefInsertion,
} from "@/components/Constants/jsonConstantInsert";

export interface Props {
  valueType?: FeatureValueType;
  label?: string | ReactNode;
  value: string;
  setValue: (v: string) => void;
  id: string;
  helpText?: ReactNode;
  type?: string;
  placeholder?: string;
  feature?: FeatureInterface;
  // Used to scope the "Insert constant" picker. Defaults to the feature's project.
  project?: string;
  // Enables the constant picker when editing a constant's own value (rather than
  // a feature value). `excludeKeys` scrubs the constant itself + cycle-creating
  // options.
  constantContext?: { project?: string; excludeKeys?: string[] };
  renderJSONInline?: boolean;
  disabled?: boolean;
  useDropdown?: boolean;
  useCodeInput?: boolean;
  showFullscreenButton?: boolean;
  codeInputDefaultHeight?: number;
  hideCopyButton?: boolean;
  // Renders the "Insert constant" picker as a compact square IconButton beside
  // the field (top-aligned) instead of on a label row above it, and hides the
  // copy button. Used by the inline config field editor.
  inlineConstantButton?: boolean;
  // JSON features only. Whether this rule value is a sparse patch (merged onto
  // the feature default). When `setSparse` is provided and the feature default
  // is a plain object, a "Sparse patch" toggle renders on the label row.
  sparse?: boolean;
  setSparse?: (sparse: boolean) => void;
  // Tighter sparse editor layout for embedded contexts (e.g. ramp step editors).
  condensed?: boolean;
  // JSON features only. Offers a "Use a config" picker: instead of authoring the
  // value directly, back it with a config (its base JSON + schema), with the
  // value acting as an override patch. Serializes to an internal `@config:` ref.
  allowConfigBacking?: boolean;
  // When set, restricts the config-backing picker to these config keys (e.g. a
  // rule may only override with the feature default's config or its children).
  configBackingOptionKeys?: string[];
  // Rule mode: keep the override-patch editor visible even when a config is
  // selected (a rule layers its own patch on top of the chosen config). When
  // false (default-value mode), selecting a config hides the editor.
  configBackingShowPatch?: boolean;
  // Rule mode: require a config (no "None" option) — a rule on a config-backed
  // feature always serves the default's config or a compatible child.
  lockConfigBacking?: boolean;
}

export default function FeatureValueField({
  valueType,
  label,
  value,
  setValue,
  id,
  helpText,
  placeholder,
  feature,
  project,
  constantContext,
  renderJSONInline,
  disabled = false,
  useDropdown = false,
  useCodeInput = false,
  showFullscreenButton = false,
  codeInputDefaultHeight,
  hideCopyButton = false,
  inlineConstantButton = false,
  sparse,
  setSparse,
  condensed = false,
  allowConfigBacking = false,
  configBackingOptionKeys,
  configBackingShowPatch = false,
  lockConfigBacking = false,
}: Props) {
  // Inline mode also suppresses the copy button.
  const copyHidden = hideCopyButton || inlineConstantButton;
  const { hasCommercialFeature } = useUser();
  const { configs } = useDefinitions();
  const hasJsonValidator = hasCommercialFeature("json-validation");
  const { simpleSchema, validationEnabled } = feature
    ? getValidation(feature)
    : { simpleSchema: null, validationEnabled: null };

  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 800,
  });

  // Constant-picker wiring. Only offered in a feature context (where `@const:`
  // references get resolved at payload build time) — not for standalone
  // experiment values. `pickerProject` scopes which constants are offered.
  const showConstantPicker = !!feature || !!constantContext;
  const pickerProject = constantContext?.project ?? project ?? feature?.project;
  const pickerExcludeKeys = constantContext?.excludeKeys;
  // Tags for the valid constants referenced in the current value, shown below
  // the editor's CTA row.
  const usedConstantTags =
    showConstantPicker && (valueType === "string" || valueType === "json") ? (
      <UsedConstantTags
        value={value}
        valueType={valueType}
        project={pickerProject}
      />
    ) : null;
  const jsonEditorRef = useRef<Ace.Editor | null>(null);
  const stringInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Insert `{{ @const:key }}` at the cursor of the plain string field. Uses
  // execCommand so the edit lands in the textarea's native undo/redo history
  // (and its input event drives the controlled onChange); falls back to a direct
  // splice if execCommand is unavailable.
  const insertStringConstant = (constant: ConstantWithoutValue): boolean => {
    const ref = `{{ @const:${constant.key} }}`;
    const el = stringInputRef.current;
    if (!el) {
      setValue(value + ref);
      return true;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    el.focus();
    el.setSelectionRange(start, end);
    if (!document.execCommand("insertText", false, ref)) {
      setValue(value.slice(0, start) + ref + value.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + ref.length;
        el.setSelectionRange(pos, pos);
      });
    }
    return true;
  };

  // Cursor-aware insertion into the JSON code editor: a JSON constant becomes a
  // new object entry; a string constant is interpolated into the current string
  // literal. Clicks in an invalid context are ignored.
  const insertJsonConstant = (constant: ConstantWithoutValue): boolean => {
    const editor = jsonEditorRef.current;
    if (!editor) return false;
    try {
      const text = editor.getValue();
      // JSON constants are objects composed via `$extends`, so add the ref to
      // the value's `$extends` array (rebuilding the whole value, which also
      // normalizes it to one key/element per line). String constants are
      // interpolated into the string literal at the cursor.
      if (constant.type === "json") {
        const next = addJsonConstantExtends(text, constant.key);
        if (next === null) return false;
        editor.setValue(next, -1);
        editor.focus();
        return true;
      }
      const offset = editor.session.doc.positionToIndex(
        editor.getCursorPosition(),
      );
      const insertion = buildStringRefInsertion(text, offset, constant.key);
      if (!insertion) return false;
      editor.session.insert(
        editor.session.doc.indexToPosition(insertion.index, 0),
        insertion.text,
      );
      editor.focus();
      return true;
    } catch {
      // The Ace editor can be torn down (e.g. tab unmount) — fail gracefully.
      return false;
    }
  };

  const defaultCodeEditorToggledOn = value.length <= LARGE_FILE_SIZE;
  const [codeEditorToggledOn, setCodeEditorToggledOn] = useState(
    defaultCodeEditorToggledOn,
  );

  // Local buffer for the config-backed override editor. The stored value
  // round-trips through JSON parse/recompose (to inject the `@config:` ref),
  // which would normalize/clobber in-progress text on every keystroke. The
  // buffer preserves exactly what the user typed and is only re-derived when the
  // stored value changes from outside this editor (e.g. switching configs).
  const [configPatchDraft, setConfigPatchDraft] = useState<string | null>(null);
  const lastComposedValueRef = useRef<string | null>(null);
  // The config the value was last backed by. While editing, a momentarily
  // invalid-JSON patch makes getConfigBackingKey(value) return null; without
  // this, a locked rule would silently fall back to the subtree root (the base)
  // and recompose against it — changing the served value on a keystroke.
  const lastBackingKeyRef = useRef<string | null>(null);

  // A config-backed default value serves the config as-is — this mode has no
  // patch editor (configBackingShowPatch off). Strip any orphaned override keys
  // left behind from JSON authored before a config was selected; otherwise they
  // merge in invisibly (and fail the config's schema) with no way to clear them.
  useEffect(() => {
    if (valueType !== "json" || !allowConfigBacking || configBackingShowPatch) {
      return;
    }
    const key = getConfigBackingKey(value);
    if (!key) return;
    const existingPatch = getConfigBackingPatch(value);
    if (existingPatch === "{}" || existingPatch === "") return;
    const cleaned = setConfigBacking(key, "{}");
    if (cleaned !== value) {
      lastComposedValueRef.current = cleaned;
      setValue(cleaned);
    }
  }, [value, valueType, allowConfigBacking, configBackingShowPatch, setValue]);

  if (
    validationEnabled &&
    hasJsonValidator &&
    valueType === "json" &&
    simpleSchema
  ) {
    return (
      <>
        <SimpleSchemaEditor
          schema={simpleSchema}
          value={value}
          setValue={setValue}
          renderInline={renderJSONInline}
          label={label}
          placeholder={placeholder}
          disabled={disabled}
        />
        {helpText && (
          <Text as="p" size="small" color="text-low">
            {helpText}
          </Text>
        )}
      </>
    );
  }
  if (valueType === "boolean" && useDropdown) {
    return (
      <SelectField
        options={[
          { label: "TRUE", value: "true" },
          { label: "FALSE", value: "false" },
        ]}
        value={value}
        onChange={(v) => {
          setValue(v);
        }}
        label={label}
        disabled={disabled}
      />
    );
  }

  if (valueType === "boolean" && !useDropdown) {
    return (
      <div className={clsx("form-group", { "mb-0": label === undefined })}>
        {label !== undefined && (
          <Text as="label" weight="semibold">
            {label}
          </Text>
        )}
        <div>
          <RadioGroup
            disabled={disabled}
            options={[
              {
                label: "TRUE",
                value: "true",
              },
              {
                label: "FALSE",
                value: "false",
              },
            ]}
            value={value}
            setValue={(v) => {
              setValue(v);
            }}
          />
        </div>
        {helpText && (
          <Text as="p" size="small" color="text-low">
            {helpText}
          </Text>
        )}
      </div>
    );
  }

  if (valueType === "json" && allowConfigBacking) {
    // Configs eligible to back this value: JSON-typed, in scope, not archived,
    // and not an env/project flavor (those are variants of another config, never
    // an independent base). A caller may further restrict (e.g. to a subtree).
    const backingProject = project ?? feature?.project ?? "";
    const optionKeySet = configBackingOptionKeys
      ? new Set(configBackingOptionKeys)
      : null;
    const eligibleConfigs = configs.filter(
      (c) =>
        !c.archived &&
        !isScopedConfig(c) &&
        (!c.project || !backingProject || c.project === backingProject) &&
        (!optionKeySet || optionKeySet.has(c.key)),
    );
    const backedKey = getConfigBackingKey(value);
    // No live configs in scope (and not already backed) → skip the picker
    // entirely and fall through to the plain JSON editor below.
    if (eligibleConfigs.length > 0 || backedKey !== null) {
      // When locked (config-backed default/rules) and the value doesn't name its
      // own config, resolve to the base — the first `configBackingOptionKeys`
      // entry (getConfigSubtree lists the root first), which `eligibleConfigs`
      // (in definitions order) does NOT preserve. Fall back to any eligible.
      const eligibleKeys = new Set(eligibleConfigs.map((c) => c.key));
      const baseOptionKey =
        configBackingOptionKeys?.find((k) => eligibleKeys.has(k)) ??
        eligibleConfigs[0]?.key ??
        null;
      // Mid-edit with an unparseable patch, `backedKey` reads null even though
      // the backing hasn't changed — hold the last one so a locked rule doesn't
      // silently re-point to the base. Only trust it while this editor owns the
      // value (our own compose round-trip), else the value changed from outside.
      const editingOwnValue =
        configPatchDraft !== null && value === lastComposedValueRef.current;
      const preservedKey = editingOwnValue ? lastBackingKeyRef.current : null;
      const configKey =
        backedKey ?? preservedKey ?? (lockConfigBacking ? baseOptionKey : null);
      const isBacked = configKey !== null;
      // When backed, the value's own keys are an override patch on the config;
      // otherwise the whole value is authored directly (and becomes the patch if a
      // config is later attached). The extracted patch is compact JSON (storage
      // form) — expand it for the editor so objects don't collapse onto one line.
      const rawStoredPatch =
        backedKey !== null ? getConfigBackingPatch(value) : value;
      const storedPatch =
        valueType === "json"
          ? (formatJSON(rawStoredPatch) ?? rawStoredPatch)
          : rawStoredPatch;
      // Prefer the local draft while editing (preserves raw text through the
      // recompose round-trip); fall back to the stored patch when the value
      // changed from outside this editor.
      const patch =
        configPatchDraft !== null && value === lastComposedValueRef.current
          ? configPatchDraft
          : storedPatch;
      // Compose the patch back with the config ref and emit, buffering raw text.
      const emitPatch = (p: string) => {
        setConfigPatchDraft(p);
        // Remember the backing as-of-emit so the next render can hold it if `p`
        // is momentarily unparseable (getConfigBackingKey would read null).
        lastBackingKeyRef.current = configKey;
        const composed = isBacked ? setConfigBacking(configKey, p) : p;
        lastComposedValueRef.current = composed;
        setValue(composed);
      };
      // Rule mode keeps the patch editor visible alongside the config picker;
      // default-value mode hides it once a config is chosen.
      const showPatchEditor = configBackingShowPatch || !isBacked;

      // Selecting a config wraps the current patch as the override; clearing it
      // (unlocked only) unwraps the patch back into a plain value. In default-value
      // mode (no patch editor) the config serves as-is, so drop any prior keys
      // rather than stranding them as a hidden patch.
      const selectConfig = (key: string | null) => {
        const nextPatch = key && !configBackingShowPatch ? "{}" : patch;
        const composed = key ? setConfigBacking(key, nextPatch) : patch;
        lastComposedValueRef.current = composed;
        setValue(composed);
      };
      // The current backing config may be archived (or out of scope), so it's
      // absent from `eligibleConfigs` — fall back to the full list so an existing
      // backing still displays instead of collapsing to "None". Flag the archived
      // state so the degraded backing reads honestly.
      const selectedConfig =
        eligibleConfigs.find((c) => c.key === configKey) ??
        (configKey ? (configs.find((c) => c.key === configKey) ?? null) : null);
      const selectedConfigLabel = selectedConfig
        ? selectedConfig.archived
          ? `${selectedConfig.name} (archived)`
          : selectedConfig.name
        : "None";

      return (
        <Box mb="4">
          {label !== undefined && (
            <Box mb="1" mt="3">
              <Text as="label" weight="semibold">
                {label}
              </Text>
            </Box>
          )}
          <Box
            className={
              configBackingShowPatch ? "bg-highlight rounded" : undefined
            }
            p={configBackingShowPatch ? "3" : undefined}
          >
            <Flex align="center" gap="2">
              <Text as="label" weight="medium" mb="0">
                Based on config:
              </Text>
              {disabled ? (
                <Text>{selectedConfigLabel}</Text>
              ) : (
                <DropdownMenu
                  trigger={
                    <Link
                      type="button"
                      style={{ color: "var(--color-text-high)" }}
                    >
                      <Flex as="span" align="center" gap="1">
                        <Text>{selectedConfigLabel}</Text>
                        <PiCaretDownFill />
                      </Flex>
                    </Link>
                  }
                  menuPlacement="start"
                  variant="soft"
                >
                  <DropdownMenuGroup>
                    {!lockConfigBacking && (
                      <DropdownMenuItem onClick={() => selectConfig(null)}>
                        None
                      </DropdownMenuItem>
                    )}
                    {orderConfigsByLineage(eligibleConfigs).map(
                      ({ config: c, depth }) => (
                        <DropdownMenuItem
                          key={c.key}
                          onClick={() => selectConfig(c.key)}
                        >
                          <Flex
                            as="span"
                            align="center"
                            gap="2"
                            width="100%"
                            style={
                              depth ? { paddingLeft: depth * 16 } : undefined
                            }
                          >
                            <span>{c.name}</span>
                            <code
                              style={{
                                marginLeft: "auto",
                                paddingLeft: "var(--space-5)",
                                color: "var(--slate-12)",
                              }}
                            >
                              {c.key}
                            </code>
                          </Flex>
                        </DropdownMenuItem>
                      ),
                    )}
                  </DropdownMenuGroup>
                </DropdownMenu>
              )}
            </Flex>
            {showPatchEditor && (
              <Box mt="3">
                {isBacked && configKey && valueType === "json" ? (
                  <>
                    <Box mb="1">
                      <Text as="label" weight="medium">
                        Additional overrides
                      </Text>
                      <Text as="p" size="small" color="text-low" mb="0">
                        Nested objects deep-merge onto the config; arrays and
                        scalars replace.
                      </Text>
                    </Box>
                    <ConfigOverrideEditor
                      configKey={configKey}
                      patch={patch}
                      setPatch={emitPatch}
                      constantContext={{
                        project: pickerProject,
                        excludeKeys: pickerExcludeKeys,
                      }}
                      disabled={disabled}
                    />
                  </>
                ) : (
                  <FeatureValueField
                    valueType={valueType}
                    value={patch}
                    setValue={emitPatch}
                    id={id}
                    placeholder={placeholder}
                    feature={feature}
                    project={project}
                    constantContext={constantContext}
                    renderJSONInline={renderJSONInline}
                    disabled={disabled}
                    useCodeInput={useCodeInput}
                    showFullscreenButton={showFullscreenButton}
                    codeInputDefaultHeight={codeInputDefaultHeight}
                    sparse={configBackingShowPatch ? sparse : undefined}
                  />
                )}
              </Box>
            )}
          </Box>
          {helpText && (
            <Text as="p" size="small" color="text-low">
              {helpText}
            </Text>
          )}
        </Box>
      );
    }
  }

  if (valueType === "json") {
    // Sparse patch mode (JSON features): the value is a partial object merged
    // onto the default. We show a toggle on the label row and, when on,
    // Edit/Preview tabs. Offered whenever the caller wires `setSparse` — when the
    // default isn't a plain object (array/null/primitive) there's nothing to
    // merge onto, so the patch simply replaces the value (see the toggle tooltip).
    const showSparseToggle = !!setSparse;
    const isSparse = !!sparse;

    // Cursor-aware insertion targets the Ace editor (the code-editor path, or the
    // sparse Edit tab — both Ace). Rendered as a small text button on its own row
    // above the editor (matching the feature value editors) — even in inline
    // contexts — so the multi-line JSON editor keeps the full width.
    const insertConstantButton =
      showConstantPicker &&
      (isSparse || (useCodeInput && codeEditorToggledOn)) ? (
        <InsertConstantButton
          valueType="json"
          project={pickerProject}
          excludeKeys={pickerExcludeKeys}
          onInsert={insertJsonConstant}
          disabled={disabled}
        />
      ) : null;

    const sparseHeader = showSparseToggle ? (
      <Flex
        align="center"
        justify="between"
        gap="3"
        mb="1"
        width="100%"
        style={{ minHeight: "var(--space-6)" }}
      >
        {label !== undefined ? (
          <Text as="label" weight="semibold" mb="0">
            {label}
          </Text>
        ) : (
          <Box />
        )}
        <Flex align="center" gap="3" flexShrink="0">
          {insertConstantButton}
          <SparsePatchToggle
            checked={!!sparse}
            onChange={(checked) => {
              // Switching modes rewrites the value so the editor isn't left with
              // a default-laden patch (on) or a bare patch shown as the full
              // value (off). See stripDefaultsForSparse / expandSparseToFull.
              const def = feature?.defaultValue ?? "";
              setValue(
                checked
                  ? stripDefaultsForSparse(value, def)
                  : expandSparseToFull(value, def),
              );
              setSparse?.(checked);
            }}
            disabled={disabled}
          />
        </Flex>
      </Flex>
    ) : null;

    if (isSparse) {
      return (
        <Box mb="3">
          {sparseHeader}
          <SparseTabbedEditor
            value={value}
            setValue={setValue}
            valueType={valueType}
            defaultValue={feature?.defaultValue}
            label={label}
            placeholder={placeholder}
            disabled={disabled}
            defaultHeight={codeInputDefaultHeight}
            showInlineLabel={!showSparseToggle}
            condensed={condensed}
            onEditorLoad={(e) => (jsonEditorRef.current = e)}
            usedConstantTags={usedConstantTags}
          />
        </Box>
      );
    }

    // When the picker shows (or the sparse toggle owns the row), render the
    // label row ourselves so the button sits on its own row above the editor
    // rather than nested inside the editor's <label> element. Otherwise let the
    // editor render its own label.
    const editorLabel =
      showSparseToggle || insertConstantButton ? undefined : label;
    const jsonLabelRow =
      !showSparseToggle && insertConstantButton ? (
        <Flex
          align="center"
          justify="between"
          gap="3"
          width="100%"
          mb="1"
          // Consistent row height so a label paired with a code editor lines up
          // with sibling columns (e.g. the config JSON value/schema editors).
          style={{ minHeight: "var(--space-6)" }}
        >
          {label !== undefined ? (
            <Text as="label" weight="semibold" mb="0">
              {label}
            </Text>
          ) : (
            <Box />
          )}
          {insertConstantButton}
        </Flex>
      ) : null;

    const formatted = formatJSON(value);

    const codeEditorToggleButton = useCodeInput ? (
      <a
        href="#"
        className="text-purple"
        onClick={(e) => {
          e.preventDefault();
          setCodeEditorToggledOn(!codeEditorToggledOn);
        }}
        style={{ whiteSpace: "nowrap" }}
      >
        <PiBracketsCurly />{" "}
        {codeEditorToggledOn ? "Use text editor" : "Use code editor"}
      </a>
    ) : null;

    const formatJSONButton = (
      <a
        href="#"
        className={clsx("text-purple", {
          "text-muted cursor-default no-underline":
            !formatted || formatted === value,
        })}
        onClick={(e) => {
          e.preventDefault();
          if (formatted && formatted !== value) {
            setValue(formatted);
          }
        }}
        style={{ whiteSpace: "nowrap" }}
      >
        <FaMagic /> Format JSON
      </a>
    );

    // Stack the editor CTAs (right-aligned, own row) above the help text + used-
    // constant tags (full width). Side-by-side overlapped in narrow columns
    // (e.g. the config JSON editor's two-column layout); stacking also gives the
    // tags the full width to wrap into.
    const combinedHelpText = (
      <Box width="100%">
        <Flex gap="3" justify="end" wrap="wrap" width="100%">
          {codeEditorToggleButton}
          {formatJSONButton}
        </Flex>
        {(helpText || usedConstantTags) && (
          <Box mt="1" style={{ minWidth: 0 }}>
            {helpText}
            {usedConstantTags}
          </Box>
        )}
      </Box>
    );

    if (useCodeInput && codeEditorToggledOn) {
      // In tabular/inline layouts, float the insert-constant button just above
      // the editor (out of flow) so the editor's top lines up with the sibling
      // grid cells (type select, actions) instead of being pushed down by the
      // button row. Elsewhere the label row sits in flow above the editor.
      const floatInsertButton = inlineConstantButton && !!insertConstantButton;
      return (
        <Box
          mb="3"
          style={floatInsertButton ? { position: "relative" } : undefined}
        >
          {sparseHeader}
          {floatInsertButton ? (
            <Box
              style={{
                position: "absolute",
                bottom: "100%",
                right: 0,
                marginBottom: 2,
              }}
            >
              {insertConstantButton}
            </Box>
          ) : (
            jsonLabelRow
          )}
          <CodeTextArea
            label={editorLabel}
            language="json"
            value={value}
            setValue={setValue}
            helpText={combinedHelpText}
            placeholder={placeholder}
            disabled={disabled}
            resizable={true}
            defaultHeight={codeInputDefaultHeight}
            showCopyButton={!copyHidden}
            showFullscreenButton={showFullscreenButton}
            fontSize="0.75rem"
            slimGutter
            onEditorLoad={(e) => (jsonEditorRef.current = e)}
          />
        </Box>
      );
    }

    return (
      <Box mb="3">
        {sparseHeader}
        {jsonLabelRow}
        <JSONTextEditor
          label={editorLabel}
          value={value}
          setValue={setValue}
          helpText={combinedHelpText}
          placeholder={placeholder}
          disabled={disabled}
          showCopyButton={!copyHidden}
          performCopy={performCopy}
          copySuccess={copySuccess}
        />
      </Box>
    );
  }

  // Schema-aware input for string/number flags; values are raw scalars, so bypass JSON encoding.
  if (
    validationEnabled &&
    hasJsonValidator &&
    (valueType === "string" || valueType === "number") &&
    simpleSchema?.type === "primitive"
  ) {
    const field = simpleSchema.fields[0];
    const typeMatches =
      !!field &&
      (valueType === "string"
        ? field.type === "string"
        : field.type === "integer" || field.type === "float");
    if (field && typeMatches) {
      return (
        <>
          <SimpleSchemaPrimitiveEditor
            field={field}
            value={
              valueType === "number"
                ? value === ""
                  ? undefined
                  : parseFloat(value)
                : value
            }
            setValue={(v) => setValue(v == null ? "" : String(v))}
            label={label}
            showDescription={true}
            disabled={disabled}
          />
          {helpText && (
            <Text as="p" size="small" color="text-low">
              {helpText}
            </Text>
          )}
        </>
      );
    }
  }

  const copyButton = (
    <Tooltip body={copySuccess ? "Copied" : "Copy to clipboard"}>
      <IconButton
        type="button"
        radius="full"
        variant="ghost"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!copySuccess) performCopy(value);
        }}
      >
        {copySuccess ? <PiCheck size={12} /> : <PiCopy size={12} />}
      </IconButton>
    </Tooltip>
  );

  const combinedHelpTextForString =
    valueType === "string" ? (
      <Flex align="start" gap="3" width="100%">
        <Box flexGrow="1" style={{ minWidth: 0 }}>
          {helpText}
          {usedConstantTags}
        </Box>
        {!copyHidden && <Box flexShrink="0">{copyButton}</Box>}
      </Flex>
    ) : (
      helpText
    );

  // The string constant picker rides right-aligned on its own label row above
  // the field (only in a feature context) — rendered beside the label text, not
  // nested inside the field's <label> element.
  const showStringPicker = valueType === "string" && showConstantPicker;
  const stringInsertButton = showStringPicker ? (
    <InsertConstantButton
      valueType="string"
      project={pickerProject}
      excludeKeys={pickerExcludeKeys}
      onInsert={insertStringConstant}
      disabled={disabled}
      iconOnly={inlineConstantButton}
    />
  ) : null;
  const stringLabelRow =
    showStringPicker && !inlineConstantButton ? (
      <Flex align="center" justify="between" gap="3" width="100%" mb="1">
        {label !== undefined ? (
          <Text as="label" weight="semibold" mb="0">
            {label}
          </Text>
        ) : (
          <Box />
        )}
        {stringInsertButton}
      </Flex>
    ) : null;

  const field = (
    <Field
      ref={stringInputRef}
      label={stringLabelRow ? undefined : label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      {...(valueType === "number"
        ? {
            type: "number",
            step: "any",
            min: "any",
            max: "any",
          }
        : valueType === "string"
          ? {
              textarea: true,
              minRows: 1,
            }
          : {})}
      helpText={combinedHelpTextForString}
      style={
        valueType === undefined
          ? { width: 80 }
          : valueType === "number"
            ? { width: 120 }
            : undefined
      }
      disabled={disabled}
    />
  );

  // Inline layout: the picker rides to the right of the field, top-aligned.
  if (inlineConstantButton && stringInsertButton) {
    return (
      <Flex align="start" gap="2" width="100%">
        <Box style={{ flex: 1, minWidth: 0 }}>{field}</Box>
        <Box style={{ flexShrink: 0 }}>{stringInsertButton}</Box>
      </Flex>
    );
  }

  return (
    <>
      {stringLabelRow}
      {field}
    </>
  );
}

function SimpleSchemaPrimitiveEditor<T = unknown>({
  field,
  value,
  setValue,
  label,
  showDescription,
  disabled = false,
}: {
  field: SchemaField;
  value: T;
  setValue: (value: T) => void;
  label?: ReactNode;
  showDescription?: boolean;
  disabled?: boolean;
}): ReactElement {
  const uuid = useId();

  const isset = value !== null && value !== undefined;

  let containerClassName = "";
  let labelClassName = "";
  if (!field.required) {
    const checkbox = (
      <input
        type="checkbox"
        style={{ verticalAlign: "middle" }}
        title="Whether or not to include this optional field"
        name={`${uuid}_required`}
        className="ml-1 mr-2"
        checked={isset}
        disabled={disabled}
        onChange={(e) => {
          if (!isset && e.target.checked) {
            setValue(
              (field.type === "boolean"
                ? false
                : field.type === "string"
                  ? ""
                  : 0) as T,
            );
          } else if (!e.target.checked) {
            setValue(undefined as T);
          }
        }}
      />
    );

    if (!label) {
      containerClassName = "d-flex align-items-center";
      labelClassName = "mb-0";
    }

    label = (
      <>
        {label} {checkbox}
      </>
    );
  }

  const helpText =
    showDescription && field.description ? field.description : "";

  if (field.enum?.length && field.type !== "boolean") {
    return (
      <SelectField
        options={field.enum.map((v) => ({
          label: v,
          value: v,
        }))}
        value={(value ?? "") + ""}
        onChange={(v) => {
          // If the field is a number, we need to convert the value to a number
          if (field.type === "float" || field.type === "integer") {
            setValue(parseFloat(v) as T);
          } else {
            setValue(v as T);
          }
        }}
        containerClassName={containerClassName}
        labelClassName={labelClassName}
        label={label}
        disabled={(!field.required && !isset) || disabled}
        helpText={helpText}
      />
    );
  }

  switch (field.type) {
    case "boolean":
      return label ? (
        <div className={clsx("form-group", containerClassName)}>
          <label htmlFor={uuid} className={labelClassName}>
            {label}
          </label>
          <div>
            <RadioGroup
              options={[
                {
                  label: "TRUE",
                  value: "true",
                },
                {
                  label: "FALSE",
                  value: "false",
                },
              ]}
              value={value ? "true" : "false"}
              setValue={(v) => {
                setValue((v === "true") as T);
              }}
              disabled={(!field.required && !isset) || disabled}
            />
          </div>
          {helpText && (
            <small className="form-text text-muted">{helpText}</small>
          )}
        </div>
      ) : (
        <>
          <div>
            <RadioGroup
              options={[
                {
                  label: "TRUE",
                  value: "true",
                },
                {
                  label: "FALSE",
                  value: "false",
                },
              ]}
              value={value ? "true" : "false"}
              setValue={(v) => {
                setValue((v === "true") as T);
              }}
              disabled={(!field.required && !isset) || disabled}
            />
          </div>
          {helpText && (
            <small className="form-text text-muted">{helpText}</small>
          )}
        </>
      );
    case "string":
      return (
        <Field
          containerClassName={containerClassName}
          labelClassName={labelClassName}
          label={label}
          value={(value ?? "") + ""}
          onChange={(e) => {
            setValue(e.target.value as T);
          }}
          minLength={field.min}
          maxLength={field.max}
          required={field.required}
          style={{ minWidth: 120 }}
          disabled={(!field.required && !isset) || disabled}
          helpText={helpText}
        />
      );
    case "integer":
    case "float":
      return (
        <NumberSchemaField
          field={field}
          value={value}
          setValue={setValue}
          label={label}
          labelClassName={labelClassName}
          containerClassName={containerClassName}
          helpText={helpText}
          disabled={(!field.required && !isset) || disabled}
        />
      );
  }
}

function parseNumberInput(
  value: string,
): { valid: true; value: number | undefined } | { valid: false } {
  if (value === "") {
    return { valid: true, value: undefined };
  }

  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? { valid: true, value: parsed }
    : { valid: false };
}

// Keeps in-progress text in local state so typing e.g. "1.05" isn't reformatted mid-keystroke.
function NumberSchemaField<T = unknown>({
  field,
  value,
  setValue,
  label,
  labelClassName,
  containerClassName,
  helpText,
  disabled = false,
}: {
  field: SchemaField;
  value: T;
  setValue: (value: T) => void;
  label?: ReactNode;
  labelClassName?: string;
  containerClassName?: string;
  helpText?: ReactNode;
  disabled?: boolean;
}): ReactElement {
  const numericValue =
    (value ?? null) === null ? undefined : (value as unknown as number);

  const [text, setText] = useState(
    numericValue === undefined ? "" : String(numericValue),
  );

  useEffect(() => {
    setText((currentText) => {
      const parsed = parseNumberInput(currentText);
      if (parsed.valid && parsed.value === numericValue) return currentText;
      return numericValue === undefined ? "" : String(numericValue);
    });
  }, [numericValue]);

  return (
    <Field
      containerClassName={containerClassName}
      labelClassName={labelClassName}
      label={label}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        const parsed = parseNumberInput(raw);
        setText(raw);
        if (parsed.valid) {
          setValue(parsed.value as T);
        }
      }}
      type="number"
      step={field.type === "integer" ? "1" : "any"}
      min={field.min}
      max={field.max}
      required={field.required}
      style={{ minWidth: 80 }}
      disabled={disabled}
      helpText={helpText}
    />
  );
}

function SimpleSchemaEditor({
  schema,
  value,
  setValue,
  renderInline,
  label,
  placeholder,
  disabled = false,
}: {
  schema: SimpleSchema;
  value: string;
  setValue: (value: string) => void;
  renderInline?: boolean;
  label?: string | ReactNode;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 800,
  });

  const fallback = (
    <JSONTextEditor
      value={value}
      setValue={setValue}
      label={label}
      placeholder={placeholder}
      disabled={disabled}
      showCopyButton={true}
      performCopy={performCopy}
      copySuccess={copySuccess}
    />
  );

  let valueParsed: unknown = null;
  try {
    valueParsed = value ? JSON.parse(value) : null;
  } catch (e) {
    // Ignore
  }

  // Single primitive value
  if (schema.type === "primitive") {
    const field = schema.fields[0];
    if (!field) return fallback;

    return (
      <SimpleSchemaPrimitiveEditor
        field={field}
        value={valueParsed}
        setValue={(v) => setValue(JSON.stringify(v))}
        label={label}
        showDescription={true}
        disabled={disabled}
      />
    );
  }
  // Array of primitive values (using multi-select)
  if (schema.type === "primitive[]") {
    const field = schema.fields[0];
    if (!field) return fallback;
    // Don't really know what to render for an array of booleans
    if (field.type === "boolean") return fallback;
    if (!valueParsed) valueParsed = [];
    if (!Array.isArray(valueParsed)) return fallback;

    const options = field.enum.length
      ? field.enum.map((v) => ({
          label: v,
          value: v,
        }))
      : valueParsed.map((v) => ({
          label: v + "",
          value: v + "",
        }));

    return (
      <MultiSelectField
        options={options}
        value={valueParsed.map((v) => v + "")}
        onChange={(v) => {
          // If the field is a number, we need to convert the value to a number
          if (field.type === "float" || field.type === "integer") {
            setValue(
              JSON.stringify(
                v.map((v) => parseFloat(v)).filter((v) => !isNaN(v)),
              ),
            );
          } else {
            setValue(JSON.stringify(v));
          }
        }}
        placeholder="Select options"
        creatable={!field.enum.length}
        label={label}
        disabled={disabled}
      />
    );
  }

  if (!renderInline) {
    return (
      <>
        {open ? (
          <Modal
            useRadixButton={false}
            trackingEventModalType=""
            open={true}
            header="Edit Value"
            size="lg"
            close={() => {
              setOpen(false);
            }}
            submit={async () => {
              setValue(tempValue);
            }}
            cta="Save"
            // Render with a higher z-index so it sits on top of other open modals
            increasedElevation={true}
          >
            <SimpleSchemaObjectArrayEditor
              type={schema.type}
              value={tempValue}
              setValue={setTempValue}
              fields={schema.fields}
              label={label}
              placeholder={placeholder}
              disabled={disabled}
            />
          </Modal>
        ) : null}
        <div>
          <Field
            textarea
            value={stringify(valueParsed)}
            maxRows={5}
            disabled
            label={label}
          />
          {!disabled && (
            <a
              href="#"
              className="text-purple"
              onClick={(e) => {
                e.preventDefault();
                setTempValue(value);
                setOpen(true);
              }}
            >
              Edit Value <BsBoxArrowUpRight style={{ marginTop: -3 }} />
            </a>
          )}
        </div>
      </>
    );
  }

  // Render inline
  return (
    <SimpleSchemaObjectArrayEditor
      type={schema.type}
      value={value}
      setValue={setValue}
      fields={schema.fields}
      label={label}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

function JSONTextEditor({
  label,
  labelClassName,
  editAsForm,
  value,
  setValue,
  helpText,
  placeholder,
  disabled = false,
  showCopyButton = false,
  performCopy,
  copySuccess,
}: {
  label?: string | ReactNode;
  labelClassName?: string;
  editAsForm?: () => void;
  value: string;
  setValue: (value: string) => void;
  helpText?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  showCopyButton?: boolean;
  performCopy?: (text: string) => void;
  copySuccess?: boolean;
}) {
  return (
    <div className="mb-2">
      <div style={{ position: "relative" }}>
        <Field
          labelClassName={
            editAsForm ? "d-flex w-100" : labelClassName ? labelClassName : ""
          }
          containerClassName="mb-0"
          placeholder={placeholder}
          disabled={disabled}
          label={
            editAsForm ? (
              <>
                <div>{label}</div>
                {editAsForm && (
                  <div className="ml-auto">
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        editAsForm();
                      }}
                    >
                      Edit as Form
                    </a>
                  </div>
                )}
              </>
            ) : (
              label
            )
          }
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          textarea
          minRows={1}
        />
        {showCopyButton && performCopy && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              right: 16,
              zIndex: 1000,
            }}
          >
            <Tooltip body={copySuccess ? "Copied" : "Copy to clipboard"}>
              <IconButton
                type="button"
                radius="full"
                variant="ghost"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!copySuccess) performCopy(value);
                }}
              >
                {copySuccess ? <PiCheck size={12} /> : <PiCopy size={12} />}
              </IconButton>
            </Tooltip>
          </div>
        )}
      </div>
      {helpText && <div className="small form-text text-muted">{helpText}</div>}
    </div>
  );
}

function SimpleSchemaObjectArrayEditor({
  type,
  value,
  fields,
  setValue,
  label,
  placeholder,
  disabled = false,
}: {
  type: "object" | "object[]";
  value: string;
  setValue: (value: string) => void;
  fields: SchemaField[];
  label?: string | ReactNode;
  placeholder?: string;
  disabled?: boolean;
}) {
  let valueParsed: unknown;
  try {
    valueParsed = value === "" ? {} : JSON.parse(value);
  } catch (e) {
    // Ignore
  }
  const simpleEditorAllowed = !!valueParsed;

  const [rawJSONInput, setRawJSONInput] = useState(!simpleEditorAllowed);

  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 800,
  });

  const fallback = (
    <JSONTextEditor
      label={label}
      value={value}
      setValue={setValue}
      editAsForm={
        simpleEditorAllowed
          ? () => {
              setRawJSONInput(false);
            }
          : undefined
      }
      placeholder={placeholder}
      disabled={disabled}
      showCopyButton={true}
      performCopy={performCopy}
      copySuccess={copySuccess}
    />
  );

  if (rawJSONInput || !simpleEditorAllowed) return fallback;

  // Object - Render each field as a separate input
  if (type === "object") {
    const obj = (valueParsed as Record<string, unknown>) || {};
    return (
      <div className="form-group">
        <div className="d-flex">
          <label>{label}</label>
          {!disabled && (
            <a
              href="#"
              className="ml-auto"
              onClick={(e) => {
                e.preventDefault();
                setRawJSONInput(true);
              }}
            >
              Edit as JSON
            </a>
          )}
        </div>
        <div className="appbox bg-light px-3 pt-3">
          {fields.map((field) => {
            const value = obj[field.key];
            return (
              <SimpleSchemaPrimitiveEditor
                label={field.key}
                key={field.key}
                field={field}
                value={value}
                disabled={disabled}
                setValue={(v) => {
                  setValue(
                    JSON.stringify({
                      ...obj,
                      [field.key]: v,
                    }),
                  );
                }}
                showDescription={true}
              />
            );
          })}
        </div>
      </div>
    );
  }
  // Array of Objects - Render as a table
  if (type === "object[]") {
    let items = (valueParsed as Record<string, unknown>[]) || [];
    if (!items || !Array.isArray(items)) items = [];
    return (
      <div className="form-group">
        <div className="d-flex">
          <label>{label}</label>
          <a
            href="#"
            className="ml-auto"
            onClick={(e) => {
              e.preventDefault();
              setRawJSONInput(true);
            }}
          >
            Edit as JSON
          </a>
        </div>
        <div style={{ overflowX: "auto" }} className="mb-3">
          <table
            className="table w-auto mb-0 bg-light border"
            style={{ minWidth: "100%" }}
          >
            <thead>
              <tr>
                <th></th>
                {fields.map((field) => (
                  <th key={field.key}>
                    {field.key}{" "}
                    {field.description ? (
                      <Tooltip body={field.description} />
                    ) : null}
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={fields.length + 2}>
                    <em>No items</em>
                  </td>
                </tr>
              ) : null}
              {items.map((item, i) => {
                return (
                  <tr key={i}>
                    <td className="px-0 text-right">
                      <div style={{ paddingTop: 6 }}>{i + 1}</div>
                    </td>
                    {fields.map((field) => (
                      <td key={field.key}>
                        <SimpleSchemaPrimitiveEditor
                          field={field}
                          value={item[field.key]}
                          setValue={(v) => {
                            const newItems = [...items];
                            newItems[i] = {
                              ...newItems[i],
                              [field.key]: v,
                            };
                            setValue(JSON.stringify(newItems));
                          }}
                        />
                      </td>
                    ))}
                    <td className="px-0">
                      <a
                        className="text-danger"
                        href="#"
                        style={{
                          verticalAlign: "middle",
                          fontSize: "1.2em",
                          paddingTop: 2,
                          display: "block",
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          const newItems = [...items];
                          newItems.splice(i, 1);
                          setValue(JSON.stringify(newItems));
                        }}
                      >
                        <FaRegTrashAlt />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="d-flex">
          <a
            href="#"
            className="text-purple"
            onClick={(e) => {
              e.preventDefault();
              setValue(
                JSON.stringify([
                  ...items,
                  Object.fromEntries(
                    fields.map((field) => [
                      field.key,
                      field.default
                        ? JSON.parse(field.default)
                        : field.type === "boolean"
                          ? false
                          : field.type === "string"
                            ? ""
                            : 0,
                    ]),
                  ),
                ]),
              );
            }}
          >
            <GBAddCircle className="mr-1" /> Add Row
          </a>
          <a
            href="#"
            className="ml-auto text-danger"
            onClick={(e) => {
              e.preventDefault();
              setValue("[]");
            }}
          >
            Clear All
          </a>
        </div>
      </div>
    );
  }

  return fallback;
}

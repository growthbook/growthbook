import { ReactNode, forwardRef, useImperativeHandle, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiX } from "react-icons/pi";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  evaluateInvariants,
  describeInvariantRule,
  invariantRuleFields,
  defaultInvariantMessage,
} from "shared/util";
import type { ConfigInvariant } from "shared/util";
import {
  ALL_OPS,
  isComp,
  conditionToMongo,
  parseCondition,
} from "@/components/Configs/invariantConditions";
import type {
  CondOp,
  Condition,
} from "@/components/Configs/invariantConditions";
import {
  AddConditionButton,
  ConditionRow,
  ConditionRowLabel,
} from "@/components/Features/TargetingConditionsCard";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import MarkdownLinks from "@/components/Markdown/MarkdownLinks";
import HelperText from "@/ui/HelperText";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField, {
  FormatOptionLabelType,
} from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import FormatJsonAction from "@/components/Features/FormatJsonAction";

// A rule edit, by rule name, so it still finds its rule in another revision.
export type RuleRequest =
  | { kind: "add" }
  | { kind: "edit" | "delete"; name: string };

// Runs a rule edit asked for before its draft was showing.
export type RulesEditorHandle = { run: (request: RuleRequest) => void };

// A rule from a Config this one builds on, which applies here too.
export type InheritedInvariant = {
  invariant: ConfigInvariant;
  sourceKey: string;
  sourceName: string;
};

type Props = {
  invariants: ConfigInvariant[];
  // A rule here with the same name replaces the inherited one.
  inherited?: InheritedInvariant[];
  // Field keys available to reference in rules (effective schema fields plus
  // stray value keys, so existing rules stay representable).
  fieldKeys: string[];
  // Keys the effective SCHEMA declares. A rule referencing anything else gets
  // an inline "reads as null" hint (undeclared fields resolve to null at
  // evaluation time — usually a typo or a field an ancestor removed).
  declaredKeys?: string[];
  // The resolved (inherited+own) value, for live pass/fail feedback.
  resolvedValue: Record<string, unknown>;
  canEdit: boolean;
  // Shows Add rule disabled, with this reason.
  blockedReason?: string | null;
  // From live, rule edits go here, to open a draft first.
  onEditInDraft?: (request: RuleRequest) => void | Promise<void>;
  // Where edits from live go.
  draftNote?: ReactNode;
  onChange: (next: ConfigInvariant[]) => Promise<void>;
};

// ---- Condition model -------------------------------------------------------
// A condition is one predicate over a single field. Conditions within a group
// are AND-joined (matching the feature-targeting builder); rule kinds compose
// one or two groups. Rules are emitted as mongo conditions (mongrule syntax,
// with `$ref` for field-to-field) — the canonical stored form; see the evaluator
// in shared/util/config-schema.

// Labels match the standard condition-builder language used in feature/
// experiment targeting (see Features/ConditionInput.tsx) so operators read
// consistently across the product.
const OP_LABELS: Record<CondOp, MessageDescriptor> = {
  "==": msg`is equal to`,
  "!=": msg`is not equal to`,
  "<": msg`is less than`,
  "<=": msg`is less than or equal to`,
  ">": msg`is greater than`,
  ">=": msg`is greater than or equal to`,
  isTrue: msg`is true`,
  isFalse: msg`is false`,
  isNull: msg`is NULL`,
  isNotNull: msg`is not NULL`,
};

// Leading glyph per comparison operator (mirrors the targeting condition builder
// — Features/conditionOperatorOptions, arriving in #5743); unary operators have
// none. Rendered in a fixed-width box so the labels line up.
const OP_ICON: Partial<Record<CondOp, string>> = {
  "==": "=",
  "!=": "≠",
  "<": "<",
  "<=": "≤",
  ">": ">",
  ">=": "≥",
};

const formatOperatorOption: FormatOptionLabelType = (opt, { context }) => {
  const icon = OP_ICON[opt.value as CondOp] || "";
  // Selected value: the glyph for comparisons, the full label otherwise.
  if (context === "value") return icon || opt.label;
  return (
    <span style={{ display: "flex", alignItems: "center" }}>
      <span
        style={{
          width: 20,
          flexShrink: 0,
          textAlign: "center",
          fontFamily: "var(--code-font-family)",
          marginRight: 6,
        }}
      >
        {icon}
      </span>
      {opt.label}
    </span>
  );
};

// A group is an AND-joined list of conditions.
type Group = Condition[];

type RuleKind = "single" | "implication";

const RULE_KIND_OPTIONS: { label: MessageDescriptor; value: RuleKind }[] = [
  { label: msg`Conditions that must hold`, value: "single" },
  { label: msg`If … then …`, value: "implication" },
];

const RULE_KIND_HINTS: Record<RuleKind, MessageDescriptor> = {
  single: msg`All of these conditions must hold.`,
  implication: msg`When the IF conditions all hold, the THEN conditions must too.`,
};

// What keeps a builder condition from saving, and which group it's in.
type ConditionProblem = "field" | "compareField" | "value";
type GroupName = "rule" | "first" | "second";

function conditionProblem(c: Condition): ConditionProblem | null {
  if (!c.field) return "field";
  if (isComp(c.op)) {
    if (c.rhsKind === "field" && !c.rhs) return "compareField";
    if (c.rhsKind === "value" && c.rhs.trim() === "") return "value";
  }
  return null;
}

function newCondition(field: string): Condition {
  return { field, op: "==", rhsKind: "value", rhs: "" };
}

function groupToMongo(g: Group): Record<string, unknown> {
  const parts = g.map(conditionToMongo);
  return parts.length === 1 ? parts[0] : { $and: parts };
}

function buildRule(
  kind: RuleKind,
  a: Group,
  b: Group,
): Record<string, unknown> {
  switch (kind) {
    case "single":
      return groupToMongo(a);
    case "implication":
      // A → B  ≡  ¬A ∨ B
      return { $or: [{ $not: groupToMongo(a) }, groupToMongo(b)] };
  }
}

// A single condition, or a `$and` group of conditions. OR groups aren't builder-
// representable → null (they open in the Advanced editor).
function parseGroup(node: unknown): Group | null {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === "$and" && Array.isArray(obj.$and)) {
      const conds = (obj.$and as unknown[]).map(parseCondition);
      if (conds.length > 0 && conds.every((c): c is Condition => c !== null)) {
        return conds;
      }
      return null;
    }
  }
  const single = parseCondition(node);
  return single ? [single] : null;
}

type ParsedRule = { kind: RuleKind; groupA: Group; groupB?: Group };

// Best-effort: recognize a stored rule as one of the builder kinds so it can be
// edited visually. Anything else (incl. OR groups) returns null → Advanced.
function parseRule(obj: Record<string, unknown>): ParsedRule | null {
  const keys = Object.keys(obj);
  if (keys.length !== 1) return null;
  const op = keys[0];
  const arg = obj[op];

  if (op === "$or" && Array.isArray(arg) && arg.length === 2) {
    // Implication: {$or: [{$not: A}, B]}
    const x = arg[0];
    if (
      x &&
      typeof x === "object" &&
      !Array.isArray(x) &&
      Object.keys(x).length === 1 &&
      "$not" in (x as object)
    ) {
      const gA = parseGroup((x as Record<string, unknown>).$not);
      const gB = parseGroup(arg[1]);
      if (gA && gB) return { kind: "implication", groupA: gA, groupB: gB };
    }
    // Anything else (incl. the biconditional $and/$nor shape) → Advanced.
    return null;
  }

  // Single $and-group.
  if (op === "$and" && Array.isArray(arg)) {
    const g = parseGroup(obj);
    if (g) return { kind: "single", groupA: g };
    return null;
  }

  // Single field condition.
  const c = parseCondition(obj);
  if (c) return { kind: "single", groupA: [c] };

  return null;
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(text);
    return p && typeof p === "object" && !Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

// Named cross-field rules on a config schema, built with the same condition-row
// layout as feature targeting: field · operator · value rows joined by AND, with
// IF/THEN framing for the relational kinds. An "Advanced" toggle swaps in a raw
// mongo-condition editor for anything the builder can't represent.
export default forwardRef<RulesEditorHandle, Props>(
  function ConfigInvariantsEditor(
    {
      invariants,
      inherited = [],
      fieldKeys,
      declaredKeys,
      resolvedValue,
      canEdit,
      blockedReason = null,
      onEditInDraft,
      draftNote = null,
      onChange,
    },
    ref,
  ) {
    const { t, i18n } = useLingui();
    // null = closed, -1 = adding, >=0 = editing that row.
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [name, setName] = useState("");
    const [message, setMessage] = useState("");
    const [advanced, setAdvanced] = useState(false);
    const [advancedLocked, setAdvancedLocked] = useState(false);
    const [ruleText, setRuleText] = useState("{}");
    const [kind, setKind] = useState<RuleKind>("single");
    const [groupA, setGroupA] = useState<Group>([
      newCondition(fieldKeys[0] ?? ""),
    ]);
    const [groupB, setGroupB] = useState<Group>([
      newCondition(fieldKeys[0] ?? ""),
    ]);
    // Surfaced for row-level actions (delete); the add/edit modal shows its own errors.
    const [listError, setListError] = useState<string | null>(null);

    const currentRule = advanced
      ? safeParse(ruleText)
      : buildRule(kind, groupA, groupB);

    const applyParsed = (b: ParsedRule) => {
      setKind(b.kind);
      setGroupA(b.groupA);
      setGroupB(b.groupB ?? [newCondition(fieldKeys[0] ?? "")]);
    };

    const open = (index: number) => {
      setEditingIndex(index);
      setAdvancedLocked(false);
      const inv = index >= 0 ? invariants[index] : undefined;
      setName(inv?.name ?? "");
      setMessage(inv?.message ?? "");
      if (!inv) {
        // New rule: start in the builder with a single blank condition.
        setKind("single");
        setGroupA([newCondition(fieldKeys[0] ?? "")]);
        setGroupB([newCondition(fieldKeys[0] ?? "")]);
        setAdvanced(false);
        setRuleText("{}");
        return;
      }
      const parsed = safeParse(inv.rule);
      const b = parsed ? parseRule(parsed) : null;
      if (b) {
        applyParsed(b);
        setAdvanced(false);
        setRuleText(parsed ? JSON.stringify(parsed, null, 2) : "{}");
      } else {
        // Existing rule the builder can't represent → open in Advanced.
        setAdvanced(true);
        setRuleText(parsed ? JSON.stringify(parsed, null, 2) : inv.rule);
      }
    };
    const close = () => {
      setEditingIndex(null);
    };

    const onKindChange = (k: RuleKind) => {
      setKind(k);
    };

    const toggleAdvanced = (checked: boolean) => {
      if (checked) {
        setRuleText(JSON.stringify(buildRule(kind, groupA, groupB), null, 2));
        setAdvanced(true);
        setAdvancedLocked(false);
      } else {
        const b = parseRule(safeParse(ruleText) ?? {});
        if (!b) {
          // Switching anyway would discard the raw rule for stale builder state.
          setAdvancedLocked(true);
          return;
        }
        applyParsed(b);
        setAdvanced(false);
        setAdvancedLocked(false);
      }
    };

    // A condition's error, naming its group and, in a group of several, its
    // position.
    const conditionError = (
      problem: ConditionProblem,
      group: GroupName,
      n: number | null,
    ): string => {
      switch (group) {
        case "rule":
          if (problem === "field") {
            return n === null
              ? t`Choose a field for the rule.`
              : t`Choose a field for the rule condition ${n}.`;
          }
          if (problem === "compareField") {
            return n === null
              ? t`Choose a field to compare to for the rule.`
              : t`Choose a field to compare to for the rule condition ${n}.`;
          }
          return n === null
            ? t`Enter a value for the rule.`
            : t`Enter a value for the rule condition ${n}.`;
        case "first":
          if (problem === "field") {
            return n === null
              ? t`Choose a field for the first group.`
              : t`Choose a field for the first group condition ${n}.`;
          }
          if (problem === "compareField") {
            return n === null
              ? t`Choose a field to compare to for the first group.`
              : t`Choose a field to compare to for the first group condition ${n}.`;
          }
          return n === null
            ? t`Enter a value for the first group.`
            : t`Enter a value for the first group condition ${n}.`;
        case "second":
          if (problem === "field") {
            return n === null
              ? t`Choose a field for the second group.`
              : t`Choose a field for the second group condition ${n}.`;
          }
          if (problem === "compareField") {
            return n === null
              ? t`Choose a field to compare to for the second group.`
              : t`Choose a field to compare to for the second group condition ${n}.`;
          }
          return n === null
            ? t`Enter a value for the second group.`
            : t`Enter a value for the second group condition ${n}.`;
      }
    };

    const validateGroup = (g: Group, group: GroupName): string | null => {
      for (let i = 0; i < g.length; i++) {
        const problem = conditionProblem(g[i]);
        if (problem) {
          return conditionError(problem, group, g.length > 1 ? i + 1 : null);
        }
      }
      return null;
    };

    const validateBuilder = (): string | null => {
      const twoSided = kind === "implication";
      const a = validateGroup(groupA, twoSided ? "first" : "rule");
      if (a) return a;
      if (twoSided) return validateGroup(groupB, "second");
      return null;
    };

    const save = async () => {
      if (!name.trim()) throw new Error(t`Name is required.`);
      if (!advanced) {
        const err = validateBuilder();
        if (err) throw new Error(err);
      }
      const rule = advanced
        ? safeParse(ruleText)
        : buildRule(kind, groupA, groupB);
      if (!rule) throw new Error(t`Rule must be a valid rule object.`);
      const next: ConfigInvariant = {
        name: name.trim(),
        rule: JSON.stringify(rule),
        message: message.trim() || defaultInvariantMessage(name),
      };
      const list =
        editingIndex !== null && editingIndex >= 0
          ? invariants.map((iv, i) => (i === editingIndex ? next : iv))
          : [...invariants, next];
      await onChange(list);
    };

    const remove = async (index: number) => {
      setListError(null);
      try {
        await onChange(invariants.filter((_, i) => i !== index));
      } catch (e) {
        setListError(e instanceof Error ? e.message : t`Failed to remove rule`);
      }
    };

    const runRequest = (r: RuleRequest) => {
      if (r.kind === "add") {
        open(-1);
        return;
      }
      const index = invariants.findIndex((iv) => iv.name === r.name);
      if (index < 0) {
        const ruleName = r.name;
        setListError(t`This draft has no "${ruleName}" rule.`);
        return;
      }
      if (r.kind === "edit") open(index);
      else void remove(index);
    };
    const act = (r: RuleRequest) =>
      onEditInDraft ? onEditInDraft(r) : runRequest(r);
    useImperativeHandle(ref, () => ({ run: runRequest }));

    const previewFails = currentRule
      ? evaluateInvariants(resolvedValue, [
          { name, rule: JSON.stringify(currentRule), message },
        ]).length > 0
      : null;

    const undeclaredIn = (ruleJson: string): string[] => {
      if (!declaredKeys) return [];
      const declared = new Set(declaredKeys);
      return invariantRuleFields(ruleJson).filter((k) => !declared.has(k));
    };
    const previewUndeclared = currentRule
      ? undeclaredIn(JSON.stringify(currentRule))
      : [];
    const previewUndeclaredNames = previewUndeclared
      .map((k) => `"${k}"`)
      .join(", ");

    const inheritedByName = new Map(
      inherited.map((r) => [r.invariant.name, r]),
    );
    const ownNames = new Set(invariants.map((iv) => iv.name));
    const shownInherited = inherited.filter(
      (r) => !ownNames.has(r.invariant.name),
    );
    const replaces = (ruleName: string) => {
      const r = inheritedByName.get(ruleName.trim());
      if (!r) return null;
      const inheritedName = r.invariant.name;
      const sourceName = r.sourceName;
      return t`Replaces the "${inheritedName}" rule from ${sourceName}.`;
    };

    // A rule with its live pass/fail against the resolved value.
    const ruleCard = (
      iv: ConfigInvariant,
      key: string,
      { actions, warning }: { actions?: ReactNode; warning?: string | null },
    ) => {
      const fails = evaluateInvariants(resolvedValue, [iv]).length > 0;
      const undeclared = undeclaredIn(iv.rule);
      const undeclaredNames = undeclared.map((k) => `"${k}"`).join(", ");
      return (
        <Frame mb="2" key={key}>
          <Flex align="center" gap="2">
            <Text weight="semibold">{iv.name}</Text>
            <Badge
              color={fails ? "red" : "green"}
              variant="soft"
              label={fails ? t`fails` : t`ok`}
            />
            {actions ? (
              <Flex gap="2" ml="auto" align="center">
                {actions}
              </Flex>
            ) : null}
          </Flex>
          <Box
            mt="1"
            style={{
              fontFamily: "var(--code-font-family)",
              fontSize: 12,
              color: "var(--gray-11)",
              wordBreak: "break-all",
            }}
          >
            {describeInvariantRule(iv.rule)}
          </Box>
          {undeclared.length > 0 && (
            <Text as="div" size="sm" color="text-low" mt="1">
              {undeclared.length === 1 ? (
                <Trans>
                  References undeclared field {undeclaredNames}, which reads as
                  null.
                </Trans>
              ) : (
                <Trans>
                  References undeclared fields {undeclaredNames}, which read as
                  null.
                </Trans>
              )}
            </Text>
          )}
          <Text as="div" size="sm" color="text-low" mt="1">
            {iv.message}
          </Text>
          {warning && (
            <HelperText status="warning" size="sm" mt="1">
              {warning}
            </HelperText>
          )}
        </Frame>
      );
    };

    const fieldOptions = fieldKeys.map((k) => ({ label: k, value: k }));

    // One AND-joined group rendered as ConditionRows (field · operator · value),
    // matching the feature-targeting builder. `leadLabel` prefixes the first row
    // (e.g. IF / THEN); subsequent rows read AND.
    const groupBlock = (
      g: Group,
      setG: (g: Group) => void,
      leadLabel: string | null,
    ) => {
      const setAt = (i: number, c: Condition) =>
        setG(g.map((x, j) => (j === i ? c : x)));
      return (
        <Box>
          {g.map((c, i) => (
            <Box key={i} mt={i > 0 ? "2" : "0"}>
              <ConditionRow
                prefixSlot={
                  <ConditionRowLabel
                    label={i === 0 ? (leadLabel ?? "") : t`AND`}
                  />
                }
                attributeSlot={
                  <SelectField
                    label=""
                    value={c.field}
                    onChange={(v) => setAt(i, { ...c, field: v })}
                    options={fieldOptions}
                    placeholder={t`field`}
                  />
                }
                operatorSlot={
                  <SelectField
                    label=""
                    value={c.op}
                    onChange={(v) => setAt(i, { ...c, op: v as CondOp })}
                    options={ALL_OPS.map((o) => ({
                      label: i18n._(OP_LABELS[o]),
                      value: o,
                    }))}
                    formatOptionLabel={formatOperatorOption}
                    sort={false}
                  />
                }
                valueSlot={
                  isComp(c.op) ? (
                    <Flex gap="2" align="start">
                      <Box style={{ width: 110, flexShrink: 0 }}>
                        <SelectField
                          label=""
                          value={c.rhsKind}
                          onChange={(v) =>
                            setAt(i, { ...c, rhsKind: v as "value" | "field" })
                          }
                          options={[
                            { label: t`a value`, value: "value" },
                            { label: t`a field`, value: "field" },
                          ]}
                          sort={false}
                        />
                      </Box>
                      <Box style={{ flex: "1 1 0", minWidth: 120 }}>
                        {c.rhsKind === "field" ? (
                          <SelectField
                            label=""
                            value={c.rhs}
                            onChange={(v) => setAt(i, { ...c, rhs: v })}
                            options={fieldOptions}
                            placeholder={t`field`}
                          />
                        ) : (
                          <Field
                            value={c.rhs}
                            onChange={(e) =>
                              setAt(i, { ...c, rhs: e.target.value })
                            }
                            placeholder={`text, 5, true, {"a":1}`}
                          />
                        )}
                      </Box>
                    </Flex>
                  ) : undefined
                }
                removeSlot={
                  g.length > 1 ? (
                    <IconButton
                      type="button"
                      color="gray"
                      variant="ghost"
                      radius="full"
                      size="1"
                      onClick={() => setG(g.filter((_, j) => j !== i))}
                    >
                      <PiX size={14} />
                    </IconButton>
                  ) : (
                    // Reserve the column so a single-condition row aligns with
                    // multi-condition rows (the last condition can't be removed).
                    <Box style={{ width: 24, height: 24 }} />
                  )
                }
              />
            </Box>
          ))}
          <Box mt="2" py="1">
            <AddConditionButton
              onClick={() => setG([...g, newCondition(fieldKeys[0] ?? "")])}
            />
          </Box>
        </Box>
      );
    };

    const builder = (
      <Box>
        <SelectField
          label={t`Rule type`}
          value={kind}
          onChange={(v) => onKindChange(v as RuleKind)}
          options={RULE_KIND_OPTIONS.map((o) => ({
            label: i18n._(o.label),
            value: o.value,
          }))}
          sort={false}
          helpText={i18n._(RULE_KIND_HINTS[kind])}
        />
        <Box mt="3">
          {kind === "single" && groupBlock(groupA, setGroupA, null)}
          {kind === "implication" && (
            <>
              {groupBlock(groupA, setGroupA, t`IF`)}
              <Box mt="3">{groupBlock(groupB, setGroupB, t`THEN`)}</Box>
            </>
          )}
        </Box>
      </Box>
    );

    const isEditingExisting = editingIndex !== null && editingIndex >= 0;

    const editorBody = (
      <>
        <Field
          label={t`Name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t`e.g. start_before_end`}
          error={replaces(name)}
          errorLevel="warning"
        />

        <Flex justify="between" align="center" mt="4" mb="2">
          <Text as="label" weight="semibold">
            <Trans>Rule</Trans>
          </Text>
          <Switch
            value={advanced}
            onChange={toggleAdvanced}
            label={t`Advanced (raw rule)`}
            size="sm"
          />
        </Flex>

        {advanced && advancedLocked && (
          <HelperText status="warning" size="sm" mb="2">
            <Trans>
              This rule can&apos;t be shown in the builder. Edit it as raw JSON.
            </Trans>
          </HelperText>
        )}
        {advanced ? (
          <CodeTextArea
            language="json"
            value={ruleText}
            setValue={(v) => {
              setRuleText(v);
              setAdvancedLocked(false);
            }}
            minLines={4}
            maxLines={16}
            slimGutter
            resizable
            showCopyButton
            showFullscreenButton
            actions={
              <FormatJsonAction value={ruleText} setValue={setRuleText} />
            }
            helpText={t`A boolean expression over the fields.`}
          />
        ) : (
          builder
        )}

        {currentRule && (
          <Box
            mt="3"
            style={{
              fontFamily: "var(--code-font-family)",
              fontSize: 12,
              color: "var(--gray-11)",
              wordBreak: "break-all",
            }}
          >
            {describeInvariantRule(JSON.stringify(currentRule))}
          </Box>
        )}

        <Box mt="3">
          <Field
            label={t`Error message (optional)`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              name.trim()
                ? defaultInvariantMessage(name)
                : t`Shown to editors when the rule is violated`
            }
            helpText={t`Shown to editors when the rule is violated. Defaults to a generic message if left blank.`}
          />
        </Box>

        {currentRule && (
          <Box mt="2">
            <Badge
              color={previewFails ? "red" : "green"}
              variant="soft"
              label={
                previewFails
                  ? t`Current value would fail this rule`
                  : t`Current value passes this rule`
              }
            />
            {previewUndeclared.length > 0 && (
              <Text as="div" size="sm" color="text-low" mt="1">
                {previewUndeclared.length === 1 ? (
                  <Trans>
                    References undeclared field {previewUndeclaredNames}, which
                    reads as null. Check for a typo.
                  </Trans>
                ) : (
                  <Trans>
                    References undeclared fields {previewUndeclaredNames}, which
                    read as null. Check for a typo.
                  </Trans>
                )}
              </Text>
            )}
          </Box>
        )}
      </>
    );

    return (
      <Frame mb="4" px="6" py="4">
        <Flex align="center" justify="between" mb="1">
          <Heading as="h3" size="md" mb="0">
            <Trans>Validation Rules</Trans>
          </Heading>
          {canEdit && (
            <Tooltip content={blockedReason} enabled={!!blockedReason}>
              <Button
                disabled={!!blockedReason}
                onClick={() => act({ kind: "add" })}
              >
                <Trans>Add rule</Trans>
              </Button>
            </Tooltip>
          )}
        </Flex>
        <Box mb="3">
          <Text as="p" size="sm" color="text-low" fontStyle="italic">
            <Trans>
              Cross-field checks on the resolved value before this Config is
              published.
            </Trans>
          </Text>
          {draftNote ? (
            <Text as="p" size="sm" color="text-low" mt="1">
              {draftNote}
            </Text>
          ) : null}
        </Box>

        {listError && (
          <Callout status="error" mb="3">
            <MarkdownLinks text={listError} />
          </Callout>
        )}

        {invariants.length === 0 && (
          <Text color="text-low">
            <em>
              {inherited.length
                ? t`None defined here yet.`
                : t`No validation rules yet.`}
            </em>
          </Text>
        )}

        {invariants.map((iv, i) =>
          ruleCard(iv, `own-${i}`, {
            actions: canEdit && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!blockedReason}
                  onClick={() => act({ kind: "edit", name: iv.name })}
                >
                  <Trans>Edit</Trans>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  color="red"
                  disabled={!!blockedReason}
                  onClick={() => act({ kind: "delete", name: iv.name })}
                >
                  <Trans>Remove</Trans>
                </Button>
              </>
            ),
            warning: replaces(iv.name),
          }),
        )}

        {shownInherited.length > 0 && (
          <>
            <Heading as="h4" size="sm" mt="4" mb="3">
              <Trans>Inherited Rules</Trans>
            </Heading>
            {shownInherited.map((r) => {
              const sourceName = r.sourceName;
              return ruleCard(r.invariant, `inherited-${r.invariant.name}`, {
                actions: (
                  <Text size="sm" color="text-low">
                    <Trans>
                      From{" "}
                      <Link href={`/configs/${r.sourceKey}`}>{sourceName}</Link>
                    </Trans>
                  </Text>
                ),
              });
            })}
          </>
        )}

        {editingIndex !== null && (
          <ModalStandard
            open
            trackingEventModalType="config-invariant-rule"
            header={
              isEditingExisting
                ? t`Edit validation rule`
                : t`Add validation rule`
            }
            size="lg"
            cta={isEditingExisting ? t`Save rule` : t`Add rule`}
            close={close}
            submit={save}
          >
            {editorBody}
          </ModalStandard>
        )}
      </Frame>
    );
  },
);

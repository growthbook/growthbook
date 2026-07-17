import { useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiXBold } from "react-icons/pi";
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
import Badge from "@/ui/Badge";
import Switch from "@/ui/Switch";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField, {
  FormatOptionLabelType,
} from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";

type Props = {
  invariants: ConfigInvariant[];
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
const OP_LABELS: Record<CondOp, string> = {
  "==": "is equal to",
  "!=": "is not equal to",
  "<": "is less than",
  "<=": "is less than or equal to",
  ">": "is greater than",
  ">=": "is greater than or equal to",
  isTrue: "is true",
  isFalse: "is false",
  isNull: "is NULL",
  isNotNull: "is not NULL",
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
          fontFamily: "monospace",
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

const RULE_KIND_OPTIONS: { label: string; value: RuleKind }[] = [
  { label: "Conditions that must hold", value: "single" },
  { label: "If … then …", value: "implication" },
];

const RULE_KIND_HINTS: Record<RuleKind, string> = {
  single: "All of these conditions must hold.",
  implication: "When the IF conditions all hold, the THEN conditions must too.",
};

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
export default function ConfigInvariantsEditor({
  invariants,
  fieldKeys,
  declaredKeys,
  resolvedValue,
  canEdit,
  onChange,
}: Props) {
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

  const validateCondition = (c: Condition, label: string): string | null => {
    if (!c.field) return `Choose a field for ${label}.`;
    if (isComp(c.op)) {
      if (c.rhsKind === "field" && !c.rhs)
        return `Choose a field to compare to for ${label}.`;
      if (c.rhsKind === "value" && c.rhs.trim() === "")
        return `Enter a value for ${label}.`;
    }
    return null;
  };

  const validateGroup = (g: Group, label: string): string | null => {
    for (let i = 0; i < g.length; i++) {
      const lbl = g.length > 1 ? `${label} condition ${i + 1}` : label;
      const e = validateCondition(g[i], lbl);
      if (e) return e;
    }
    return null;
  };

  const validateBuilder = (): string | null => {
    const twoSided = kind === "implication";
    const a = validateGroup(groupA, twoSided ? "the first group" : "the rule");
    if (a) return a;
    if (twoSided) return validateGroup(groupB, "the second group");
    return null;
  };

  const save = async () => {
    if (!name.trim()) throw new Error("Name is required.");
    if (!advanced) {
      const err = validateBuilder();
      if (err) throw new Error(err);
    }
    const rule = advanced
      ? safeParse(ruleText)
      : buildRule(kind, groupA, groupB);
    if (!rule) throw new Error("Rule must be a valid rule object.");
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
      setListError(e instanceof Error ? e.message : "Failed to delete rule");
    }
  };

  // Live pass/fail per rule against the current resolved value.
  const failing = useMemo(() => {
    const set = new Set<number>();
    invariants.forEach((iv, i) => {
      if (evaluateInvariants(resolvedValue, [iv]).length) set.add(i);
    });
    return set;
  }, [invariants, resolvedValue]);

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

  // Precompute each existing invariant's undeclared fields once — the list
  // render reads this three times per row.
  const undeclaredByIndex = useMemo(() => {
    const declared = declaredKeys ? new Set(declaredKeys) : null;
    return invariants.map((iv) =>
      declared
        ? invariantRuleFields(iv.rule).filter((k) => !declared.has(k))
        : [],
    );
  }, [invariants, declaredKeys]);

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
                  label={i === 0 ? (leadLabel ?? "") : "AND"}
                />
              }
              attributeSlot={
                <SelectField
                  label=""
                  value={c.field}
                  onChange={(v) => setAt(i, { ...c, field: v })}
                  options={fieldOptions}
                  placeholder="field"
                />
              }
              operatorSlot={
                <SelectField
                  label=""
                  value={c.op}
                  onChange={(v) => setAt(i, { ...c, op: v as CondOp })}
                  options={ALL_OPS.map((o) => ({
                    label: OP_LABELS[o],
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
                          { label: "a value", value: "value" },
                          { label: "a field", value: "field" },
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
                          placeholder="field"
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
                    <PiXBold size={14} />
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
        label="Rule type"
        value={kind}
        onChange={(v) => onKindChange(v as RuleKind)}
        options={RULE_KIND_OPTIONS}
        sort={false}
        helpText={RULE_KIND_HINTS[kind]}
      />
      <Box mt="3">
        {kind === "single" && groupBlock(groupA, setGroupA, null)}
        {kind === "implication" && (
          <>
            {groupBlock(groupA, setGroupA, "IF")}
            <Box mt="3">{groupBlock(groupB, setGroupB, "THEN")}</Box>
          </>
        )}
      </Box>
    </Box>
  );

  const isEditingExisting = editingIndex !== null && editingIndex >= 0;

  const editorBody = (
    <>
      <Field
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. start_before_end"
      />

      <Flex justify="between" align="center" mt="4" mb="2">
        <Text as="label" weight="semibold">
          Rule
        </Text>
        <Switch
          value={advanced}
          onChange={toggleAdvanced}
          label="Advanced (raw rule)"
          size="1"
        />
      </Flex>

      {advanced && advancedLocked && (
        <HelperText status="warning" size="sm" mb="2">
          This rule can&apos;t be shown in the builder — edit it as raw JSON.
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
          fontSize="0.75rem"
          slimGutter
          resizable
          showCopyButton
          showFullscreenButton
          helpText={
            <Flex justify="between" align="center">
              <span>Raw rule — a boolean expression over the fields.</span>
              <Link
                onClick={(e) => {
                  e.preventDefault();
                  const p = safeParse(ruleText);
                  if (p) setRuleText(JSON.stringify(p, null, 2));
                }}
              >
                Format JSON
              </Link>
            </Flex>
          }
        />
      ) : (
        builder
      )}

      {currentRule && (
        <Box
          mt="3"
          style={{
            fontFamily: "var(--font-mono, monospace)",
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
          label="Error message (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            name.trim()
              ? defaultInvariantMessage(name)
              : "Shown to editors when the rule is violated"
          }
          helpText="Shown to editors when the rule is violated. Defaults to a generic message if left blank."
        />
      </Box>

      {currentRule && (
        <Box mt="2">
          <Badge
            color={previewFails ? "red" : "green"}
            variant="soft"
            label={
              previewFails
                ? "Current value would fail this rule"
                : "Current value passes this rule"
            }
          />
          {previewUndeclared.length > 0 && (
            <Text as="div" size="small" color="text-low" mt="1">
              References undeclared field
              {previewUndeclared.length === 1 ? "" : "s"}{" "}
              {previewUndeclared.map((k) => `"${k}"`).join(", ")} — the schema
              doesn&apos;t declare{" "}
              {previewUndeclared.length === 1 ? "it" : "them"}, so the rule
              reads null there (check for a typo).
            </Text>
          )}
        </Box>
      )}
    </>
  );

  return (
    <Frame mb="4" px="6" py="4">
      <Flex align="center" justify="between" mb="1">
        <Heading as="h3" size="medium" mb="0">
          Validation rules
        </Heading>
        {canEdit && (
          <Button variant="ghost" onClick={() => open(-1)}>
            + Add rule
          </Button>
        )}
      </Flex>
      <Box mb="3">
        <Text as="div" size="small" color="text-low">
          <em>
            Relational checks JSON Schema can&apos;t express — evaluated against
            the resolved value at publish.
          </em>
        </Text>
      </Box>

      {listError && (
        <Callout status="error" mb="3">
          {listError}
        </Callout>
      )}

      {invariants.length === 0 && (
        <Text as="div" size="small" color="text-low">
          No cross-field rules yet — add relational checks JSON Schema
          can&apos;t express (implications, both-or-neither, or comparing two
          fields).
        </Text>
      )}

      {invariants.map((iv, i) => (
        <Frame mb="2" key={i}>
          <Flex align="center" gap="2">
            <Text weight="semibold">{iv.name}</Text>
            <Badge
              color={failing.has(i) ? "red" : "green"}
              variant="soft"
              label={failing.has(i) ? "fails" : "ok"}
            />
            {canEdit && (
              <Flex gap="2" ml="auto">
                <Button variant="ghost" size="xs" onClick={() => open(i)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  color="red"
                  onClick={() => remove(i)}
                >
                  Delete
                </Button>
              </Flex>
            )}
          </Flex>
          <Box
            mt="1"
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              color: "var(--gray-11)",
              wordBreak: "break-all",
            }}
          >
            {describeInvariantRule(iv.rule)}
          </Box>
          {undeclaredByIndex[i].length > 0 && (
            <Text as="div" size="small" color="text-low" mt="1">
              References undeclared field
              {undeclaredByIndex[i].length === 1 ? "" : "s"}{" "}
              {undeclaredByIndex[i].map((k) => `"${k}"`).join(", ")} —
              undeclared fields evaluate as null.
            </Text>
          )}
          <Text as="div" size="small" color="text-low" mt="1">
            {iv.message}
          </Text>
        </Frame>
      ))}

      {editingIndex !== null && (
        <ModalStandard
          open
          trackingEventModalType="config-invariant-rule"
          header={
            isEditingExisting ? "Edit validation rule" : "Add validation rule"
          }
          size="lg"
          cta={isEditingExisting ? "Save rule" : "Add rule"}
          close={close}
          submit={save}
        >
          {editorBody}
        </ModalStandard>
      )}
    </Frame>
  );
}

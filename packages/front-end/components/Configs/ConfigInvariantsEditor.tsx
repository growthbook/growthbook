import { useMemo, useState } from "react";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { PiXBold } from "react-icons/pi";
import { evaluateInvariants, describeInvariantRule } from "shared/util";
import type { ConfigInvariant } from "shared/util";
import {
  ConditionRow,
  ConditionRowLabel,
  AddConditionButton,
} from "@/components/Features/TargetingConditionsCard";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Switch from "@/ui/Switch";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";

type Props = {
  invariants: ConfigInvariant[];
  // Field keys available to reference in rules (effective schema).
  fieldKeys: string[];
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

const COMPARISON_OPS = ["==", "!=", "<=", "<", ">=", ">"] as const;
const UNARY_OPS = ["isTrue", "isFalse", "isNull", "isNotNull"] as const;
type CompOp = (typeof COMPARISON_OPS)[number];
type CondOp = CompOp | (typeof UNARY_OPS)[number];
const ALL_OPS: CondOp[] = [...COMPARISON_OPS, ...UNARY_OPS];

const OP_LABELS: Record<CondOp, string> = {
  "==": "equals",
  "!=": "does not equal",
  "<": "is less than",
  "<=": "is at most",
  ">": "is greater than",
  ">=": "is at least",
  isTrue: "is true",
  isFalse: "is false",
  isNull: "is empty (null)",
  isNotNull: "is set (not null)",
};

type Condition = {
  field: string;
  op: CondOp;
  rhsKind: "value" | "field";
  rhs: string;
};

// A group is an AND-joined list of conditions.
type Group = Condition[];

type RuleKind = "single" | "implication" | "iff" | "exclusive";

const RULE_KIND_OPTIONS: { label: string; value: RuleKind }[] = [
  { label: "Conditions that must hold", value: "single" },
  { label: "If … then …", value: "implication" },
  { label: "Both or neither", value: "iff" },
  { label: "Can't all be true", value: "exclusive" },
];

const RULE_KIND_HINTS: Record<RuleKind, string> = {
  single: "All of these conditions must hold.",
  implication: "When the IF conditions all hold, the THEN conditions must too.",
  iff: "The two sides must be true together, or false together.",
  exclusive: "These conditions can't all be true at the same time.",
};

function isComp(op: CondOp): op is CompOp {
  return (COMPARISON_OPS as readonly string[]).includes(op);
}

function newCondition(field: string): Condition {
  return { field, op: "==", rhsKind: "value", rhs: "" };
}

function isRef(x: unknown): x is { $ref: string } {
  return (
    !!x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Object.keys(x as object).length === 1 &&
    typeof (x as { $ref?: unknown }).$ref === "string"
  );
}

const MONGO_OP: Record<CompOp, string> = {
  "==": "$eq",
  "!=": "$ne",
  "<": "$lt",
  "<=": "$lte",
  ">": "$gt",
  ">=": "$gte",
};
const MONGO_OP_INV: Record<string, CompOp> = {
  $eq: "==",
  $ne: "!=",
  $lt: "<",
  $lte: "<=",
  $gt: ">",
  $gte: ">=",
};

// Parse a typed right-hand-side value: JSON first (so 5, true, null, "quoted",
// {objects}/[arrays] keep their type), then a bare word falls back to a string.
function parseLiteral(s: string): unknown {
  const t = s.trim();
  try {
    return JSON.parse(t);
  } catch {
    return t.replace(/^['"]|['"]$/g, "");
  }
}

// Inverse for the text input: show a string bare unless it would re-parse as a
// non-string (then quote it); everything else as JSON.
function formatLiteral(v: unknown): string {
  if (v === null) return "null";
  if (typeof v !== "string") return JSON.stringify(v);
  try {
    if (typeof JSON.parse(v) !== "string") return JSON.stringify(v);
  } catch {
    // not JSON — safe to show bare
  }
  return v;
}

function conditionToMongo(c: Condition): Record<string, unknown> {
  switch (c.op) {
    case "isTrue":
      return { [c.field]: { $eq: true } };
    case "isFalse":
      return { [c.field]: { $eq: false } };
    case "isNull":
      return { [c.field]: { $exists: false } };
    case "isNotNull":
      return { [c.field]: { $exists: true } };
    default: {
      const rhs = c.rhsKind === "field" ? { $ref: c.rhs } : parseLiteral(c.rhs);
      return { [c.field]: { [MONGO_OP[c.op]]: rhs } };
    }
  }
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
    case "iff":
      // A ↔ B: both hold, or neither holds.
      return {
        $or: [
          { $and: [groupToMongo(a), groupToMongo(b)] },
          { $nor: [groupToMongo(a), groupToMongo(b)] },
        ],
      };
    case "exclusive":
      // Can't all be true: ¬(A ∧ B ∧ …)
      return { $not: groupToMongo(a) };
  }
}

// A single mongo field condition → Condition; null if not representable.
function parseCondition(node: unknown): Condition | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) return null;
  const field = keys[0];
  if (field.startsWith("$")) return null; // an operator, not a field
  const val = obj[field];
  // Shorthand: `{field: <primitive>}`.
  if (val === null) return { field, op: "isNull", rhsKind: "value", rhs: "" };
  if (typeof val !== "object" || Array.isArray(val)) {
    if (val === true) return { field, op: "isTrue", rhsKind: "value", rhs: "" };
    if (val === false)
      return { field, op: "isFalse", rhsKind: "value", rhs: "" };
    return { field, op: "==", rhsKind: "value", rhs: formatLiteral(val) };
  }
  const opObj = val as Record<string, unknown>;
  if (Object.keys(opObj).length !== 1) return null;
  const op = Object.keys(opObj)[0];
  const arg = opObj[op];
  if (op === "$exists") {
    return {
      field,
      op: arg ? "isNotNull" : "isNull",
      rhsKind: "value",
      rhs: "",
    };
  }
  const cmp = MONGO_OP_INV[op];
  if (!cmp) return null;
  if (cmp === "==" && arg === true)
    return { field, op: "isTrue", rhsKind: "value", rhs: "" };
  if (cmp === "==" && arg === false)
    return { field, op: "isFalse", rhsKind: "value", rhs: "" };
  if (cmp === "==" && arg === null)
    return { field, op: "isNull", rhsKind: "value", rhs: "" };
  if (cmp === "!=" && arg === null)
    return { field, op: "isNotNull", rhsKind: "value", rhs: "" };
  if (isRef(arg)) return { field, op: cmp, rhsKind: "field", rhs: arg.$ref };
  return { field, op: cmp, rhsKind: "value", rhs: formatLiteral(arg) };
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

  // Can't all be true: {$not: <group>}
  if (op === "$not") {
    const g = parseGroup(arg);
    if (g) return { kind: "exclusive", groupA: g };
    return null;
  }

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
    // Both or neither: {$or: [{$and:[A,B]}, {$nor:[A,B]}]}. The $nor arm must
    // mirror the $and arm, or it isn't an iff — fall through to Advanced rather
    // than mislabel it and silently rewrite on save.
    const first = arg[0] as Record<string, unknown> | undefined;
    const second = arg[1] as Record<string, unknown> | undefined;
    if (
      first &&
      Array.isArray(first.$and) &&
      first.$and.length === 2 &&
      second &&
      Array.isArray(second.$nor) &&
      JSON.stringify(first.$and) === JSON.stringify(second.$nor)
    ) {
      const gA = parseGroup(first.$and[0]);
      const gB = parseGroup(first.$and[1]);
      if (gA && gB) return { kind: "iff", groupA: gA, groupB: gB };
    }
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
  resolvedValue,
  canEdit,
  onChange,
}: Props) {
  // null = closed, -1 = adding, >=0 = editing that row.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [ruleText, setRuleText] = useState("{}");
  const [kind, setKind] = useState<RuleKind>("single");
  const [groupA, setGroupA] = useState<Group>([
    newCondition(fieldKeys[0] ?? ""),
  ]);
  const [groupB, setGroupB] = useState<Group>([
    newCondition(fieldKeys[0] ?? ""),
  ]);

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
    // "Can't all be true" needs at least two conditions to be meaningful.
    if (k === "exclusive" && groupA.length < 2) {
      setGroupA([...groupA, newCondition(fieldKeys[0] ?? "")]);
    }
    setKind(k);
  };

  const toggleAdvanced = (checked: boolean) => {
    if (checked) {
      setRuleText(JSON.stringify(buildRule(kind, groupA, groupB), null, 2));
      setAdvanced(true);
    } else {
      const b = parseRule(safeParse(ruleText) ?? {});
      if (b) applyParsed(b);
      setAdvanced(false);
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
    if (kind === "exclusive" && groupA.length < 2) {
      return "Add at least two conditions.";
    }
    const twoSided = kind === "implication" || kind === "iff";
    const a = validateGroup(groupA, twoSided ? "the first group" : "the rule");
    if (a) return a;
    if (twoSided) return validateGroup(groupB, "the second group");
    return null;
  };

  const save = async () => {
    if (!name.trim()) throw new Error("Name is required.");
    if (!message.trim()) throw new Error("Message is required.");
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
      message: message.trim(),
    };
    const list =
      editingIndex !== null && editingIndex >= 0
        ? invariants.map((iv, i) => (i === editingIndex ? next : iv))
        : [...invariants, next];
    await onChange(list);
  };

  const remove = async (index: number) => {
    await onChange(invariants.filter((_, i) => i !== index));
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
                          placeholder={`4k, 5, true, {"a":1}`}
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
                ) : null
              }
            />
          </Box>
        ))}
        <Box mt="2">
          <AddConditionButton
            onClick={() => setG([...g, newCondition(fieldKeys[0] ?? "")])}
          />
        </Box>
      </Box>
    );
  };

  const divider = (label: string) => (
    <Flex align="center" gap="3" my="3">
      <Separator style={{ flexGrow: 1 }} />
      <Text size="small" weight="medium" color="text-low">
        {label}
      </Text>
      <Separator style={{ flexGrow: 1 }} />
    </Flex>
  );

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
        {kind === "iff" && (
          <>
            {groupBlock(groupA, setGroupA, null)}
            {divider("if and only if")}
            {groupBlock(groupB, setGroupB, null)}
          </>
        )}
        {kind === "exclusive" && groupBlock(groupA, setGroupA, null)}
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

      <Flex justify="between" align="center" mt="3" mb="2">
        <Text size="small" weight="medium">
          Rule
        </Text>
        <Switch
          value={advanced}
          onChange={toggleAdvanced}
          label="Advanced (raw rule)"
          size="1"
        />
      </Flex>

      {advanced ? (
        <CodeTextArea
          language="json"
          value={ruleText}
          setValue={setRuleText}
          minLines={4}
          maxLines={16}
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
          label="Error message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Shown to editors when the rule is violated"
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
        <em className="text-muted">
          Relational checks JSON Schema can&apos;t express — evaluated against
          the resolved value at publish.
        </em>
      </Box>

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

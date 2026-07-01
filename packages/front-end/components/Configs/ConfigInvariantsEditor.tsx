import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { evaluateInvariants, describeInvariantRule } from "shared/util";
import type { ConfigInvariant } from "shared/util";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Switch from "@/ui/Switch";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import Callout from "@/ui/Callout";
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
  saving?: boolean;
  onChange: (next: ConfigInvariant[]) => Promise<void>;
};

// ---- Condition model -------------------------------------------------------
// A condition is a single predicate over one field. Comparison ops take a
// right-hand side (a literal or another field); the unary ops don't. Rule kinds
// compose one or two conditions into the JSONLogic the evaluator runs.

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

const OP_NEGATION: Record<CondOp, CondOp> = {
  "==": "!=",
  "!=": "==",
  "<": ">=",
  "<=": ">",
  ">": "<=",
  ">=": "<",
  isTrue: "isFalse",
  isFalse: "isTrue",
  isNull: "isNotNull",
  isNotNull: "isNull",
};

type Condition = {
  field: string;
  op: CondOp;
  rhsKind: "value" | "field";
  rhs: string;
};

type RuleKind = "single" | "implication" | "iff" | "exclusive";

const RULE_KIND_OPTIONS: { label: string; value: RuleKind }[] = [
  { label: "Field condition", value: "single" },
  { label: "Implication (if … then)", value: "implication" },
  { label: "Both or neither", value: "iff" },
  { label: "Can't both be true", value: "exclusive" },
];

const RULE_KIND_HINTS: Record<RuleKind, string> = {
  single: "A single field must satisfy a condition.",
  implication: "When the first condition holds, the second must too.",
  iff: "Both conditions must be true together, or both false together.",
  exclusive: "At most one of the two boolean fields may be true.",
};

function isComp(op: CondOp): op is CompOp {
  return (COMPARISON_OPS as readonly string[]).includes(op);
}

function newCondition(field: string): Condition {
  return { field, op: "==", rhsKind: "value", rhs: "" };
}

function isVar(x: unknown): x is { var: string } {
  return (
    !!x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Object.keys(x as object).length === 1 &&
    typeof (x as { var?: unknown }).var === "string"
  );
}

function parseLiteral(s: string): unknown {
  const t = s.trim();
  if (t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  return t.replace(/^["']|["']$/g, "");
}

function formatLiteral(v: unknown): string {
  return v === null ? "null" : String(v);
}

// Condition → JSONLogic. `isTrue` is the bare `{var}` (truthy) so both-or-neither
// reads as `field == (other != null)`; the rest map to their operator form.
function conditionToLogic(c: Condition): unknown {
  switch (c.op) {
    case "isTrue":
      return { var: c.field };
    case "isFalse":
      return { "!": { var: c.field } };
    case "isNull":
      return { "==": [{ var: c.field }, null] };
    case "isNotNull":
      return { "!=": [{ var: c.field }, null] };
    default: {
      const rhs = c.rhsKind === "field" ? { var: c.rhs } : parseLiteral(c.rhs);
      return { [c.op]: [{ var: c.field }, rhs] };
    }
  }
}

function negatedLogic(c: Condition): unknown {
  return conditionToLogic({ ...c, op: OP_NEGATION[c.op] });
}

function buildRule(
  kind: RuleKind,
  condA: Condition,
  condB: Condition,
  exclA: string,
  exclB: string,
): Record<string, unknown> {
  switch (kind) {
    case "single":
      return conditionToLogic(condA) as Record<string, unknown>;
    case "implication":
      // A → B  ≡  ¬A ∨ B
      return { or: [negatedLogic(condA), conditionToLogic(condB)] };
    case "iff":
      // A ↔ B  ≡  A == B
      return { "==": [conditionToLogic(condA), conditionToLogic(condB)] };
    case "exclusive":
      return { "!": { and: [{ var: exclA }, { var: exclB }] } };
  }
}

// JSONLogic → Condition (inverse of conditionToLogic); null if not representable.
function parseCondition(node: unknown): Condition | null {
  if (isVar(node)) {
    return { field: node.var, op: "isTrue", rhsKind: "value", rhs: "" };
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) return null;
  const op = keys[0];
  const arg = obj[op];
  if (op === "!" && isVar(arg)) {
    return { field: arg.var, op: "isFalse", rhsKind: "value", rhs: "" };
  }
  if (isComp(op as CondOp) && Array.isArray(arg) && arg.length === 2) {
    const [lhs, rhs] = arg;
    if (!isVar(lhs)) return null;
    if (rhs === null) {
      if (op === "==")
        return { field: lhs.var, op: "isNull", rhsKind: "value", rhs: "" };
      if (op === "!=")
        return { field: lhs.var, op: "isNotNull", rhsKind: "value", rhs: "" };
      return null;
    }
    if (isVar(rhs)) {
      return {
        field: lhs.var,
        op: op as CondOp,
        rhsKind: "field",
        rhs: rhs.var,
      };
    }
    if (["string", "number", "boolean"].includes(typeof rhs)) {
      return {
        field: lhs.var,
        op: op as CondOp,
        rhsKind: "value",
        rhs: formatLiteral(rhs),
      };
    }
  }
  return null;
}

type ParsedRule = {
  kind: RuleKind;
  condA?: Condition;
  condB?: Condition;
  exclA?: string;
  exclB?: string;
};

// Best-effort: recognize a stored rule as one of the builder kinds so it can be
// edited in the simple view. Anything else returns null → the Advanced editor.
function parseRule(obj: Record<string, unknown>): ParsedRule | null {
  const keys = Object.keys(obj);
  if (keys.length !== 1) return null;
  const op = keys[0];
  const arg = obj[op];

  // Can't both be true: {"!": {and: [{var}, {var}]}}
  if (op === "!" && arg && typeof arg === "object" && !Array.isArray(arg)) {
    const inner = arg as Record<string, unknown>;
    if (
      Object.keys(inner).length === 1 &&
      Array.isArray(inner.and) &&
      inner.and.length === 2 &&
      isVar(inner.and[0]) &&
      isVar(inner.and[1])
    ) {
      return {
        kind: "exclusive",
        exclA: (inner.and[0] as { var: string }).var,
        exclB: (inner.and[1] as { var: string }).var,
      };
    }
  }

  // Implication: {or: [¬A, B]}
  if (op === "or" && Array.isArray(arg) && arg.length === 2) {
    const negA = parseCondition(arg[0]);
    const condB = parseCondition(arg[1]);
    if (negA && condB) {
      return {
        kind: "implication",
        condA: { ...negA, op: OP_NEGATION[negA.op] },
        condB,
      };
    }
    return null;
  }

  // Single field condition (a comparison or unary predicate).
  const single = parseCondition(obj);
  if (single) return { kind: "single", condA: single };

  // Both or neither: {"==": [A, B]} where the operands are themselves conditions
  // (a plain `field == value` is caught as `single` above).
  if (op === "==" && Array.isArray(arg) && arg.length === 2) {
    const condA = parseCondition(arg[0]);
    const condB = parseCondition(arg[1]);
    if (condA && condB) return { kind: "iff", condA, condB };
  }

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

// Named cross-field rules on a config schema. A template-driven builder (single
// condition, implication, both-or-neither, mutual-exclusion) covers the common
// relational patterns; an "Advanced" toggle swaps in a raw JSONLogic editor for
// anything the builder can't represent — never both at once.
export default function ConfigInvariantsEditor({
  invariants,
  fieldKeys,
  resolvedValue,
  canEdit,
  saving,
  onChange,
}: Props) {
  // null = closed, -1 = adding, >=0 = editing that row.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [ruleText, setRuleText] = useState("{}");
  const [kind, setKind] = useState<RuleKind>("single");
  const [condA, setCondA] = useState<Condition>(
    newCondition(fieldKeys[0] ?? ""),
  );
  const [condB, setCondB] = useState<Condition>(
    newCondition(fieldKeys[0] ?? ""),
  );
  const [exclA, setExclA] = useState(fieldKeys[0] ?? "");
  const [exclB, setExclB] = useState(fieldKeys[1] ?? fieldKeys[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  const currentRule = advanced
    ? safeParse(ruleText)
    : buildRule(kind, condA, condB, exclA, exclB);

  const applyParsed = (b: ParsedRule) => {
    setKind(b.kind);
    if (b.condA) setCondA(b.condA);
    if (b.condB) setCondB(b.condB);
    if (b.exclA) setExclA(b.exclA);
    if (b.exclB) setExclB(b.exclB);
  };

  const open = (index: number) => {
    setError(null);
    setEditingIndex(index);
    const inv = index >= 0 ? invariants[index] : undefined;
    setName(inv?.name ?? "");
    setMessage(inv?.message ?? "");
    const parsed = inv ? safeParse(inv.rule) : null;
    const b = parsed ? parseRule(parsed) : null;
    if (b) {
      // Reset unused slots to sensible defaults so a prior edit doesn't leak in.
      setKind(b.kind);
      setCondA(b.condA ?? newCondition(fieldKeys[0] ?? ""));
      setCondB(b.condB ?? newCondition(fieldKeys[0] ?? ""));
      setExclA(b.exclA ?? fieldKeys[0] ?? "");
      setExclB(b.exclB ?? fieldKeys[1] ?? fieldKeys[0] ?? "");
      setAdvanced(false);
      setRuleText(parsed ? JSON.stringify(parsed, null, 2) : "{}");
    } else {
      setAdvanced(true);
      setRuleText(
        parsed ? JSON.stringify(parsed, null, 2) : (inv?.rule ?? "{}"),
      );
    }
  };
  const close = () => {
    setEditingIndex(null);
    setError(null);
  };

  const toggleAdvanced = (checked: boolean) => {
    if (checked) {
      setRuleText(
        JSON.stringify(buildRule(kind, condA, condB, exclA, exclB), null, 2),
      );
      setAdvanced(true);
    } else {
      // Load the JSON back into the builder when it maps to a known kind;
      // otherwise keep the builder's current values.
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

  const validateBuilder = (): string | null => {
    if (kind === "exclusive") {
      if (!exclA || !exclB) return "Choose both fields.";
      if (exclA === exclB) return "Choose two different fields.";
      return null;
    }
    const a = validateCondition(
      condA,
      kind === "single" ? "the rule" : "the first condition",
    );
    if (a) return a;
    if (kind === "implication" || kind === "iff") {
      return validateCondition(condB, "the second condition");
    }
    return null;
  };

  const save = async () => {
    if (!name.trim()) return setError("Name is required.");
    if (!message.trim()) return setError("Message is required.");
    if (!advanced) {
      const err = validateBuilder();
      if (err) return setError(err);
    }
    const rule = advanced
      ? safeParse(ruleText)
      : buildRule(kind, condA, condB, exclA, exclB);
    if (!rule) return setError("Rule must be a JSONLogic object.");
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
    close();
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

  const conditionRow = (c: Condition, set: (c: Condition) => void) => (
    <Flex gap="2" align="end" wrap="wrap">
      <SelectField
        label="Field"
        value={c.field}
        onChange={(v) => set({ ...c, field: v })}
        options={fieldOptions}
        placeholder="field"
      />
      <SelectField
        label="Condition"
        value={c.op}
        onChange={(v) => set({ ...c, op: v as CondOp })}
        options={ALL_OPS.map((o) => ({ label: OP_LABELS[o], value: o }))}
        sort={false}
      />
      {isComp(c.op) && (
        <>
          <SelectField
            label="Compare to"
            value={c.rhsKind}
            onChange={(v) => set({ ...c, rhsKind: v as "value" | "field" })}
            options={[
              { label: "a value", value: "value" },
              { label: "another field", value: "field" },
            ]}
            sort={false}
          />
          {c.rhsKind === "field" ? (
            <SelectField
              label="Field"
              value={c.rhs}
              onChange={(v) => set({ ...c, rhs: v })}
              options={fieldOptions}
              placeholder="field"
            />
          ) : (
            <Field
              label="Value"
              value={c.rhs}
              onChange={(e) => set({ ...c, rhs: e.target.value })}
              placeholder="'4k', 5, true, null"
            />
          )}
        </>
      )}
    </Flex>
  );

  const editor = (
    <Frame mb="3">
      <Field
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. streams_lte_devices"
      />

      <Flex justify="between" align="center" mt="3" mb="1">
        <Text size="small" weight="medium">
          Rule
        </Text>
        <Switch
          value={advanced}
          onChange={toggleAdvanced}
          label="Advanced (JSONLogic)"
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
              <span>JSONLogic — a boolean expression over the fields.</span>
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
        <Box>
          <SelectField
            label="Rule type"
            value={kind}
            onChange={(v) => setKind(v as RuleKind)}
            options={RULE_KIND_OPTIONS}
            sort={false}
            helpText={RULE_KIND_HINTS[kind]}
          />

          {kind === "single" && (
            <Box mt="2">{conditionRow(condA, setCondA)}</Box>
          )}

          {kind === "implication" && (
            <Box mt="2">
              <Text size="small" color="text-low" as="div" mb="1">
                If
              </Text>
              {conditionRow(condA, setCondA)}
              <Text size="small" color="text-low" as="div" mt="2" mb="1">
                then
              </Text>
              {conditionRow(condB, setCondB)}
            </Box>
          )}

          {kind === "iff" && (
            <Box mt="2">
              {conditionRow(condA, setCondA)}
              <Text size="small" color="text-low" as="div" mt="2" mb="1">
                if and only if
              </Text>
              {conditionRow(condB, setCondB)}
            </Box>
          )}

          {kind === "exclusive" && (
            <Flex gap="2" align="end" wrap="wrap" mt="2">
              <SelectField
                label="Field"
                value={exclA}
                onChange={setExclA}
                options={fieldOptions}
                placeholder="field"
              />
              <SelectField
                label="Field"
                value={exclB}
                onChange={setExclB}
                options={fieldOptions}
                placeholder="field"
              />
            </Flex>
          )}
        </Box>
      )}

      {currentRule && (
        <Box
          mt="2"
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
      {error && (
        <Callout status="error" mt="2">
          {error}
        </Callout>
      )}

      <Flex gap="2" mt="3">
        <Button onClick={save} loading={saving}>
          {editingIndex !== null && editingIndex >= 0
            ? "Save rule"
            : "Add rule"}
        </Button>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
      </Flex>
    </Frame>
  );

  return (
    <Box>
      <Flex align="center" justify="between" mb="2">
        <Text weight="medium">Validation rules</Text>
        {canEdit && editingIndex === null && (
          <Button variant="ghost" onClick={() => open(-1)}>
            + Add rule
          </Button>
        )}
      </Flex>

      {invariants.length === 0 && editingIndex === null && (
        <Text as="div" size="small" color="text-low">
          No cross-field rules yet — add relational checks JSON Schema
          can&apos;t express (implications, both-or-neither, or comparing two
          fields).
        </Text>
      )}

      {invariants.map((iv, i) => (
        <Box key={i}>
          {editingIndex === i ? (
            editor
          ) : (
            <Frame mb="2">
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
          )}
        </Box>
      ))}

      {editingIndex === -1 && editor}
    </Box>
  );
}

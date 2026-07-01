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
// A condition is one predicate over a single field. Conditions are combined into
// AND/OR groups; rule kinds compose one or two groups into JSONLogic. All
// operators emitted here (var, ==, !=, <, <=, >, >=, !, and, or) are standard
// json-logic-js operators — see the evaluator in shared/util/config-schema.

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

type Connector = "and" | "or";
type ConditionGroup = { connector: Connector; conditions: Condition[] };

type RuleKind = "single" | "implication" | "iff" | "exclusive";

const RULE_KIND_OPTIONS: { label: string; value: RuleKind }[] = [
  { label: "Field condition", value: "single" },
  { label: "Implication (if … then)", value: "implication" },
  { label: "Both or neither", value: "iff" },
  { label: "Can't all be true", value: "exclusive" },
];

const RULE_KIND_HINTS: Record<RuleKind, string> = {
  single: "The condition(s) must hold.",
  implication: "When the first group holds, the second must too.",
  iff: "Both groups must be true together, or both false together.",
  exclusive: "The conditions can't all be true at the same time.",
};

function isComp(op: CondOp): op is CompOp {
  return (COMPARISON_OPS as readonly string[]).includes(op);
}

function newCondition(field: string): Condition {
  return { field, op: "==", rhsKind: "value", rhs: "" };
}

function newGroup(field: string): ConditionGroup {
  return { connector: "and", conditions: [newCondition(field)] };
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

// Parse a typed right-hand-side value. JSON first (so 5, true, null, "quoted",
// {objects} and [arrays] keep their type), then a bare word falls back to a
// string (so `4k` needn't be quoted).
function parseLiteral(s: string): unknown {
  const t = s.trim();
  try {
    return JSON.parse(t);
  } catch {
    return t.replace(/^['"]|['"]$/g, "");
  }
}

// Inverse of parseLiteral for the text input: show a string bare unless it would
// re-parse as a non-string (then quote it); everything else as JSON.
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

function groupToLogic(g: ConditionGroup): Record<string, unknown> {
  const parts = g.conditions.map(conditionToLogic);
  if (parts.length === 1) return parts[0] as Record<string, unknown>;
  return { [g.connector]: parts };
}

function buildRule(
  kind: RuleKind,
  groupA: ConditionGroup,
  groupB: ConditionGroup,
): Record<string, unknown> {
  switch (kind) {
    case "single":
      return groupToLogic(groupA);
    case "implication":
      // A → B  ≡  ¬A ∨ B
      return { or: [{ "!": groupToLogic(groupA) }, groupToLogic(groupB)] };
    case "iff":
      // A ↔ B  ≡  A == B
      return { "==": [groupToLogic(groupA), groupToLogic(groupB)] };
    case "exclusive":
      // Can't all be true: ¬(A ∧ B ∧ …). Always AND, regardless of group toggle.
      return {
        "!": groupToLogic({ connector: "and", conditions: groupA.conditions }),
      };
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
    return {
      field: lhs.var,
      op: op as CondOp,
      rhsKind: "value",
      rhs: formatLiteral(rhs),
    };
  }
  return null;
}

function parseGroup(node: unknown): ConditionGroup | null {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (
      keys.length === 1 &&
      (keys[0] === "and" || keys[0] === "or") &&
      Array.isArray(obj[keys[0]])
    ) {
      const arr = obj[keys[0]] as unknown[];
      const conds = arr.map(parseCondition);
      if (conds.length > 0 && conds.every((c): c is Condition => c !== null)) {
        return { connector: keys[0] as Connector, conditions: conds };
      }
      return null;
    }
  }
  const single = parseCondition(node);
  return single ? { connector: "and", conditions: [single] } : null;
}

type ParsedRule = {
  kind: RuleKind;
  groupA?: ConditionGroup;
  groupB?: ConditionGroup;
};

// Best-effort: recognize a stored rule as one of the builder kinds so it can be
// edited in the simple view. Anything else returns null → the Advanced editor.
// Ambiguous shapes (e.g. an OR group vs an implication) are logically equivalent,
// so the chosen interpretation is always correct even if not what was picked.
function parseRule(obj: Record<string, unknown>): ParsedRule | null {
  const keys = Object.keys(obj);
  if (keys.length !== 1) return null;
  const op = keys[0];
  const arg = obj[op];

  // Can't all be true: {"!": <and/or group>}
  if (op === "!" && arg && typeof arg === "object" && !Array.isArray(arg)) {
    const innerKeys = Object.keys(arg as object);
    if (
      innerKeys.length === 1 &&
      (innerKeys[0] === "and" || innerKeys[0] === "or")
    ) {
      const g = parseGroup(arg);
      if (g) return { kind: "exclusive", groupA: g };
    }
  }

  // Implication: {or: [{"!": A}, B]}
  if (op === "or" && Array.isArray(arg) && arg.length === 2) {
    const x = arg[0];
    if (
      x &&
      typeof x === "object" &&
      !Array.isArray(x) &&
      Object.keys(x).length === 1 &&
      "!" in (x as object)
    ) {
      const gA = parseGroup((x as Record<string, unknown>)["!"]);
      const gB = parseGroup(arg[1]);
      if (gA && gB) return { kind: "implication", groupA: gA, groupB: gB };
    }
    const g = parseGroup(obj);
    if (g) return { kind: "single", groupA: g };
    return null;
  }

  // Single simple condition (comparison / unary).
  const c = parseCondition(obj);
  if (c) {
    return { kind: "single", groupA: { connector: "and", conditions: [c] } };
  }

  // Single AND-group.
  if (op === "and" && Array.isArray(arg)) {
    const g = parseGroup(obj);
    if (g) return { kind: "single", groupA: g };
  }

  // Both or neither: {"==": [A, B]} with condition-group operands.
  if (op === "==" && Array.isArray(arg) && arg.length === 2) {
    const gA = parseGroup(arg[0]);
    const gB = parseGroup(arg[1]);
    if (gA && gB) return { kind: "iff", groupA: gA, groupB: gB };
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

// Named cross-field rules on a config schema. A template-driven builder (field
// conditions grouped with AND/OR, implication, both-or-neither, mutual-exclusion)
// covers the relational patterns; an "Advanced" toggle swaps in a raw JSONLogic
// editor for anything the builder can't represent — never both at once.
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
  const [groupA, setGroupA] = useState<ConditionGroup>(
    newGroup(fieldKeys[0] ?? ""),
  );
  const [groupB, setGroupB] = useState<ConditionGroup>(
    newGroup(fieldKeys[0] ?? ""),
  );
  const [error, setError] = useState<string | null>(null);

  const currentRule = advanced
    ? safeParse(ruleText)
    : buildRule(kind, groupA, groupB);

  const applyParsed = (b: ParsedRule) => {
    setKind(b.kind);
    setGroupA(b.groupA ?? newGroup(fieldKeys[0] ?? ""));
    setGroupB(b.groupB ?? newGroup(fieldKeys[0] ?? ""));
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
      applyParsed(b);
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

  const onKindChange = (k: RuleKind) => {
    // "Can't all be true" needs at least two conditions to be meaningful.
    if (k === "exclusive" && groupA.conditions.length < 2) {
      setGroupA({
        ...groupA,
        conditions: [...groupA.conditions, newCondition(fieldKeys[0] ?? "")],
      });
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

  const validateGroup = (g: ConditionGroup, label: string): string | null => {
    for (let i = 0; i < g.conditions.length; i++) {
      const lbl =
        g.conditions.length > 1 ? `${label} condition ${i + 1}` : label;
      const e = validateCondition(g.conditions[i], lbl);
      if (e) return e;
    }
    return null;
  };

  const validateBuilder = (): string | null => {
    if (kind === "exclusive" && groupA.conditions.length < 2) {
      return "Add at least two conditions.";
    }
    const a = validateGroup(
      groupA,
      kind === "implication" || kind === "iff" ? "the first group" : "the rule",
    );
    if (a) return a;
    if (kind === "implication" || kind === "iff") {
      return validateGroup(groupB, "the second group");
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
      : buildRule(kind, groupA, groupB);
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
              placeholder={`4k, 5, true, null, {"a":1}`}
            />
          )}
        </>
      )}
    </Flex>
  );

  const groupEditor = (
    g: ConditionGroup,
    set: (g: ConditionGroup) => void,
    showConnector = true,
  ) => (
    <Box>
      {showConnector && g.conditions.length > 1 && (
        <Box mb="2">
          <SelectField
            label="Match"
            value={g.connector}
            onChange={(v) => set({ ...g, connector: v as Connector })}
            options={[
              { label: "all conditions (AND)", value: "and" },
              { label: "any condition (OR)", value: "or" },
            ]}
            sort={false}
          />
        </Box>
      )}
      {g.conditions.map((c, i) => (
        <Box key={i} mt={i > 0 ? "2" : "0"}>
          {i > 0 && (
            <Text size="small" color="text-low" as="div" mb="1">
              {showConnector && g.connector === "or" ? "or" : "and"}
            </Text>
          )}
          <Flex gap="2" align="end" wrap="wrap">
            {conditionRow(c, (nc) =>
              set({
                ...g,
                conditions: g.conditions.map((x, j) => (j === i ? nc : x)),
              }),
            )}
            {g.conditions.length > 1 && (
              <Button
                variant="ghost"
                size="xs"
                color="red"
                onClick={() =>
                  set({
                    ...g,
                    conditions: g.conditions.filter((_, j) => j !== i),
                  })
                }
              >
                Remove
              </Button>
            )}
          </Flex>
        </Box>
      ))}
      <Box mt="2">
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            set({
              ...g,
              conditions: [...g.conditions, newCondition(fieldKeys[0] ?? "")],
            })
          }
        >
          + Add condition
        </Button>
      </Box>
    </Box>
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
            onChange={(v) => onKindChange(v as RuleKind)}
            options={RULE_KIND_OPTIONS}
            sort={false}
            helpText={RULE_KIND_HINTS[kind]}
          />

          {kind === "single" && (
            <Box mt="2">{groupEditor(groupA, setGroupA)}</Box>
          )}

          {kind === "implication" && (
            <Box mt="2">
              <Text size="small" color="text-low" as="div" mb="1">
                If
              </Text>
              {groupEditor(groupA, setGroupA)}
              <Text size="small" color="text-low" as="div" mt="3" mb="1">
                then
              </Text>
              {groupEditor(groupB, setGroupB)}
            </Box>
          )}

          {kind === "iff" && (
            <Box mt="2">
              {groupEditor(groupA, setGroupA)}
              <Text size="small" color="text-low" as="div" mt="3" mb="1">
                if and only if
              </Text>
              {groupEditor(groupB, setGroupB)}
            </Box>
          )}

          {kind === "exclusive" && (
            <Box mt="2">{groupEditor(groupA, setGroupA, false)}</Box>
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

import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { evaluateInvariants } from "shared/util";
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

const COMPARISON_OPS = ["==", "!=", "<=", "<", ">=", ">"];

type SimpleRule = {
  field: string;
  op: string;
  rhsKind: "value" | "field";
  rhs: string;
};

function isVar(x: unknown): x is { var: string } {
  return (
    !!x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Object.keys(x as object).length === 1 &&
    typeof (x as { var?: unknown }).var === "string"
  );
}

// A rule the simple builder can represent: a single binary comparison of a field
// against a literal or another field. Anything compound (or/and/!, nesting) is
// advanced-only.
function toSimpleRule(rule: Record<string, unknown> | null): SimpleRule | null {
  if (!rule) return null;
  const keys = Object.keys(rule);
  if (keys.length !== 1) return null;
  const op = keys[0];
  if (!COMPARISON_OPS.includes(op)) return null;
  const args = rule[op];
  if (!Array.isArray(args) || args.length !== 2) return null;
  const [lhs, rhs] = args;
  if (!isVar(lhs)) return null;
  if (isVar(rhs)) return { field: lhs.var, op, rhsKind: "field", rhs: rhs.var };
  if (rhs === null)
    return { field: lhs.var, op, rhsKind: "value", rhs: "null" };
  if (["string", "number", "boolean"].includes(typeof rhs)) {
    return { field: lhs.var, op, rhsKind: "value", rhs: String(rhs) };
  }
  return null;
}

function parseLiteral(s: string): unknown {
  const t = s.trim();
  if (t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  return t.replace(/^["']|["']$/g, "");
}

function buildComparison(r: SimpleRule): Record<string, unknown> {
  const rhs = r.rhsKind === "field" ? { var: r.rhs } : parseLiteral(r.rhs);
  return { [r.op]: [{ var: r.field }, rhs] };
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(text);
    return p && typeof p === "object" && !Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

// Named cross-field rules on a config schema. Mirrors the feature condition
// editor: a simple field·op·value/field builder, with an "Advanced" toggle that
// swaps in a raw JSONLogic editor for compound rules — never both at once.
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
  const [simple, setSimple] = useState<SimpleRule>({
    field: fieldKeys[0] ?? "",
    op: "==",
    rhsKind: "value",
    rhs: "",
  });
  const [error, setError] = useState<string | null>(null);

  const currentRule = advanced ? safeParse(ruleText) : buildComparison(simple);

  const open = (index: number) => {
    setError(null);
    setEditingIndex(index);
    const inv = index >= 0 ? invariants[index] : undefined;
    setName(inv?.name ?? "");
    setMessage(inv?.message ?? "");
    const parsed = inv ? safeParse(inv.rule) : null;
    const s = toSimpleRule(parsed);
    if (s) {
      setSimple(s);
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
      setRuleText(JSON.stringify(buildComparison(simple), null, 2));
      setAdvanced(true);
    } else {
      // Load the JSON into the builder when it's a single comparison; otherwise
      // keep the builder's current values so you can still author a simple rule.
      const s = toSimpleRule(safeParse(ruleText));
      if (s) setSimple(s);
      setAdvanced(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return setError("Name is required.");
    if (!message.trim()) return setError("Message is required.");
    if (!advanced) {
      if (!simple.field) return setError("Choose a field for the rule.");
      if (simple.rhsKind === "field" && !simple.rhs) {
        return setError("Choose a field to compare to.");
      }
    }
    const rule = advanced ? safeParse(ruleText) : buildComparison(simple);
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
        <Flex gap="2" align="end" wrap="wrap">
          <SelectField
            label="Field"
            value={simple.field}
            onChange={(v) => setSimple({ ...simple, field: v })}
            options={fieldOptions}
          />
          <SelectField
            label="Operator"
            value={simple.op}
            onChange={(v) => setSimple({ ...simple, op: v })}
            options={COMPARISON_OPS.map((o) => ({ label: o, value: o }))}
            sort={false}
          />
          <SelectField
            label="Compare to"
            value={simple.rhsKind}
            onChange={(v) =>
              setSimple({ ...simple, rhsKind: v as "value" | "field" })
            }
            options={[
              { label: "a value", value: "value" },
              { label: "another field", value: "field" },
            ]}
            sort={false}
          />
          {simple.rhsKind === "field" ? (
            <SelectField
              label="Field"
              value={simple.rhs}
              onChange={(v) => setSimple({ ...simple, rhs: v })}
              options={fieldOptions}
            />
          ) : (
            <Field
              label="Value"
              value={simple.rhs}
              onChange={(e) => setSimple({ ...simple, rhs: e.target.value })}
              placeholder="'4k', 5, true, null"
            />
          )}
        </Flex>
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
                {iv.rule}
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

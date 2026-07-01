import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { evaluateInvariants } from "shared/util";
import type { ConfigInvariant } from "shared/util";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

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

const OPS = ["==", "!=", "<=", "<", ">=", ">"];

function parseLiteral(s: string): unknown {
  const t = s.trim();
  if (t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  return t.replace(/^["']|["']$/g, "");
}

// Named cross-field rules on a config schema. Rules are JSONLogic; a small
// builder generates the common field·op·(value|field) comparison, and the raw
// JSONLogic stays editable for compound rules (implications, both-or-neither…).
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
  const [ruleText, setRuleText] = useState("{}");
  const [bField, setBField] = useState(fieldKeys[0] ?? "");
  const [bOp, setBOp] = useState("==");
  const [bRhsKind, setBRhsKind] = useState("value");
  const [bRhsValue, setBRhsValue] = useState("");
  const [bRhsField, setBRhsField] = useState(
    fieldKeys[1] ?? fieldKeys[0] ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const open = (index: number) => {
    setError(null);
    setEditingIndex(index);
    const inv = index >= 0 ? invariants[index] : undefined;
    setName(inv?.name ?? "");
    setMessage(inv?.message ?? "");
    if (inv) {
      try {
        setRuleText(JSON.stringify(JSON.parse(inv.rule), null, 2));
      } catch {
        setRuleText(inv.rule);
      }
    } else {
      setRuleText("{}");
    }
  };
  const close = () => {
    setEditingIndex(null);
    setError(null);
  };

  const parsedRule = useMemo<Record<string, unknown> | null>(() => {
    try {
      const p = JSON.parse(ruleText);
      return p && typeof p === "object" && !Array.isArray(p) ? p : null;
    } catch {
      return null;
    }
  }, [ruleText]);

  const applyBuilder = () => {
    const rhs =
      bRhsKind === "field" ? { var: bRhsField } : parseLiteral(bRhsValue);
    setRuleText(JSON.stringify({ [bOp]: [{ var: bField }, rhs] }, null, 2));
  };

  const save = async () => {
    if (!name.trim()) return setError("Name is required.");
    if (!message.trim()) return setError("Message is required.");
    if (!parsedRule) return setError("Rule must be a JSONLogic object.");
    const next: ConfigInvariant = {
      name: name.trim(),
      rule: JSON.stringify(parsedRule),
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

  const fieldOptions = fieldKeys.map((k) => ({ label: k, value: k }));

  const hintFails = parsedRule
    ? evaluateInvariants(resolvedValue, [
        { name, rule: JSON.stringify(parsedRule), message },
      ]).length > 0
    : null;

  const editor = (
    <Box className="appbox" p="3" mb="2">
      <Field
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. streams_lte_devices"
      />
      <Flex align="end" gap="2" mt="2" wrap="wrap">
        <SelectField
          label="Field"
          value={bField}
          onChange={setBField}
          options={fieldOptions}
        />
        <SelectField
          label="Operator"
          value={bOp}
          onChange={setBOp}
          options={OPS.map((o) => ({ label: o, value: o }))}
          sort={false}
        />
        <SelectField
          label="Compare to"
          value={bRhsKind}
          onChange={setBRhsKind}
          options={[
            { label: "a value", value: "value" },
            { label: "another field", value: "field" },
          ]}
          sort={false}
        />
        {bRhsKind === "field" ? (
          <SelectField
            label="Field"
            value={bRhsField}
            onChange={setBRhsField}
            options={fieldOptions}
          />
        ) : (
          <Field
            label="Value"
            value={bRhsValue}
            onChange={(e) => setBRhsValue(e.target.value)}
            placeholder="'4k', 5, true, null"
          />
        )}
        <Button variant="soft" onClick={applyBuilder}>
          Build rule →
        </Button>
      </Flex>
      <Box mt="2">
        <Field
          label="Rule (JSONLogic)"
          textarea
          minRows={3}
          value={ruleText}
          onChange={(e) => setRuleText(e.target.value)}
        />
      </Box>
      <Field
        label="Error message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Shown to editors when the rule is violated"
      />
      {parsedRule && (
        <Box mt="1">
          <Badge
            color={hintFails ? "red" : "green"}
            variant="soft"
            label={
              hintFails
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
    </Box>
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
        <Text as="div" color="text-low" size="small">
          No cross-field rules yet. Add relational checks JSON Schema can&apos;t
          express — implications, both-or-neither, or comparing two fields.
        </Text>
      )}

      {invariants.map((iv, i) => (
        <Box key={i}>
          {editingIndex === i ? (
            editor
          ) : (
            <Box className="appbox" p="3" mb="2">
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
                }}
              >
                {iv.rule}
              </Box>
              <Text as="div" size="small" color="text-low" mt="1">
                {iv.message}
              </Text>
            </Box>
          )}
        </Box>
      ))}

      {editingIndex === -1 && editor}
    </Box>
  );
}

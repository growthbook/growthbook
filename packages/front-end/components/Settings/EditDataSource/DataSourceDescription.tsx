import { useState } from "react";
import { Flex, TextArea } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { GBEdit } from "@/components/Icons";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function DataSourceDescription({
  value,
  canEdit,
  save,
}: {
  value: string;
  canEdit: boolean;
  save: (description: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    setDraft(value);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await save(draft.trim());
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save description");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <Flex direction="column" gap="2" mt="2" width="100%">
        <TextArea
          autoFocus
          size="2"
          variant="surface"
          resize="vertical"
          rows={4}
          value={draft}
          placeholder="Add a description to keep your team informed about this Data Source."
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={saving}
          style={{ width: "100%", minHeight: "6.5rem" }}
        />
        {error ? <HelperText status="error">{error}</HelperText> : null}
        <Flex gap="2" justify="end">
          <Button
            variant="soft"
            color="gray"
            disabled={saving}
            onClick={cancel}
          >
            Cancel
          </Button>
          <Button loading={saving} onClick={submit}>
            Save
          </Button>
        </Flex>
      </Flex>
    );
  }

  if (!value) {
    if (!canEdit) return null;
    return (
      <Flex mt="2">
        <Link onClick={startEditing}>
          <Flex align="center" gap="1">
            <PiPlus />
            <Text weight="medium">Add description</Text>
          </Flex>
        </Link>
      </Flex>
    );
  }

  return (
    <Flex align="center" gap="2" mt="2">
      <Text color="text-mid" whiteSpace="pre-wrap">
        {value}
      </Text>
      {canEdit && (
        <Link onClick={startEditing} aria-label="Edit description">
          <GBEdit />
        </Link>
      )}
    </Flex>
  );
}

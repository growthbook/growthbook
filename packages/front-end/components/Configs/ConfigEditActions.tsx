import { Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import { TableRow, TableViewportCell } from "@/ui/Table";

// An open edit's Save and Discard, in a row right under it that spans the
// visible width, so they stay with the edit as the table scrolls.
export default function ConfigEditActions({
  colSpan,
  background,
  saving = false,
  saveBlockedReason = null,
  onSave,
  onCancel,
}: {
  colSpan: number;
  background?: string;
  saving?: boolean;
  // Why the edit can't be saved as it stands; disables Save.
  saveBlockedReason?: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <TableRow style={background ? { background } : undefined}>
      <TableViewportCell colSpan={colSpan}>
        <Flex align="center" justify="end" gap="3">
          <Button
            variant="ghost"
            color="gray"
            disabled={saving}
            onClick={onCancel}
          >
            Discard changes
          </Button>
          <Tooltip content={saveBlockedReason} enabled={!!saveBlockedReason}>
            <Button disabled={saving || !!saveBlockedReason} onClick={onSave}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </Tooltip>
        </Flex>
      </TableViewportCell>
    </TableRow>
  );
}

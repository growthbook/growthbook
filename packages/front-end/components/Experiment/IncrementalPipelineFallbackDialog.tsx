import { Flex } from "@radix-ui/themes";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Text from "@/ui/Text";

export default function IncrementalPipelineFallbackDialog({
  reason,
  onConfirm,
  onCancel,
}: {
  reason: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      title="Update without Incremental Pipeline mode"
      yesText="Update anyway"
      noText="Cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
      content={
        <Flex direction="column" gap="3">
          <div>
            This update will rescan all the experiment data, from start to
            today, which is potentially slower and more costly than an
            incremental update.
          </div>
          <div>
            <Text weight="semibold">
              Current reason preventing the use of Incremental Pipeline:
            </Text>
            <div>{reason}</div>
          </div>
        </Flex>
      }
    />
  );
}

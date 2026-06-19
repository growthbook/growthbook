import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

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
    <ModalStandard
      open={true}
      header="Update without Incremental Pipeline"
      subheader="This re-scans all experiment data from the start instead of only new data, so it may take longer and cost more."
      cta="Update anyway"
      trackingEventModalType="incremental-pipeline-fallback"
      submit={onConfirm}
      close={onCancel}
    >
      <Text size="medium" color="text-high" as="p">
        <Text size="medium" weight="semibold" color="text-high">
          Why incremental updates are unavailable:
        </Text>
        <br />
        {reason}
      </Text>
    </ModalStandard>
  );
}

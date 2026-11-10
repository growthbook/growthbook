import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export default function FullRefreshRequiredDialog({
  controller,
}: {
  controller: {
    open: boolean;
    reasons: string[];
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
  };
}) {
  if (!controller.open) return null;
  return (
    <ModalStandard
      open={true}
      header="Unable to incrementally update"
      subheader="A Full Refresh is required."
      cta="Run full refresh"
      trackingEventModalType="incremental-pipeline-full-refresh"
      submit={controller.onConfirm}
      close={controller.onCancel}
    >
      <Text size="md" color="text-high" as="p">
        A full refresh can take longer to update, as it rebuilds the incremental
        pipeline. It is needed because:
      </Text>
      <ul style={{ paddingLeft: "13px" }}>
        {controller.reasons.map((reason) => (
          <li key={reason}>
            <Text size="md" color="text-high">
              {reason}
            </Text>
          </li>
        ))}
      </ul>
    </ModalStandard>
  );
}

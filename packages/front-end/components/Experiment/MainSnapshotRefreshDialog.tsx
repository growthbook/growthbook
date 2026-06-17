import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { type SnapshotRefreshBlocker } from "@/hooks/useExperimentSnapshotUpdate";

export default function MainSnapshotRefreshDialog({
  requirement,
  onConfirm,
  onCancel,
}: {
  requirement: SnapshotRefreshBlocker;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const isFullRefresh = requirement.kind === "requires-full-refresh";
  return (
    <ModalStandard
      open={true}
      header="Update Overall Results first"
      subheader="Dimension Results are built from Overall Results"
      cta={isFullRefresh ? "Refresh Overall Results" : "Update Overall Results"}
      trackingEventModalType="incremental-pipeline-main-snapshot-refresh"
      submit={onConfirm}
      close={onCancel}
    >
      {isFullRefresh ? (
        <Text size="medium" color="text-high" as="p">
          Overall Results are out of date. Refresh them to apply your latest
          analysis settings, then reopen this breakdown.
        </Text>
      ) : (
        <Text size="medium" color="text-high" as="p">
          Update your Overall Results to ensure the latest configuration is
          applied to the Dimensions, not showing stale data.
        </Text>
      )}
    </ModalStandard>
  );
}

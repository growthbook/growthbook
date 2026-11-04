import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import type { SnapshotRefreshBlocker } from "@/hooks/useExperimentSnapshotUpdate";

const COPY_BY_KIND: Record<
  SnapshotRefreshBlocker["kind"],
  { header: string; cta: string; body: string }
> = {
  "requires-full-refresh": {
    header: "Overall Results require a Full Refresh",
    cta: "Run full refresh",
    body: "Settings have changed, so Overall Results must be rebuilt with a full refresh before this dimension breakdown can update. A full refresh can take longer to run. Confirming starts it, shows Overall Results while it runs, then updates this dimension breakdown.",
  },
  "requires-overall-update": {
    header: "Overall Results require an update",
    cta: "Update Overall Results",
    body: "Metric settings have changed, so Overall Results must update before this dimension breakdown can. Confirming starts the update, shows Overall Results while it runs, then updates this dimension breakdown.",
  },
};

export default function MainSnapshotRefreshDialog({
  kind,
  onConfirm,
  onCancel,
}: {
  kind: SnapshotRefreshBlocker["kind"];
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const copy = COPY_BY_KIND[kind];
  return (
    <ModalStandard
      open={true}
      header={copy.header}
      subheader="Dimension Results are computed from Overall Results"
      cta={copy.cta}
      trackingEventModalType="incremental-pipeline-main-snapshot-refresh"
      submit={onConfirm}
      close={onCancel}
    >
      <Text size="md" color="text-high" as="p">
        {copy.body}
      </Text>
    </ModalStandard>
  );
}

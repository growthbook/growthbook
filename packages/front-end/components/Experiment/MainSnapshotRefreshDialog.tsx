import { Trans, useLingui } from "@lingui/react/macro";
import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export default function MainSnapshotRefreshDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  return (
    <ModalStandard
      open={true}
      header={t`Overall Results require a Full Refresh`}
      subheader={t`Dimension Results are computed from Overall Results`}
      cta={t`Run full refresh`}
      trackingEventModalType="incremental-pipeline-main-snapshot-refresh"
      submit={onConfirm}
      close={onCancel}
    >
      <Text size="md" color="text-high" as="p">
        <Trans>
          Settings have changed, so Overall Results must be rebuilt with a full
          refresh before this dimension breakdown can update. A full refresh can
          take longer to run. Confirming starts it and switches you to Overall
          Results.
        </Trans>
      </Text>
    </ModalStandard>
  );
}

import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  return (
    <ModalStandard
      open={true}
      header={t`Update without Incremental Pipeline`}
      subheader={t`This re-scans all experiment data from the start instead of only new data, so it may take longer and cost more.`}
      cta={t`Update anyway`}
      trackingEventModalType="incremental-pipeline-fallback"
      submit={onConfirm}
      close={onCancel}
    >
      <Text size="md" color="text-high" as="p">
        <Text size="md" weight="semibold" color="text-high">
          <Trans>Why incremental updates are unavailable:</Trans>
        </Text>
        <br />
        {reason}
      </Text>
    </ModalStandard>
  );
}

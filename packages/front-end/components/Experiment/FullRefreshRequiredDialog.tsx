import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  if (!controller.open) return null;
  return (
    <ModalStandard
      open={true}
      header={t`Unable to incrementally update`}
      subheader={t`Settings have changed, requiring a Full Refresh.`}
      cta={t`Run full refresh`}
      trackingEventModalType="incremental-pipeline-full-refresh"
      submit={controller.onConfirm}
      close={controller.onCancel}
    >
      <Text size="md" color="text-high" as="p">
        <Trans>
          A full refresh can take longer to update, as it rebuilds the
          incremental pipeline with the new settings applied:
        </Trans>
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

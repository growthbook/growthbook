import { Box } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export interface Props {
  close: () => void;
  startAnalysis: () => Promise<void>;
}

export default function StartHoldoutAnalysisModal({
  close,
  startAnalysis,
}: Props) {
  const { t } = useLingui();
  return (
    <ModalStandard
      trackingEventModalType="start-holdout"
      trackingEventModalSource={"start-holdout-analysis"}
      open={true}
      size="md"
      submit={startAnalysis}
      ctaColor="red"
      cta={t`Confirm`}
      ctaEnabled={true}
      close={close}
      header={t`Start Analysis Phase`}
    >
      <Box>
        <Text as="div" size="md" color="text-mid">
          <Trans>Once you start the Analysis Phase:</Trans>
          <ul style={{ paddingLeft: "var(--space-4)", marginBottom: 0 }}>
            <li>
              <Trans>
                No new features or experiments can be added to the holdout
              </Trans>
            </li>
            <li>
              <Trans>
                Traffic will continue to be held out from existing features and
                experiments
              </Trans>
            </li>
            <li>
              <Trans>
                Data will continue collecting until you stop the holdout
              </Trans>
            </li>
          </ul>
        </Text>
      </Box>
    </ModalStandard>
  );
}

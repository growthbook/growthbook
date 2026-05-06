import { Box } from "@radix-ui/themes";
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
  return (
    <ModalStandard
      trackingEventModalType="start-holdout"
      trackingEventModalSource={"start-holdout-analysis"}
      open={true}
      size="md"
      submit={startAnalysis}
      ctaColor="red"
      cta="Confirm"
      ctaEnabled={true}
      close={close}
      header="Start Analysis Phase"
    >
      <Box>
        <Text as="div" size="medium" color="text-mid">
          Once you start the Analysis Phase:
          <ul style={{ paddingLeft: "var(--space-4)", marginBottom: 0 }}>
            <li>No new features or experiments can be added to the holdout</li>
            <li>
              Traffic will continue to be held out from existing features and
              experiments
            </li>
            <li>Data will continue collecting until you stop the holdout</li>
          </ul>
        </Text>
      </Box>
    </ModalStandard>
  );
}

import { Box, Text } from "@radix-ui/themes";
import Modal from "@/components/Modal";

export interface Props {
  close: () => void;
  startAnalysis: () => Promise<void>;
}

export default function StartAnalysisModal({ close, startAnalysis }: Props) {
  return (
    <Modal
      trackingEventModalType="start-holdout"
      trackingEventModalSource={"start-holdout-analysis"}
      open={true}
      size="md"
      submit={startAnalysis}
      submitColor="danger"
      cta="Confirm"
      ctaEnabled={true}
      close={close}
      useRadixButton={true}
      header="Start Analysis Phase"
    >
      <Box p="2">
        <Text style={{ color: "var(--color-text-mid)" }}>
          Once you start the Analysis Phase:
          <ul className="pl-4">
            <li>No new features or experiments can be added to the holdout</li>
            <li>
              Units will continue to be held out from existing features and
              experiments
            </li>
            <li>Data will continue collecting until you stop the holdout</li>
          </ul>
        </Text>
      </Box>
    </Modal>
  );
}

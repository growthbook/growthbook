import { Box } from "@radix-ui/themes";
import Modal from "@/components/Modal";
import Text from "@/ui/Text";

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
        <Text size="medium" color="text-mid">
          Once you start the Analysis Phase:
          <ul className="pl-4">
            <li>No new features or experiments can be added to the holdout</li>
            <li>
              Traffic will continue to be held out from existing features and
              experiments
            </li>
            <li>Data will continue collecting until you stop the holdout</li>
          </ul>
        </Text>
      </Box>
    </Modal>
  );
}

import Modal from "@/components/Modal";

export interface Props {
  close: () => void;
  startAnalysis: () => Promise<void>;
}

export default function StartAnalysisModal({ close, startAnalysis }: Props) {
  return (
    <Modal
      trackingEventModalType="start-experiment"
      trackingEventModalSource={"start-holdout-analysis"}
      open={true}
      size="md"
      submit={startAnalysis}
      cta="Start Now"
      ctaEnabled={true}
      close={close}
      useRadixButton={true}
      header="Start Holdout Analysis"
    >
      <div className="p-2">
        <div>
          Once you start Analysis Period you will not be able to add any
          features or experiments to the holdout. The holdout will continue to
          run and collect data until you stop the holdout
        </div>
      </div>
    </Modal>
  );
}

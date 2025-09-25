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
      cta="Start Now"
      ctaEnabled={true}
      close={close}
      useRadixButton={true}
      header="Start Holdout Analysis Period"
    >
      <div className="p-2">
        <div>
          Once you start the Analysis Period you will not be able to add any
          features or experiments to the holdout. Units will continue to be held
          out from existing features and experiments and data will continue
          collecting until you stop the holdout.
        </div>
      </div>
    </Modal>
  );
}

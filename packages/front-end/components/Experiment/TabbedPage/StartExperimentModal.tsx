import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PiInfoFill } from "react-icons/pi";
import Modal from "@/ui/Modal";
import ModalForm, { useModalForm } from "@/ui/Modal/ModalForm";
import Button from "@/ui/Button";
import StartModalSection from "@/components/Experiment/StartModalSection";
import { StartSummary } from "./StartSections";
import { StartExperiment } from "./useStartExperiment";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  startExperiment: StartExperiment["startExperiment"];
}

function SubmitButton() {
  const { loading } = useModalForm();
  return (
    <Button type="submit" loading={loading}>
      Start now
    </Button>
  );
}

/** Starting a holdout. Experiments start from their review instead. */
export default function StartExperimentModal({
  experiment,
  close,
  startExperiment,
}: Props) {
  return (
    <Modal.Root
      open={true}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      size="lg"
      trackingEventModalType="start-experiment"
      hasDescription
    >
      <ModalForm
        onSubmit={async () => {
          await startExperiment();
          close();
        }}
      >
        <Modal.Header>
          <Modal.Title>Start Holdout</Modal.Title>
        </Modal.Header>
        <Modal.Description>
          Once started, experiments and features can be added to the holdout.
        </Modal.Description>
        <Modal.Body>
          {experiment.phases?.length ? (
            <StartModalSection
              title="Summary"
              icon={<PiInfoFill color="var(--indigo-11)" size={15} />}
            >
              <StartSummary experiment={experiment} />
            </StartModalSection>
          ) : null}
        </Modal.Body>
        <Modal.Footer justify="between">
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </Modal.Close>
          <SubmitButton />
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}

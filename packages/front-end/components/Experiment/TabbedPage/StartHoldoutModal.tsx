import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PiInfoFill } from "react-icons/pi";
import { Trans, useLingui } from "@lingui/react/macro";
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
      <Trans>Start now</Trans>
    </Button>
  );
}

export default function StartHoldoutModal({
  experiment,
  close,
  startExperiment,
}: Props) {
  const { t } = useLingui();
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
          <Modal.Title>
            <Trans>Start Holdout</Trans>
          </Modal.Title>
        </Modal.Header>
        <Modal.Description>
          <Trans>
            Once started, experiments and features can be added to the holdout.
          </Trans>
        </Modal.Description>
        <Modal.Body>
          {experiment.phases.length ? (
            <StartModalSection
              title={t`Summary`}
              icon={<PiInfoFill color="var(--indigo-11)" size={15} />}
            >
              <StartSummary experiment={experiment} />
            </StartModalSection>
          ) : null}
        </Modal.Body>
        <Modal.Footer justify="between">
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              <Trans>Cancel</Trans>
            </Button>
          </Modal.Close>
          <SubmitButton />
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}

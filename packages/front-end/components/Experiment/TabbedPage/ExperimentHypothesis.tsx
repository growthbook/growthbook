import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useState } from "react";
import { Flex, Heading } from "@radix-ui/themes";
import Frame from "@/components/Radix/Frame";
import Button from "@/components/Radix/Button";
import EditHypothesisModal from "../EditHypothesisModal";

export default function ExperimentHypothesis({
  experiment,
  canEditExperiment,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  canEditExperiment: boolean;
  mutate: () => void;
}) {
  const [showHypothesisModal, setShowHypothesisModal] = useState(false);

  return (
    <>
      {showHypothesisModal ? (
        <EditHypothesisModal
          source="experiment-setup-tab"
          mutate={mutate}
          experimentId={experiment.id}
          initialValue={experiment.hypothesis}
          close={() => setShowHypothesisModal(false)}
        />
      ) : null}

      <Frame>
        <Flex align="start" justify="between" mb="3">
          <Heading as="h4" size="3">
            Hypothesis
          </Heading>
          {canEditExperiment ? (
            <Button
              variant="ghost"
              onClick={() => setShowHypothesisModal(true)}
            >
              Edit
            </Button>
          ) : null}
        </Flex>
        <div>
          {!experiment.hypothesis ? (
            <span className="font-italic text-muted">
              Add a hypothesis statement to help focus the nature of your
              experiment
            </span>
          ) : (
            experiment.hypothesis
          )}
        </div>
      </Frame>
    </>
  );
}

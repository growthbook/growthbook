import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { MdRocketLaunch } from "react-icons/md";
import { ReactElement } from "react";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { useCelebration } from "@/hooks/useCelebration";
import Button from "../Button";
import ConfirmButton from "../Modal/ConfirmButton";
import LoadingOverlay from "../LoadingOverlay";

export function StartExperimentBanner({
  experiment,
  mutateExperiment,
  newPhase,
  onStart,
  className,
  checklistItemsRemaining,
  noConnectionsWarning,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutateExperiment: () => unknown | Promise<unknown>;
  checklistItemsRemaining: number | null;
  newPhase?: (() => void) | null;
  onStart?: () => void;
  className?: string;
  noConnectionsWarning: ReactElement | null;
}) {
  const { apiCall } = useAuth();
  const startCelebration = useCelebration();

  async function startExperiment() {
    startCelebration();
    if (!experiment.phases?.length) {
      if (newPhase) {
        newPhase();
        return;
      } else {
        throw new Error("You do not have permission to start this experiment");
      }
    }

    await apiCall(`/experiment/${experiment.id}/status`, {
      method: "POST",
      body: JSON.stringify({
        status: "running",
      }),
    });
    await mutateExperiment();
    track("Start experiment", {
      source: "experiment-start-banner",
      action: "main CTA",
    });
    onStart && onStart();
  }

  return (
    <div className={className ?? `appbox p-4 my-4`}>
      <div className="row">
        <div className="col pt-3 text-center">
          {checklistItemsRemaining === null ? (
            <LoadingOverlay />
          ) : (
            <>
              {checklistItemsRemaining === 0 ? (
                <p style={{ fontSize: "1.2em", fontWeight: "bold" }}>
                  Everything looks great! Let&apos;s Go!
                </p>
              ) : (
                <>
                  <p style={{ fontSize: "1.2em", fontWeight: "bold" }}>
                    Wait - The Pre-Launch Checklist is incomplete!
                  </p>
                  <div className="alert alert-warning">
                    <span>
                      There {checklistItemsRemaining > 1 ? "are" : "is"} still{" "}
                      {checklistItemsRemaining} incomplete task
                      {checklistItemsRemaining > 1 ? "s" : ""} to complete
                      before you can start this experiment.
                    </span>
                  </div>
                </>
              )}
              {noConnectionsWarning ? noConnectionsWarning : null}
              {checklistItemsRemaining === 0 && !noConnectionsWarning ? (
                <Button
                  color="teal"
                  className="btn-lg mb-2"
                  onClick={async () => {
                    await startExperiment();
                  }}
                >
                  Start Experiment <MdRocketLaunch />
                </Button>
              ) : (
                <ConfirmButton
                  cta="Yes, Start Anyway"
                  onClick={async () => {
                    await startExperiment();
                  }}
                  modalHeader="Start Experiment"
                  confirmationText={
                    "You haven't completed the pre-launch checklist.  Are you sure you still want to start?"
                  }
                >
                  <button className="btn btn-teal btn-lg mb-2" type="button">
                    Start Experiment <MdRocketLaunch />
                  </button>
                </ConfirmButton>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

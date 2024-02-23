import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { MdRocketLaunch } from "react-icons/md";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import Link from "next/link";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { useCelebration } from "@/hooks/useCelebration";
import Button from "../Button";
import ConfirmButton from "../Modal/ConfirmButton";
import LoadingOverlay from "../LoadingOverlay";
import { DocLink } from "../DocLink";

export function StartExperimentBanner({
  experiment,
  checklistItemsRemaining,
  visualChangesets,
  connections,
  mutateExperiment,
  newPhase,
  onStart,
  className,
}: {
  experiment: ExperimentInterfaceStringDates;
  checklistItemsRemaining: number | null;
  visualChangesets: VisualChangesetInterface[];
  connections: SDKConnectionInterface[];
  mutateExperiment: () => unknown | Promise<unknown>;
  newPhase?: (() => void) | null;
  onStart?: () => void;
  className?: string;
}) {
  const { apiCall } = useAuth();
  const startCelebration = useCelebration();

  const projectConnections = connections.filter(
    (connection) =>
      !connection.projects.length ||
      connection.projects.includes(experiment.project || "")
  );
  const matchingConnections = projectConnections.filter(
    (connection) =>
      !visualChangesets.length || connection.includeVisualExperiments
  );
  const verifiedConnections = matchingConnections.filter(
    (connection) => connection.connected
  );

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
                      {checklistItemsRemaining} task
                      {checklistItemsRemaining > 1 ? "s" : ""} to complete
                      before you can start this experiment.
                    </span>
                  </div>
                </>
              )}
              {!verifiedConnections.length ? (
                <div className="alert alert-danger">
                  <strong>
                    Before you can run an experiment, you need to{" "}
                    <Link href="/sdks">
                      <a href="#">integrate GrowthBook into</a>
                    </Link>{" "}
                    your app.{" "}
                    <DocLink docSection="quick_start_sdks">Learn More</DocLink>
                  </strong>
                </div>
              ) : null}
              {checklistItemsRemaining === 0 && verifiedConnections.length ? (
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

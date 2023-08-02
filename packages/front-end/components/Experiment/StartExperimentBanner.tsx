import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureInterface } from "back-end/types/feature";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import Link from "next/link";
import { MatchingRule } from "shared/util";
import { MdRocketLaunch } from "react-icons/md";
import { ReactElement } from "react";
import {
  FaCheckSquare,
  FaMinusSquare,
  FaRegSquare,
  FaTimes,
} from "react-icons/fa";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import Button from "../Button";
import Tooltip from "../Tooltip/Tooltip";

export function StartExperimentBanner({
  experiment,
  linkedFeatures,
  visualChangesets,
  connections,
  mutateExperiment,
  editPhase,
  newPhase,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: {
    feature: FeatureInterface;
    rules: MatchingRule[];
  }[];
  visualChangesets: VisualChangesetInterface[];
  connections: SDKConnectionInterface[];
  mutateExperiment: () => unknown | Promise<unknown>;
  newPhase?: (() => void) | null;
  editPhase?: ((i: number | null) => void) | null;
}) {
  const { apiCall } = useAuth();

  if (experiment.status !== "draft") return null;

  type CheckListItem = {
    display: string | ReactElement;
    status: "error" | "skip" | "success" | "unknown";
    tooltip?: string | ReactElement;
  };
  const checklist: CheckListItem[] = [];

  // At least one linked change
  const hasLinkedChanges =
    linkedFeatures.length > 0 || visualChangesets.length > 0;
  checklist.push({
    display:
      "At least one linked change (Feature Flag or Visual Editor) added to experiment",
    status: hasLinkedChanges ? "success" : "error",
  });

  // No unpublished feature flags
  const hasFeatureFlagsErrors = linkedFeatures.some((f) =>
    f.rules.some(
      (r) => r.draft || !r.environmentEnabled || r.rule.enabled === false
    )
  );
  checklist.push({
    display: "All linked Feature Flag rules are published and enabled",
    status:
      linkedFeatures.length === 0
        ? "skip"
        : hasFeatureFlagsErrors
        ? "error"
        : "success",
  });

  // No empty visual changesets
  const hasSomeVisualChanges = visualChangesets.some((vc) =>
    vc.visualChanges.some(
      (changes) => changes.css || changes.js || changes.domMutations?.length > 0
    )
  );
  checklist.push({
    display:
      "All linked Visual Editor changes have been configured and saved in the editor",
    status:
      visualChangesets.length === 0
        ? "skip"
        : hasSomeVisualChanges
        ? "success"
        : "error",
  });

  // SDK Connection set up
  const projectConnections = connections.filter(
    (connection) =>
      !experiment.project ||
      !connection.project ||
      experiment.project === connection.project
  );
  const matchingConnections = projectConnections.filter(
    (connection) =>
      !visualChangesets.length || connection.includeVisualExperiments
  );
  const verifiedConnections = matchingConnections.filter(
    (connection) => connection.connected
  );
  checklist.push({
    display: "GrowthBook SDK integrated into your app",
    status: verifiedConnections.length > 0 ? "success" : "error",
    tooltip:
      verifiedConnections.length > 0 ? (
        ""
      ) : matchingConnections.length > 0 ? (
        "Your SDK Connection has not been verified to be working yet"
      ) : projectConnections.length > 0 ? (
        <>
          You must edit your SDK Connection to include Visual Experiments.{" "}
          <Link href="/sdks">View SDK Connections</Link>
        </>
      ) : connections.length > 0 ? (
        <>
          You have SDK Connections configured, but not for this
          experiment&apos;s project.{" "}
          <Link href="/sdks">View SDK Connections</Link>
        </>
      ) : (
        <>
          You don&apos;t have any SDK Connections configured yet.{" "}
          <Link href="/sdks">Create an SDK Connection</Link>
        </>
      ),
  });

  // Experiment has phases
  const hasPhases = experiment.phases.length > 0;
  checklist.push({
    display: (
      <>
        Variation assignment and targeting conditions have been configured.{" "}
        {hasPhases ? (
          <a
            href="#"
            className="ml-2"
            onClick={(e) => {
              e.preventDefault();
              if (editPhase) editPhase(experiment.phases.length - 1);
              track("Edit phase", { source: "experiment-start-banner" });
            }}
          >
            Edit Targeting
          </a>
        ) : (
          <a
            href="#"
            className="ml-2"
            onClick={(e) => {
              e.preventDefault();
              if (newPhase) newPhase();
              track("Add phase", { source: "experiment-start-banner" });
            }}
          >
            Add Targeting
          </a>
        )}
      </>
    ),
    status: hasPhases ? "success" : "error",
  });

  // TODO: Do we have a way to validate this or at least give a way for users to dismiss this?
  checklist.push({
    display: (
      <>
        Your app is passing both <code>attributes</code> and a{" "}
        <code>trackingCallback</code> into the GrowthBook SDK
      </>
    ),
    status: "unknown",
    tooltip: "We're not able to verify this automatically at this time",
  });

  async function startExperiment() {
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
  }

  const allPassed = !checklist.some((c) => c.status === "error");

  // Prompt them to start with an option to edit the targeting first
  return (
    <div className="appbox p-4 my-4 text-center">
      <div className="row align-items-center">
        <div className="col-auto text-left">
          <h3 className="text-purple">Pre-launch Check List</h3>
          <ul style={{ fontSize: "1.1em" }} className="ml-0 pl-0">
            {checklist.map((item, i) => (
              <li
                key={i}
                style={
                  item.status === "skip"
                    ? {
                        listStyleType: "none",
                        opacity: 0.5,
                        marginLeft: 0,
                      }
                    : {
                        listStyleType: "none",
                        marginLeft: 0,
                      }
                }
              >
                {item.status === "error" ? (
                  <FaTimes className="text-danger" />
                ) : item.status === "skip" ? (
                  <FaMinusSquare />
                ) : item.status === "success" ? (
                  <FaCheckSquare className="text-success" />
                ) : (
                  <Tooltip body={item.tooltip || ""}>
                    <FaRegSquare />
                  </Tooltip>
                )}{" "}
                {item.display}{" "}
                {item.tooltip ? <Tooltip body={item.tooltip} /> : ""}
              </li>
            ))}
          </ul>
        </div>
        {allPassed && (
          <div className="col">
            <p>Everything looks great! Let&apos;s Go!</p>
            <Button
              color="primary"
              className="btn-lg"
              onClick={async () => {
                await startExperiment();
              }}
            >
              Start Experiment <MdRocketLaunch />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

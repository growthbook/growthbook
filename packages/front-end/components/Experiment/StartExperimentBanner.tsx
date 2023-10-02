import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import Link from "next/link";
import { MdRocketLaunch } from "react-icons/md";
import { ReactElement } from "react";
import { FaCheckSquare, FaExternalLinkAlt, FaTimes } from "react-icons/fa";
import { hasVisualChanges } from "shared/util";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import Button from "../Button";
import Tooltip from "../Tooltip/Tooltip";
import ConfirmButton from "../Modal/ConfirmButton";
import { LinkedFeature } from "./TabbedPage";

export function StartExperimentBanner({
  experiment,
  linkedFeatures,
  visualChangesets,
  connections,
  mutateExperiment,
  newPhase,
  editTargeting,
  onStart,
  openSetupTab,
  className,
  noConfirm,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeature[];
  visualChangesets: VisualChangesetInterface[];
  connections: SDKConnectionInterface[];
  mutateExperiment: () => unknown | Promise<unknown>;
  newPhase?: (() => void) | null;
  editTargeting?: (() => void) | null;
  onStart?: () => void;
  openSetupTab?: () => void;
  className?: string;
  noConfirm?: boolean;
}) {
  const { apiCall } = useAuth();

  if (experiment.status !== "draft") return null;

  type CheckListItem = {
    display: string | ReactElement;
    status: "error" | "success";
    tooltip?: string | ReactElement;
    action?: ReactElement | null;
  };
  const checklist: CheckListItem[] = [];

  // At least one linked change
  const hasLinkedChanges =
    linkedFeatures.length > 0 || visualChangesets.length > 0;
  checklist.push({
    display: "Add at least one Linked Feature or Visual Editor change.",
    status: hasLinkedChanges ? "success" : "error",
    action:
      openSetupTab && !hasLinkedChanges ? (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            openSetupTab();
          }}
        >
          Setup Experiment
        </a>
      ) : null,
  });

  // No unpublished feature flags
  if (linkedFeatures.length > 0) {
    const hasFeatureFlagsErrors = linkedFeatures.some(
      (f) =>
        !f.rules.some(
          (r) => !r.draft && r.environmentEnabled && r.rule.enabled !== false
        )
    );
    checklist.push({
      display: "Publish and enable all Linked Feature rules.",
      status: hasFeatureFlagsErrors ? "error" : "success",
      action: openSetupTab ? (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            openSetupTab();
          }}
        >
          Manage Linked Features
        </a>
      ) : null,
    });
  }

  // No empty visual changesets
  if (visualChangesets.length > 0) {
    const hasSomeVisualChanges = visualChangesets.some((vc) =>
      hasVisualChanges(vc.visualChanges)
    );
    checklist.push({
      display: "Add changes in the Visual Editor.",
      status: hasSomeVisualChanges ? "success" : "error",
      action: openSetupTab ? (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            openSetupTab();
          }}
        >
          Manage Visual Changes
        </a>
      ) : null,
    });
  }

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
    display: "Integrate the GrowthBook SDK into your app.",
    action: (
      <Link href="/sdks">
        <a>
          {connections.length > 0
            ? "Manage SDK Connections"
            : "Create an SDK Connection"}{" "}
          <FaExternalLinkAlt />
        </a>
      </Link>
    ),
    status: verifiedConnections.length > 0 ? "success" : "error",
    tooltip:
      verifiedConnections.length > 0
        ? ""
        : matchingConnections.length > 0
        ? "Your SDK Connection has not been verified to be working yet"
        : projectConnections.length > 0
        ? "You must edit your SDK Connection to include Visual Experiments."
        : connections.length > 0
        ? "You have SDK Connections configured, but not for this experiment&apos;s project."
        : "You don't have any SDK Connections configured yet.",
  });

  // Experiment has phases
  const hasPhases = experiment.phases.length > 0;
  checklist.push({
    display: "Configure variation assignment and targeting behavior.",
    action: editTargeting ? (
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          editTargeting();
          track("Edit targeting", { source: "experiment-start-banner" });
        }}
      >
        Edit Targeting
      </a>
    ) : null,
    status: hasPhases ? "success" : "error",
  });

  const manualChecklist: (string | ReactElement)[] = [];

  // TODO: Do we have a way to validate this or at least give a way for users to dismiss this?
  manualChecklist.push(
    <>
      Verify your app is passing both <code>attributes</code> and a{" "}
      <code>trackingCallback</code> into the GrowthBook SDK
    </>
  );
  manualChecklist.push(
    <>
      Verify your app is tracking events for all of the metrics that you plan to
      include in the analysis
    </>
  );

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
    onStart && onStart();
  }

  const allPassed = !checklist.some((c) => c.status === "error");

  // Prompt them to start with an option to edit the targeting first
  return (
    <div className={className ?? `appbox p-4 my-4`}>
      <div className="row">
        <div className="col-auto text-left">
          <h3 className="text-purple">Pre-launch Check List</h3>
          <ul style={{ fontSize: "1.1em" }} className="ml-0 pl-0">
            {checklist.map((item, i) => (
              <li
                key={i}
                style={{
                  listStyleType: "none",
                  marginLeft: 0,
                  marginBottom: 3,
                }}
              >
                <Tooltip body={item.tooltip || ""}>
                  {item.status === "error" ? (
                    <FaTimes className="text-danger" />
                  ) : item.status === "success" ? (
                    <FaCheckSquare className="text-success" />
                  ) : (
                    ""
                  )}{" "}
                  {item.display}
                  {item.action ? (
                    <span className="ml-2">{item.action}</span>
                  ) : null}
                </Tooltip>
              </li>
            ))}
          </ul>
          <small className="text-uppercase">
            <strong>Manual Checks</strong>
          </small>{" "}
          <Tooltip body={"We're not able to verify these automatically"} />
          <ul style={{ fontSize: "1.1em" }} className="ml-0 pl-0 mb-0 pb-0">
            {manualChecklist.map((item, i) => (
              <li key={i} style={{ listStyleType: "none", marginLeft: 0 }}>
                &bull; {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="col pt-3 text-center">
          {allPassed ? (
            <p>Everything looks great! Let&apos;s Go!</p>
          ) : noConfirm ? (
            <p style={{ fontSize: "1.2em", fontWeight: "bold" }}>
              Are you sure you still want to start?
            </p>
          ) : (
            <p>Almost there! Just a few things left</p>
          )}
          {allPassed || noConfirm ? (
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
              <button
                className="btn btn-teal btn-lg mb-2 disabled"
                type="button"
              >
                Start Experiment <MdRocketLaunch />
              </button>
            </ConfirmButton>
          )}
        </div>
      </div>
    </div>
  );
}

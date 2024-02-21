import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { ExperimentLaunchChecklistInterface } from "back-end/types/experimentLaunchChecklist";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { ReactElement } from "react";

type CheckListItem = {
  display: ReactElement;
  status: "complete" | "incomplete";
  tooltip?: string | ReactElement;
  key?: string;
  type: "auto" | "manual";
};

// Move the logic here to calculate tasks remaining on pre-launch checklist

export function buildPreLaunchChecklist(
  checklist: ExperimentLaunchChecklistInterface | undefined,
  experiment: ExperimentInterfaceStringDates,
  visualChangesets: VisualChangesetInterface[],
  linkedFeatures: LinkedFeatureInfo[]
) {
  const experimentChecklist: CheckListItem[] = [];

  // At least one linked change
  const hasLinkedChanges =
    linkedFeatures.some((f) => f.state === "live" || f.state === "draft") ||
    visualChangesets.length > 0;
  experimentChecklist.push({
    display: (
      // TODO: Pick back up here - the system isn't happy with passing in the ReactElement here - maybe pass it in as a string?
      <>
        Add at least one{" "}
        {openSetupTab && !hasLinkedChanges ? (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              openSetupTab();
            }}
          >
            Linked Feature or Visual Editor change
          </a>
        ) : (
          "Linked Feature or Visual Editor change"
        )}
        .
      </>
    ),
    status: hasLinkedChanges ? "complete" : "incomplete",
    type: "auto",
  });

  // No unpublished feature flags
  if (linkedFeatures.length > 0) {
    const hasFeatureFlagsErrors = linkedFeatures.some(
      (f) =>
        f.state === "draft" ||
        (f.state === "live" &&
          !Object.values(f.environmentStates || {}).some((s) => s === "active"))
    );
    experimentChecklist.push({
      status: hasFeatureFlagsErrors ? "incomplete" : "complete",
      type: "auto",
      display: (
        <>
          Publish and enable all{" "}
          {openSetupTab ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                openSetupTab();
              }}
            >
              Linked Feature
            </a>
          ) : (
            "Linked Feature"
          )}{" "}
          rules.
        </>
      ),
    });
  }

  // No empty visual changesets
  if (visualChangesets.length > 0) {
    const hasSomeVisualChanges = visualChangesets.some((vc) =>
      hasVisualChanges(vc.visualChanges)
    );
    experimentChecklist.push({
      display: (
        <>
          Add changes in the{" "}
          {openSetupTab ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                openSetupTab();
              }}
            >
              Visual Editor
            </a>
          ) : (
            "Visual Editor"
          )}
          .
        </>
      ),
      status: hasSomeVisualChanges ? "complete" : "incomplete",
      type: "auto",
    });
  }

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

  if (!verifiedConnections) {
    setWarnings(
      <>
        Before you can run an experiment, you need to integrate the GrowthBook
        into your app.{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setShowSdkForm(true);
          }}
        >
          Create an SDK Connection
        </a>
        .
      </>
    );
  }

  // Experiment has phases
  const hasPhases = experiment.phases.length > 0;
  experimentChecklist.push({
    display: (
      <>
        {editTargeting ? (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              editTargeting();
              track("Edit targeting", { source: "experiment-start-banner" });
            }}
          >
            Configure
          </a>
        ) : (
          "Configure"
        )}{" "}
        variation assignment and targeting behavior.
      </>
    ),
    status: hasPhases ? "complete" : "incomplete",
    type: "auto",
  });

  experimentChecklist.push({
    type: "manual",
    key: "sdk-connection",
    status: isChecklistItemComplete("manual", "sdk-connection")
      ? "complete"
      : "incomplete",
    display: (
      <div>
        Verify your app is passing both<code> attributes </code>
        and a <code> trackingCallback </code>into the GrowthBook SDK
      </div>
    ),
  });
  experimentChecklist.push({
    type: "manual",
    key: "metrics-tracked",
    status: isChecklistItemComplete("manual", "metrics-tracked")
      ? "complete"
      : "incomplete",
    display: (
      <>
        Verify your app is tracking events for all of the metrics that you plan
        to include in the analysis
      </>
    ),
  });

  if (checklist && checklist.experimentChecklist?.tasks?.length > 0) {
    data?.experimentChecklist.tasks.forEach((item) => {
      console.log("item from backend", item);
      if (item.completionType === "manual") {
        experimentChecklist.push({
          type: "manual",
          key: item.task,
          status: isChecklistItemComplete("manual", item.task)
            ? "complete"
            : "incomplete",
          display: item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.task}
            </a>
          ) : (
            <>{item.task}</>
          ),
        });
      }

      if (item.completionType === "auto" && item.propertyKey) {
        experimentChecklist.push({
          display: <>{item.task}</>,
          status: isChecklistItemComplete("auto", item.propertyKey)
            ? "complete"
            : "incomplete",
          type: "auto",
        });
      }
    });
  }
  return experimentChecklist || null;
}

function isChecklistItemComplete(
  type: "auto" | "manual",
  key: string
): boolean {
  if (type === "auto") {
    if (!key) return false;
    switch (key) {
      case "hypothesis":
        return !!experiment.hypothesis;
      case "screenshots":
        return experiment.variations.every((v) => !!v.screenshots.length);
      case "description":
        return !!experiment.description;
      case "project":
        return !!experiment.project;
      case "tag":
        return experiment.tags?.length > 0;
    }
  }

  const index = manualChecklistStatus.findIndex(
    (task) => task.key === key //TODO: Is this correct?
  );

  if (index === -1 || !manualChecklistStatus[index]) {
    return false;
  }

  return manualChecklistStatus[index].status === "complete";
}

export function itemsRemainingBadge(checklist: any): ReactElement {
  let itemsRemaining = 0;
  checklist.forEach((item) => {
    if (
      item.status === "incomplete" ||
      (item.key && !isChecklistItemComplete(item.type, item.key))
    ) {
      itemsRemaining++;
    }
    if (item.status === "complete") {
      itemsRemaining++;
    }
  });

  if (itemsRemaining === 0) {
    // setCheckListOpen(false); //TODO: Refactor this - it's causing an infinite loop
    return <span className="badge badge-success mx-2 my-0">Complete</span>;
  }

  return (
    <span className="badge badge-warning mx-2 my-0">
      {itemsRemaining} task{itemsRemaining > 1 ? "s" : ""} remaining
    </span>
  );
}

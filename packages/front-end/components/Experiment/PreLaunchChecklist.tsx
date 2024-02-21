import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { ReactElement, useState } from "react";
import { FaChevronRight } from "react-icons/fa";
import { hasVisualChanges } from "shared/util";
import { ExperimentLaunchChecklistInterface } from "back-end/types/experimentLaunchChecklist";
import Link from "next/link";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import InitialSDKConnectionForm from "../Features/SDKConnections/InitialSDKConnectionForm";
import Tooltip from "../Tooltip/Tooltip";

// type CheckListItem = {
//   display: string | ReactElement;
//   status: "complete" | "incomplete";
//   tooltip?: string | ReactElement;
//   key?: string;
//   type: "auto" | "manual";
// };

export function PreLaunchChecklist({
  experiment,
  linkedFeatures,
  visualChangesets,
  connections,
  mutateExperiment,
  editTargeting,
  openSetupTab,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  connections: SDKConnectionInterface[];
  mutateExperiment: () => unknown | Promise<unknown>;
  editTargeting?: (() => void) | null;
  openSetupTab?: () => void;
  className?: string;
}) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const permissions = usePermissions();
  const [warnings, setWarnings] = useState<ReactElement | null>(null);
  const [checkListOpen, setCheckListOpen] = useState(true);
  const [manualChecklistStatus, setManualChecklistStatus] = useState(
    experiment.manualLaunchChecklist || []
  );
  const [updatingChecklist, setUpdatingChecklist] = useState(false);

  const [showSdkForm, setShowSdkForm] = useState(false);
  const canEditChecklist =
    hasCommercialFeature("custom-launch-checklist") &&
    permissions.check("organizationSettings");

  // const checklist: CheckListItem[] = [];

  // //TODO: Move this to [eid].tsx & pass it into
  // const { data } = useApi<{ checklist: ExperimentLaunchChecklistInterface }>(
  //   "/experiments/launch-checklist"
  // ); //TODO: Can I memoize this?

  // if (experiment.status !== "draft") return null;

  // // At least one linked change
  // const hasLinkedChanges =
  //   linkedFeatures.some((f) => f.state === "live" || f.state === "draft") ||
  //   visualChangesets.length > 0;
  // checklist.push({
  //   display: (
  //     <>
  //       Add at least one{" "}
  //       {openSetupTab && !hasLinkedChanges ? (
  //         <a
  //           href="#"
  //           onClick={(e) => {
  //             e.preventDefault();
  //             openSetupTab();
  //           }}
  //         >
  //           Linked Feature or Visual Editor change
  //         </a>
  //       ) : (
  //         "Linked Feature or Visual Editor change"
  //       )}
  //       .
  //     </>
  //   ),
  //   status: hasLinkedChanges ? "complete" : "incomplete",
  //   type: "auto",
  // });

  // // No unpublished feature flags
  // if (linkedFeatures.length > 0) {
  //   const hasFeatureFlagsErrors = linkedFeatures.some(
  //     (f) =>
  //       f.state === "draft" ||
  //       (f.state === "live" &&
  //         !Object.values(f.environmentStates || {}).some((s) => s === "active"))
  //   );
  //   checklist.push({
  //     status: hasFeatureFlagsErrors ? "incomplete" : "complete",
  //     type: "auto",
  //     display: (
  //       <>
  //         Publish and enable all{" "}
  //         {openSetupTab ? (
  //           <a
  //             href="#"
  //             onClick={(e) => {
  //               e.preventDefault();
  //               openSetupTab();
  //             }}
  //           >
  //             Linked Feature
  //           </a>
  //         ) : (
  //           "Linked Feature"
  //         )}{" "}
  //         rules.
  //       </>
  //     ),
  //   });
  // }

  // // No empty visual changesets
  // if (visualChangesets.length > 0) {
  //   const hasSomeVisualChanges = visualChangesets.some((vc) =>
  //     hasVisualChanges(vc.visualChanges)
  //   );
  //   checklist.push({
  //     display: (
  //       <>
  //         Add changes in the{" "}
  //         {openSetupTab ? (
  //           <a
  //             href="#"
  //             onClick={(e) => {
  //               e.preventDefault();
  //               openSetupTab();
  //             }}
  //           >
  //             Visual Editor
  //           </a>
  //         ) : (
  //           "Visual Editor"
  //         )}
  //         .
  //       </>
  //     ),
  //     status: hasSomeVisualChanges ? "complete" : "incomplete",
  //     type: "auto",
  //   });
  // }

  // const projectConnections = connections.filter(
  //   (connection) =>
  //     !connection.projects.length ||
  //     connection.projects.includes(experiment.project || "")
  // );
  // const matchingConnections = projectConnections.filter(
  //   (connection) =>
  //     !visualChangesets.length || connection.includeVisualExperiments
  // );
  // const verifiedConnections = matchingConnections.filter(
  //   (connection) => connection.connected
  // );

  // if (!verifiedConnections) {
  //   setWarnings(
  //     <>
  //       Before you can run an experiment, you need to integrate the GrowthBook
  //       into your app.{" "}
  //       <a
  //         href="#"
  //         onClick={(e) => {
  //           e.preventDefault();
  //           setShowSdkForm(true);
  //         }}
  //       >
  //         Create an SDK Connection
  //       </a>
  //       .
  //     </>
  //   );
  // }

  // // Experiment has phases
  // const hasPhases = experiment.phases.length > 0;
  // checklist.push({
  //   display: (
  //     <>
  //       {editTargeting ? (
  //         <a
  //           href="#"
  //           onClick={(e) => {
  //             e.preventDefault();
  //             editTargeting();
  //             track("Edit targeting", { source: "experiment-start-banner" });
  //           }}
  //         >
  //           Configure
  //         </a>
  //       ) : (
  //         "Configure"
  //       )}{" "}
  //       variation assignment and targeting behavior.
  //     </>
  //   ),
  //   status: hasPhases ? "complete" : "incomplete",
  //   type: "auto",
  // });

  // function isChecklistItemComplete(
  //   type: "auto" | "manual",
  //   key: string
  // ): boolean {
  //   if (type === "auto") {
  //     if (!key) return false;
  //     switch (key) {
  //       case "hypothesis":
  //         return !!experiment.hypothesis;
  //       case "screenshots":
  //         return experiment.variations.every((v) => !!v.screenshots.length);
  //       case "description":
  //         return !!experiment.description;
  //       case "project":
  //         return !!experiment.project;
  //       case "tag":
  //         return experiment.tags?.length > 0;
  //     }
  //   }

  //   const index = manualChecklistStatus.findIndex(
  //     (task) => task.key === key //TODO: Is this correct?
  //   );

  //   if (index === -1 || !manualChecklistStatus[index]) {
  //     return false;
  //   }

  //   return manualChecklistStatus[index].status === "complete";
  // }

  // checklist.push({
  //   type: "manual",
  //   key: "sdk-connection",
  //   status: isChecklistItemComplete("manual", "sdk-connection")
  //     ? "complete"
  //     : "incomplete",
  //   display: (
  //     <div>
  //       Verify your app is passing both<code> attributes </code>
  //       and a <code> trackingCallback </code>into the GrowthBook SDK
  //     </div>
  //   ),
  // });
  // checklist.push({
  //   type: "manual",
  //   key: "metrics-tracked",
  //   status: isChecklistItemComplete("manual", "metrics-tracked")
  //     ? "complete"
  //     : "incomplete",
  //   display: (
  //     <>
  //       Verify your app is tracking events for all of the metrics that you plan
  //       to include in the analysis
  //     </>
  //   ),
  // });

  // if (data && data.checklist?.tasks?.length > 0) {
  //   data?.checklist.tasks.forEach((item) => {
  //     console.log("item from backend", item);
  //     if (item.completionType === "manual") {
  //       checklist.push({
  //         type: "manual",
  //         key: item.task,
  //         status: isChecklistItemComplete("manual", item.task)
  //           ? "complete"
  //           : "incomplete",
  //         display: item.url ? (
  //           <a href={item.url} target="_blank" rel="noreferrer">
  //             {item.task}
  //           </a>
  //         ) : (
  //           <>{item.task}</>
  //         ),
  //       });
  //     }

  //     if (item.completionType === "auto" && item.propertyKey) {
  //       checklist.push({
  //         display: <>{item.task}</>,
  //         status: isChecklistItemComplete("auto", item.propertyKey)
  //           ? "complete"
  //           : "incomplete",
  //         type: "auto",
  //       });
  //     }
  //   });
  // }

  async function updateTaskStatus(checked: boolean, key: string | undefined) {
    if (!key) return;
    setUpdatingChecklist(true);
    const updatedManualChecklistStatus = Array.isArray(manualChecklistStatus)
      ? [...manualChecklistStatus]
      : [];

    const index = updatedManualChecklistStatus.findIndex(
      (task) => task.key === key
    );
    if (index === -1) {
      updatedManualChecklistStatus.push({
        key,
        status: checked ? "complete" : "incomplete",
      });
    } else {
      updatedManualChecklistStatus[index] = {
        key,
        status: checked ? "complete" : "incomplete",
      };
    }
    setManualChecklistStatus(updatedManualChecklistStatus);
    try {
      // Updates the experiment's manual checklist and logs the event to the audit log
      await apiCall(`/experiment/${experiment.id}/launch-checklist`, {
        method: "PUT",
        body: JSON.stringify({
          checklist: updatedManualChecklistStatus,
        }),
      });
    } catch (e) {
      setUpdatingChecklist(false);
    }
    setUpdatingChecklist(false);
    mutateExperiment();
  }

  // function itemsRemainingBadge(): ReactElement {
  //   let itemsRemaining = 0;
  //   checklist.forEach((item) => {
  //     if (
  //       item.status === "incomplete" ||
  //       (item.key && !isChecklistItemComplete(item.type, item.key))
  //     ) {
  //       itemsRemaining++;
  //     }
  //     if (item.status === "complete") {
  //       itemsRemaining++;
  //     }
  //   });

  //   if (itemsRemaining === 0) {
  //     // setCheckListOpen(false); //TODO: Refactor this - it's causing an infinite loop
  //     return <span className="badge badge-success mx-2 my-0">Complete</span>;
  //   }

  //   return (
  //     <span className="badge badge-warning mx-2 my-0">
  //       {itemsRemaining} task{itemsRemaining > 1 ? "s" : ""} remaining
  //     </span>
  //   );
  // }

  return (
    <div>
      {showSdkForm && (
        <InitialSDKConnectionForm
          close={() => setShowSdkForm(false)}
          includeCheck={true}
          cta="Continue"
          goToNextStep={() => {
            setShowSdkForm(false);
          }}
        />
      )}
      <div className="appbox bg-white my-2 p-3">
        <div className="d-flex flex-row align-items-center justify-content-between">
          <h4
            role="button"
            className="m-0"
            onClick={(e) => {
              e.preventDefault();
              setCheckListOpen(!checkListOpen);
            }}
          >
            Pre-Launch Checklist {itemsRemainingBadge()}
          </h4>
          <div className="d-flex align-items-center">
            {canEditChecklist ? (
              <Link href={"/settings?editCheckListModal=true"}>
                <a>Edit</a>
              </Link>
            ) : null}
            <button
              className="btn text-dark"
              onClick={(e) => {
                e.preventDefault();
                setCheckListOpen(!checkListOpen);
              }}
            >
              <FaChevronRight
                size={12}
                style={{
                  transform: `rotate(${checkListOpen ? "90deg" : "0deg"})`,
                }}
              />
            </button>
          </div>
        </div>
        {checkListOpen ? (
          <div className="row border-top pt-2 mt-2">
            <div className="col-auto text-left mt-2">
              <ul style={{ fontSize: "1.1em" }} className="ml-0 pl-0">
                {checklist.map((item, i) => (
                  <li
                    key={i}
                    style={{
                      listStyleType: "none",
                      marginLeft: 0,
                      marginBottom: 6,
                    }}
                  >
                    <div className="d-flex align-items-center">
                      <Tooltip
                        body="GrowthBook calculates the completion of this task automatically."
                        shouldDisplay={item.type === "auto"}
                      >
                        <input
                          type="checkbox"
                          disabled={
                            (item.type === "manual" && updatingChecklist) ||
                            (item.type === "auto" &&
                              item.status === "incomplete")
                          }
                          className="ml-0 pl-0 mr-2 "
                          checked={item.status === "complete"}
                          onChange={async (e) => {
                            console.log("item", item);
                            updateTaskStatus(e.target.checked, item.key);
                          }}
                        />
                      </Tooltip>
                      <span
                        style={{
                          textDecoration:
                            item.status === "complete"
                              ? "line-through"
                              : "none",
                        }}
                      >
                        {item.display}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {warnings ? warnings : null}
      </div>
    </div>
  );
}

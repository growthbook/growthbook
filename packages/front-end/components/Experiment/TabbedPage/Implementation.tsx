import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { FaDesktop, FaLink, FaPlusCircle, FaRegFlag } from "react-icons/fa";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import usePermissions from "@/hooks/usePermissions";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
import LinkedFeatureFlag from "@/components/Experiment/LinkedFeatureFlag";
import track from "@/services/track";
import { StartExperimentBanner } from "../StartExperimentBanner";
import TargetingInfo from "./TargetingInfo";
import { ExperimentTab } from ".";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  editTargeting?: (() => void) | null;
  setFeatureModal: (open: boolean) => void;
  setVisualEditorModal: (open: boolean) => void;
  setUrlRedirectModal: (open: boolean) => void;
  linkedFeatures: LinkedFeatureInfo[];
  setTab: (tab: ExperimentTab) => void;
  connections: SDKConnectionInterface[];
}

export default function Implementation({
  experiment,
  visualChangesets,
  mutate,
  editTargeting,
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
  linkedFeatures,
  setTab,
  connections,
}: Props) {
  const phases = experiment.phases || [];

  const permissions = usePermissions();

  const canCreateAnalyses = permissions.check(
    "createAnalyses",
    experiment.project
  );
  const canEditExperiment = !experiment.archived && canCreateAnalyses;

  const hasVisualEditorPermission =
    canEditExperiment &&
    permissions.check("runExperiments", experiment.project, []);

  const hasLinkedChanges =
    visualChangesets.length > 0 || linkedFeatures.length > 0;

  if (!hasLinkedChanges) {
    if (experiment.status === "draft") {
      return (
        <>
          {/* <AddLinkedChangesBanner
            experiment={experiment}
            numLinkedChanges={0}
            setFeatureModal={setFeatureModal}
            setVisualEditorModal={setVisualEditorModal}
            setUrlRedirectModal={setUrlRedirectModal}
          /> */}
          <div className="mt-1">
            <StartExperimentBanner
              experiment={experiment}
              mutateExperiment={mutate}
              linkedFeatures={linkedFeatures}
              visualChangesets={visualChangesets}
              onStart={() => setTab("results")}
              editTargeting={editTargeting}
              connections={connections}
              className="appbox p-4"
            />
          </div>
          <div className="appbox p-4 my-4">
            <h4>Select Experiment Type</h4>
            <p>Configure options for your selected experiment type.</p>
            <hr />
            <div className="d-flex">
              <span
                className="mr-3"
                style={{
                  background: "#6E56CF15",
                  borderRadius: "50%",
                  height: "45px",
                  width: "45px",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <FaRegFlag
                  style={{ color: "#6E56CF", height: "24px", width: "24px" }}
                />
              </span>
              <div className="flex-grow-1">
                <div className="d-flex justify-content-between">
                  <b>Feature Flag</b>
                  <a href="#" onClick={() => setFeatureModal(true)}>
                    Link Feature Flag
                  </a>
                </div>
                <p className="mt-2 mb-1">
                  Use feature flags and SDKs to make changes in your front-end,
                  back-end or mobile application code.
                </p>
              </div>
            </div>

            <hr />
            <div className="d-flex">
              <span
                className="mr-3"
                style={{
                  background: "#EBA60015",
                  borderRadius: "50%",
                  height: "45px",
                  width: "45px",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <FaDesktop
                  style={{ color: "#EBA600", height: "24px", width: "24px" }}
                />
              </span>
              <div className="flex-grow-1">
                <div className="d-flex justify-content-between">
                  <b>Visual Editor</b>
                  <a href="#" onClick={() => setVisualEditorModal(true)}>
                    Launch Visual Editor
                  </a>
                </div>
                <p className="mt-2 mb-1">
                  Use our no-code browser extension to A/B test minor changes,
                  such as headings or button text.
                </p>
              </div>
            </div>
            <hr />
            <div className="d-flex">
              <span
                className="mr-3"
                style={{
                  background: "#11B08115",
                  borderRadius: "50%",
                  height: "45px",
                  width: "45px",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <FaLink
                  style={{ color: "#11B081", height: "24px", width: "24px" }}
                />
              </span>
              <div className="flex-grow-1">
                <div className="d-flex justify-content-between">
                  <b>URL Redirects</b>
                  <a href="#" onClick={() => setUrlRedirectModal(true)}>
                    Add URL Redirects
                  </a>
                </div>
                <p className="mt-2 mb-1">
                  Use our no-code tool to A/B test URL redirects for whole
                  pages, or to test parts of a URL.
                </p>
              </div>
            </div>
          </div>
        </>
      );
    }
    return (
      <div className="alert alert-info mb-0">
        This experiment has no directly linked feature flag or visual editor
        changes. Randomization, targeting, and implementation is either being
        managed by an external system or via legacy Feature Flags in GrowthBook.
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="pl-1 mb-3">
        <h2>Implementation</h2>
      </div>
      {/* <div className="row">
        <div className={hasLinkedChanges ? "col mb-3" : "col"}> */}
      <div className="appbox p-3 h-100 mb-2">
        {(experiment.status === "draft" || linkedFeatures.length > 0) && (
          <div className="mb-4">
            <div className="h4 mb-2">
              Linked Features{" "}
              <small className="text-muted">({linkedFeatures.length})</small>
            </div>
            {linkedFeatures.map((info, i) => (
              <LinkedFeatureFlag info={info} experiment={experiment} key={i} />
            ))}
            {experiment.status === "draft" && hasVisualEditorPermission && (
              <button
                className="btn btn-link"
                type="button"
                onClick={() => {
                  setFeatureModal(true);
                  track("Open linked feature modal", {
                    source: "linked-changes",
                    action: "add",
                  });
                }}
              >
                <FaPlusCircle className="mr-1" />
                Add Feature Flag
              </button>
            )}
          </div>
        )}
        {(experiment.status === "draft" || visualChangesets.length > 0) && (
          <div>
            <div className="h4 mb-2">
              Visual Editor Changes{" "}
              <small className="text-muted">({visualChangesets.length})</small>
            </div>
            <VisualChangesetTable
              experiment={experiment}
              visualChangesets={visualChangesets.filter((c) => !c.urlRedirects)}
              mutate={mutate}
              canEditVisualChangesets={hasVisualEditorPermission}
              setVisualEditorModal={setVisualEditorModal}
            />
          </div>
        )}
      </div>
      <div className="appbox p-3 mb-2">
        <div className="d-flex mb-2">
          <span
            className="mr-3"
            style={{
              background: "#11B08115",
              borderRadius: "50%",
              height: "45px",
              width: "45px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <FaLink
              style={{ color: "#11B081", height: "24px", width: "24px" }}
            />
          </span>
          <div className="flex-grow-1">
            <div className="d-flex justify-content-between">
              <h4 className="mb-0 mt-auto">URL Redirects</h4>
              <button
                className="btn btn-link align-self-center"
                onClick={() => {
                  setUrlRedirectModal(true);
                }}
              >
                <FaPlusCircle className="mr-1" />
                Add URL Redirect
              </button>
            </div>
          </div>
        </div>
        <div className="appbox p-3 mb-0">
          <div className="d-flex justify-content-between">
            <h5 className="mt-2">Original URL</h5>
            <button
              className="btn btn-link"
              onClick={() => {
                setUrlRedirectModal(true);
              }}
            >
              Edit{" "}
            </button>
          </div>

          <span>{visualChangesets[0].urlPatterns[0].pattern}</span>
          <hr />
          <h5>Redirects</h5>
          {visualChangesets[0].urlRedirects.map((v, i) => (
            <div
              className={
                i === experiment.variations.length - 1
                  ? `mb-0 variation with-variation-label variation${i}`
                  : `mb-4 variation with-variation-label variation${i}`
              }
              key={i}
            >
              <div className="d-flex align-items-baseline">
                <span
                  className="label"
                  style={{
                    width: 18,
                    height: 18,
                  }}
                >
                  {i}
                </span>
                <div className="col pl-0">
                  <h5 className="mb-0">{v.variation}</h5>
                  <span>{v.url}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* </div> */}
      {/* {hasLinkedChanges && (
          <div className="col-md-4 col-lg-4 col-12 mb-3">
            <div className="appbox p-3 h-100 mb-0">
              <TargetingInfo
                experiment={experiment}
                editTargeting={editTargeting}
                phaseIndex={phases.length - 1}
              />
            </div>
          </div>
        )} */}
      {/* </div> */}
      {hasLinkedChanges && (
        <div className="appbox p-3 h-100 mb-0">
          <TargetingInfo
            experiment={experiment}
            editTargeting={editTargeting}
            phaseIndex={phases.length - 1}
          />
        </div>
      )}

      {experiment.status === "draft" && (
        <div className="mt-1">
          <StartExperimentBanner
            experiment={experiment}
            mutateExperiment={mutate}
            linkedFeatures={linkedFeatures}
            visualChangesets={visualChangesets}
            onStart={() => setTab("results")}
            editTargeting={editTargeting}
            connections={connections}
            className="appbox p-4"
          />
        </div>
      )}
    </div>
  );
}

import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FaDesktop, FaLink, FaRegFlag } from "react-icons/fa";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { ICON_PROPERTIES } from "./constants";

export default function AddLinkedChanges({
  experiment,
  numLinkedChanges,
  linkedFeatures,
  visualChanges,
  linkedRedirects,
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
}: {
  experiment: ExperimentInterfaceStringDates;
  numLinkedChanges: number;
  linkedFeatures?: boolean;
  visualChanges?: boolean;
  linkedRedirects?: boolean;
  setVisualEditorModal: (state: boolean) => unknown;
  setFeatureModal: (state: boolean) => unknown;
  setUrlRedirectModal: (state: boolean) => unknown;
}) {
  const { hasCommercialFeature } = useUser();

  const hasVisualEditorFeature = hasCommercialFeature("visual-editor");

  if (experiment.status !== "draft") return null;
  if (experiment.archived) return null;
  // Already has linked changes
  if (numLinkedChanges && numLinkedChanges > 0) return null;

  return (
    <div className="appbox p-4 my-4">
      {linkedFeatures || visualChanges || linkedRedirects ? (
        <>
          <h4>Add Experiment Types</h4>
        </>
      ) : (
        <>
          <h4>Select Experiment Type</h4>
          <p>Configure options for your selected experiment type.</p>
        </>
      )}
      <hr />
      {!linkedFeatures && (
        <>
          <div className="d-flex">
            <span
              className="mr-3"
              style={{
                background: `${ICON_PROPERTIES["feature-flag"].color}15`,
                borderRadius: "50%",
                height: "45px",
                width: "45px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <FaRegFlag
                style={{
                  color: ICON_PROPERTIES["feature-flag"].color,
                  height: "24px",
                  width: "24px",
                }}
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
        </>
      )}

      {!visualChanges && (
        <>
          <hr />
          <div className="d-flex">
            <span
              className="mr-3"
              style={{
                background: `${ICON_PROPERTIES["visual-editor"].color}15`,
                borderRadius: "50%",
                height: "45px",
                width: "45px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <FaDesktop
                style={{
                  color: ICON_PROPERTIES["visual-editor"].color,
                  height: "24px",
                  width: "24px",
                }}
              />
            </span>
            <div className="flex-grow-1">
              <div className="d-flex justify-content-between">
                <b>Visual Editor</b>
                {hasVisualEditorFeature ? (
                  <div
                    className="btn btn-link p-0"
                    onClick={() => {
                      setVisualEditorModal(true);
                      track("Open visual editor modal", {
                        source: "visual-editor-ui",
                        action: "add",
                      });
                    }}
                  >
                    Launch Visual Editor
                  </div>
                ) : (
                  <PremiumTooltip commercialFeature={"visual-editor"}>
                    <div className="btn btn-link p-0 disabled">
                      Launch Visual Editor
                    </div>
                  </PremiumTooltip>
                )}
              </div>
              <p className="mt-2 mb-1">
                Use our no-code browser extension to A/B test minor changes,
                such as headings or button text.
              </p>
            </div>
          </div>
        </>
      )}

      {!linkedRedirects && (
        <>
          <hr />
          <div className="d-flex">
            <span
              className="mr-3"
              style={{
                background: `${ICON_PROPERTIES["redirects"].color}15`,
                borderRadius: "50%",
                height: "45px",
                width: "45px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <FaLink
                style={{
                  color: ICON_PROPERTIES["redirects"].color,
                  height: "24px",
                  width: "24px",
                }}
              />
            </span>
            <div className="flex-grow-1">
              <div className="d-flex justify-content-between">
                <b>URL Redirects</b>
                {hasVisualEditorFeature ? (
                  <div
                    className="btn btn-link p-0"
                    onClick={() => setUrlRedirectModal(true)}
                  >
                    Add URL Redirects
                  </div>
                ) : (
                  <PremiumTooltip commercialFeature={"redirects"}>
                    <div className="btn btn-link p-0 disabled">
                      Add URL Redirects
                    </div>
                  </PremiumTooltip>
                )}
              </div>
              <p className="mt-2 mb-1">
                Use our no-code tool to A/B test URL redirects for whole pages,
                or to test parts of a URL.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

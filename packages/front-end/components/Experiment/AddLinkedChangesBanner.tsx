import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FaDesktop, FaLink, FaRegFlag } from "react-icons/fa";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import PremiumTooltip from "../Marketing/PremiumTooltip";
import Tooltip from "../Tooltip/Tooltip";

export default function AddLinkedChangesBanner({
  experiment,
  numLinkedChanges,
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
}: {
  experiment: ExperimentInterfaceStringDates;
  numLinkedChanges: number;
  setVisualEditorModal: (state: boolean) => unknown;
  setFeatureModal: (state: boolean) => unknown;
  setUrlRedirectModal: (state: boolean) => unknown;
}) {
  const { hasCommercialFeature } = useUser();
  const hasVisualEditorFeature = hasCommercialFeature("visual-editor");

  if (experiment.status !== "draft") return null;
  if (experiment.archived) return null;
  // Already has linked changes
  if (numLinkedChanges > 0) return null;

  return (
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
            <a
              href="#"
              onClick={() => {
                setVisualEditorModal(true);
                track("Open visual editor modal", {
                  source: "visual-editor-ui",
                  action: "add",
                });
              }}
            >
              Launch Visual Editor
            </a>
          </div>
          <p className="mt-2 mb-1">
            Use our no-code browser extension to A/B test minor changes, such as
            headings or button text.
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
          <FaLink style={{ color: "#11B081", height: "24px", width: "24px" }} />
        </span>
        <div className="flex-grow-1">
          <div className="d-flex justify-content-between">
            <b>URL Redirects</b>
            <a href="#" onClick={() => setUrlRedirectModal(true)}>
              Add URL Redirects
            </a>
          </div>
          <p className="mt-2 mb-1">
            Use our no-code tool to A/B test URL redirects for whole pages, or
            to test parts of a URL.
          </p>
        </div>
      </div>
    </div>
  );
}

import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useUser } from "@front-end/services/UserContext";
import track from "@front-end/services/track";
import PremiumTooltip from "@front-end/components/Marketing/PremiumTooltip";
import Tooltip from "@front-end/components/Tooltip/Tooltip";

export default function AddLinkedChangesBanner({
  experiment,
  numLinkedChanges,
  setFeatureModal,
  setVisualEditorModal,
}: {
  experiment: ExperimentInterfaceStringDates;
  numLinkedChanges: number;
  setVisualEditorModal: (state: boolean) => unknown;
  setFeatureModal: (state: boolean) => unknown;
}) {
  const { hasCommercialFeature } = useUser();
  const hasVisualEditorFeature = hasCommercialFeature("visual-editor");

  if (experiment.status !== "draft") return null;
  if (experiment.archived) return null;
  // Already has linked changes
  if (numLinkedChanges > 0) return null;

  return (
    <div className="alert-cool-1 text-center mb-4 px-3 py-4 position-relative">
      <p className="h4 mb-4">
        Implement your experiment variations using either our Visual Editor or
        Feature Flags.{" "}
        <Tooltip
          body={
            <>
              <p>
                Use the Visual Editor to make simple visual changes to your
                website without writing code.
              </p>
              <p className="mb-0">
                Use Feature Flags and our SDKs to make changes within your
                front-end, back-end, or mobile application code.
              </p>
            </>
          }
        />
      </p>
      <div
        style={{
          margin: "0 auto",
          maxWidth: 500,
        }}
      >
        <div className="row">
          <div className="col text-align-center">
            {hasVisualEditorFeature ? (
              <button
                className="btn btn-primary btn-lg mb-3"
                type="button"
                onClick={() => {
                  setVisualEditorModal(true);
                  track("Open visual editor modal", {
                    source: "visual-editor-ui",
                    action: "add",
                  });
                }}
              >
                Open Visual Editor
              </button>
            ) : (
              <PremiumTooltip commercialFeature={"visual-editor"}>
                <div className="btn btn-primary btn-lg disabled">
                  Open Visual Editor
                </div>
              </PremiumTooltip>
            )}
          </div>
          <div className="col text-align-center">
            <button
              className="btn btn-primary btn-lg mb-3"
              type="button"
              onClick={() => {
                setFeatureModal(true);
              }}
            >
              Add Feature Flag
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

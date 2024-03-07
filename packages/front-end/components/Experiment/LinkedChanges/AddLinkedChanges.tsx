import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { CommercialFeature } from "enterprise";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { ICON_PROPERTIES, LinkedChange } from "./constants";

const LINKED_CHANGE_COPY = {
  "feature-flag": {
    header: "Feature Flag",
    cta: "Link Feature Flag",
    description:
      "Use feature flags and SDKs to make changes in your front-end, back-end or mobile application code.",
    commercialFeature: false,
  },
  "visual-editor": {
    header: "Visual Editor",
    cta: "Launch Visual Editor",
    description:
      "Use our no-code browser extension to A/B test minor changes, such as headings or button text.",
    commercialFeature: true,
  },
  redirects: {
    header: "URL Redirects",
    cta: "Add URL Redirects",
    description:
      "Use our no-code tool to A/B test URL redirects for whole pages, or to test parts of a URL.",
    commercialFeature: true,
  },
};

const AddLinkedChangeRow = ({
  type,
  setModal,
  hasVisualEditorFeature,
}: {
  type: LinkedChange;
  setModal: (boolean) => void;
  hasVisualEditorFeature: boolean;
}) => {
  const { header, cta, description, commercialFeature } = LINKED_CHANGE_COPY[
    type
  ];
  const { component: Icon, color } = ICON_PROPERTIES[type];

  return (
    <div className="d-flex">
      <span
        className="mr-3"
        style={{
          background: `${color}15`,
          borderRadius: "50%",
          height: "45px",
          width: "45px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Icon
          style={{
            color: color,
            height: "24px",
            width: "24px",
          }}
        />
      </span>
      <div className="flex-grow-1">
        <div className="d-flex justify-content-between">
          <b>{header}</b>
          {!commercialFeature || hasVisualEditorFeature ? (
            <div
              className="btn btn-link p-0"
              onClick={() => {
                setModal(true);
                track(`Open ${type} modal`, {
                  source: "add-linked-changes",
                  action: "add",
                });
              }}
            >
              {cta}
            </div>
          ) : (
            <PremiumTooltip commercialFeature={type as CommercialFeature}>
              <div className="btn btn-link p-0 disabled">{cta}</div>
            </PremiumTooltip>
          )}
        </div>
        <p className="mt-2 mb-1">{description}</p>
      </div>
    </div>
  );
};

export default function AddLinkedChanges({
  experiment,
  numLinkedChanges,
  hasLinkedFeatures,
  hasVisualChanges,
  hasLinkedRedirects,
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
}: {
  experiment: ExperimentInterfaceStringDates;
  numLinkedChanges: number;
  hasLinkedFeatures?: boolean;
  hasVisualChanges?: boolean;
  hasLinkedRedirects?: boolean;
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

  const sections = {
    "feature-flag": {
      render: !hasLinkedFeatures,
      setModal: setFeatureModal,
    },
    "visual-editor": {
      render: !hasVisualChanges,
      setModal: setVisualEditorModal,
    },
    redirects: {
      render: !hasLinkedRedirects,
      setModal: setUrlRedirectModal,
    },
  };

  const possibleSections = Object.keys(sections);

  const sectionsToRender = possibleSections.filter((s) => sections[s].render);

  return (
    <div className="appbox p-4 my-4">
      {sectionsToRender.length < possibleSections.length ? (
        <>
          <h4>Add Additional Changes</h4>
        </>
      ) : (
        <>
          <h4>Select Experiment Type</h4>
          <p>Configure options for your selected experiment type.</p>
        </>
      )}
      <hr />
      <>
        {sectionsToRender.map((s, i) => {
          return (
            <div key={s}>
              <AddLinkedChangeRow
                type={s as LinkedChange}
                setModal={sections[s].setModal}
                hasVisualEditorFeature={hasVisualEditorFeature}
              />
              {i < sectionsToRender.length - 1 && <hr />}
            </div>
          );
        })}
      </>
    </div>
  );
}

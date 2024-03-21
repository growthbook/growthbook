import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { CommercialFeature } from "enterprise";
import {
  SDKCapability,
  getConnectionsSDKCapabilities,
} from "shared/sdk-versioning";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "@/components/Experiment/LinkedChanges/AddLinkedChanges.module.scss";
import { ICON_PROPERTIES, LinkedChange } from "./constants";

const LINKED_CHANGES = {
  "feature-flag": {
    header: "Feature Flag",
    cta: "Link Feature Flag",
    description:
      "Use feature flags and SDKs to make changes in your front-end, back-end or mobile application code.",
    commercialFeature: false,
    sdkCapabilityKey: "",
  },
  "visual-editor": {
    header: "Visual Editor",
    cta: "Launch Visual Editor",
    description:
      "Use our no-code browser extension to A/B test minor changes, such as headings or button text.",
    commercialFeature: true,
    sdkCapabilityKey: "visualEditor",
  },
  redirects: {
    header: "URL Redirects",
    cta: "Add URL Redirects",
    description:
      "Use our no-code tool to A/B test URL redirects for whole pages, or to test parts of a URL.",
    commercialFeature: true,
    sdkCapabilityKey: "redirects",
  },
};

const AddLinkedChangeRow = ({
  type,
  setModal,
  hasFeature,
  experiment,
}: {
  type: LinkedChange;
  setModal: (boolean) => void;
  hasFeature: boolean;
  experiment: ExperimentInterfaceStringDates;
}) => {
  const {
    header,
    cta,
    description,
    commercialFeature,
    sdkCapabilityKey,
  } = LINKED_CHANGES[type];
  const { component: Icon, color } = ICON_PROPERTIES[type];
  const { data: sdkConnectionsData } = useSDKConnections();

  const hasSDKWithFeature =
    type === "feature-flag" ||
    getConnectionsSDKCapabilities({
      connections: sdkConnectionsData?.connections ?? [],
      project: experiment.project ?? "",
    }).includes(sdkCapabilityKey as SDKCapability);

  const isCTAClickable =
    (!commercialFeature || hasFeature) && hasSDKWithFeature;

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
          <b
            className={isCTAClickable ? styles.sectionHeader : undefined}
            onClick={() => {
              if (isCTAClickable) {
                setModal(true);
                track(`Open ${type} modal`, {
                  source: "add-linked-changes",
                  action: "add",
                });
              }
            }}
          >
            {header}
          </b>
          {isCTAClickable ? (
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
          ) : commercialFeature && !hasFeature ? (
            <PremiumTooltip commercialFeature={type as CommercialFeature}>
              <div className="btn btn-link p-0 disabled">{cta}</div>
            </PremiumTooltip>
          ) : (
            <Tooltip
              body={`The SDKs in this project don't support ${header}. Upgrade your SDK(s) or add a supported SDK.`}
              tipPosition="top"
            >
              <div className="btn btn-link disabled p-0">{cta}</div>
            </Tooltip>
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
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
}: {
  experiment: ExperimentInterfaceStringDates;
  numLinkedChanges: number;
  hasLinkedFeatures?: boolean;
  setVisualEditorModal: (state: boolean) => unknown;
  setFeatureModal: (state: boolean) => unknown;
  setUrlRedirectModal: (state: boolean) => unknown;
}) {
  const { hasCommercialFeature } = useUser();

  const hasVisualEditorFeature = hasCommercialFeature("visual-editor");
  const hasURLRedirectsFeature = hasCommercialFeature("redirects");

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
      render: !experiment.hasVisualChangesets,
      setModal: setVisualEditorModal,
    },
    redirects: {
      render: !experiment.hasURLRedirects,
      setModal: setUrlRedirectModal,
    },
  };

  const possibleSections = Object.keys(sections);

  const sectionsToRender = possibleSections.filter((s) => sections[s].render);

  return (
    <div className="appbox p-4 my-4">
      {sectionsToRender.length < possibleSections.length ? (
        <>
          <h4>Add Implementation</h4>
        </>
      ) : (
        <>
          <h4>Select an Implementation</h4>
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
                hasFeature={
                  s === "visual-editor"
                    ? hasVisualEditorFeature
                    : s === "redirects"
                    ? hasURLRedirectsFeature
                    : true
                }
                experiment={experiment}
              />
              {i < sectionsToRender.length - 1 && <hr />}
            </div>
          );
        })}
      </>
    </div>
  );
}

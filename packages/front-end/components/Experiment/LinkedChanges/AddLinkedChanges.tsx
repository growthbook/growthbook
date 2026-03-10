import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { CommercialFeature } from "shared/enterprise";
import {
  SDKCapability,
  getConnectionsSDKCapabilities,
} from "shared/sdk-versioning";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "@/components/Experiment/LinkedChanges/AddLinkedChanges.module.scss";
import { useUser } from "@/services/UserContext";
import { ICON_PROPERTIES, LinkedChange } from "./constants";

const LINKED_CHANGES: Record<
  LinkedChange,
  {
    header: string;
    cta: string;
    description: string;
    commercialFeature: CommercialFeature | "";
    sdkCapabilityKey: SDKCapability | "";
  }
> = {
  "feature-flag": {
    header: "Feature Flag",
    cta: "Link Feature Flag",
    description:
      "Use feature flags and SDKs to make changes in your front-end, back-end or mobile application code.",
    commercialFeature: "",
    sdkCapabilityKey: "",
  },
  "visual-editor": {
    header: "Visual Editor",
    cta: "Launch Visual Editor",
    description:
      "Use our no-code browser extension to A/B test minor changes, such as headings or button text.",
    commercialFeature: "visual-editor",
    sdkCapabilityKey: "visualEditor",
  },
  redirects: {
    header: "URL Redirects",
    cta: "Add URL Redirect",
    description:
      "Use our no-code tool to A/B test URL redirects for whole pages, or to test parts of a URL.",
    commercialFeature: "redirects",
    sdkCapabilityKey: "redirects",
  },
};

const AddLinkedChangeRow = ({
  type,
  setModal,
  experiment,
}: {
  type: LinkedChange;
  setModal: (boolean) => void;
  experiment: ExperimentInterfaceStringDates;
}) => {
  const { header, cta, description, commercialFeature, sdkCapabilityKey } =
    LINKED_CHANGES[type];
  const { component: Icon, color } = ICON_PROPERTIES[type];
  const { data: sdkConnectionsData } = useSDKConnections();

  const { hasCommercialFeature } = useUser();
  const hasFeature = commercialFeature
    ? hasCommercialFeature(commercialFeature)
    : true;

  const hasSDKWithFeature =
    type === "feature-flag" ||
    getConnectionsSDKCapabilities({
      connections: sdkConnectionsData?.connections ?? [],
      project: experiment.project ?? "",
    }).includes(sdkCapabilityKey as SDKCapability);

  const isCTAClickable = hasSDKWithFeature;

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
              }
            }}
          >
            {header}
          </b>
          {isCTAClickable ? (
            commercialFeature && !hasFeature ? (
              <PremiumTooltip
                commercialFeature={commercialFeature}
                body={
                  "You can add this to your draft, but you will not be able to start the experiment until upgrading."
                }
                usePortal={true}
              >
                <div
                  className="btn btn-link link-purple p-0"
                  onClick={() => {
                    setModal(true);
                  }}
                >
                  {cta}
                </div>
              </PremiumTooltip>
            ) : (
              <div
                className="btn btn-link link-purple p-0"
                onClick={() => {
                  setModal(true);
                }}
              >
                {cta}
              </div>
            )
          ) : (
            <div>
              <Tooltip
                body={`The SDKs in this project don't support ${header}. Upgrade your SDK(s) or add a supported SDK.`}
                tipPosition="top"
              >
                <div className="btn btn-link disabled p-0">{cta}</div>
              </Tooltip>
            </div>
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
  if (!sectionsToRender.length) return null;

  return (
    <div className="appbox px-4 py-3 my-4">
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

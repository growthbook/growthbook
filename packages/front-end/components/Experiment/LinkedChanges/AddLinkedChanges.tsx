import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { CommercialFeature } from "enterprise";
import {
  SDKCapability,
  getConnectionsSDKCapabilities,
} from "shared/sdk-versioning";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "@/components/Experiment/LinkedChanges/AddLinkedChanges.module.scss";
import { ICON_PROPERTIES, LinkedChange } from "./constants";

const LINKED_CHANGES = {
  "feature-flag": {
    header: "特性标记",
    cta: "关联特性标记",
    description: "使用特性标记和软件开发工具包（SDK）在前端、后端或移动应用代码中进行变更。",
    commercialFeature: false,
    sdkCapabilityKey: "",
  },
  "visual-editor": {
    header: "可视化编辑器",
    cta: "启动可视化编辑器",
    description: "使用我们的无代码浏览器扩展来进行A/B测试小的变更，比如标题或按钮文本。",
    commercialFeature: true,
    sdkCapabilityKey: "visualEditor",
  },
  redirects: {
    header: "URL重定向",
    cta: "添加URL重定向",
    description: "使用我们的无代码工具对整个页面的URL进行A/B测试，或者测试URL的部分内容。",
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
              }
            }}
          >
            {header}
          </b>
          {isCTAClickable ? (
            <div
              className="btn btn-link link-purple p-0"
              onClick={() => {
                setModal(true);
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
              body={`该项目中的SDK不支持${header}。请升级您的SDK或添加一个支持的SDK。`}
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
    <div className="appbox px-4 py-3 my-4">
      {sectionsToRender.length < possibleSections.length ? (
        <>
          <h4>添加实现</h4>
        </>
      ) : (
        <>
          <h4>选择一种实现</h4>
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

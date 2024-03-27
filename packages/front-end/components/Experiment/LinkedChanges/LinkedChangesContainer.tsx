import { FaPlusCircle } from "react-icons/fa";
import { ExperimentStatus } from "back-end/types/experiment";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import {
  ICON_PROPERTIES,
  LINKED_CHANGE_CONTAINER_PROPERTIES,
  LinkedChange,
} from "./constants";

export interface Props {
  type: LinkedChange;
  canAddChanges: boolean;
  children: JSX.Element;
  changeCount: number;
  experimentStatus: ExperimentStatus;
  onAddChange: () => void;
}

export default function LinkedChangesContainer({
  type,
  canAddChanges,
  children,
  changeCount,
  experimentStatus,
  onAddChange,
}: Props) {
  const { hasCommercialFeature } = useUser();
  const hasVisualEditorFeature = hasCommercialFeature("visual-editor");
  const hasFeature = type === "feature-flag" || hasVisualEditorFeature;

  // Don't display linked changes section if none have been added and experiment is no longer a draft
  if ((experimentStatus !== "draft" && changeCount === 0) || changeCount === 0)
    return null;

  const { component: Icon, color } = ICON_PROPERTIES[type];
  const { header, addButtonCopy } = LINKED_CHANGE_CONTAINER_PROPERTIES[type];

  return (
    <div className="appbox p-3 mb-4">
      <div className="d-flex mb-2 align-items-center">
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
              color: `${color}`,
              height: "24px",
              width: "24px",
            }}
          />
        </span>
        <div className="flex-grow-1">
          <div className="d-flex justify-content-between">
            <div className="h4 mb-0 align-self-center">
              {header}{" "}
              {!!changeCount && (
                <small className="text-muted">({changeCount})</small>
              )}
            </div>
            {canAddChanges ? (
              <div>
                {hasFeature ? (
                  <button
                    className="btn btn-link align-self-center"
                    onClick={() => onAddChange()}
                  >
                    <FaPlusCircle className="mr-1" />
                    {addButtonCopy}
                  </button>
                ) : (
                  <PremiumTooltip commercialFeature={type}>
                    <div className="btn btn-link disabled">
                      <FaPlusCircle className="mr-1" />
                      {addButtonCopy}
                    </div>
                  </PremiumTooltip>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

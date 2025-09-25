import { FaPlusCircle } from "react-icons/fa";
import { ExperimentStatus } from "back-end/types/experiment";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Button from "@/ui/Button";
import {
  ICON_PROPERTIES,
  LINKED_CHANGE_CONTAINER_PROPERTIES,
  LinkedChange,
} from "./constants";

export interface Props {
  type: LinkedChange;
  canAddChanges: boolean;
  children: JSX.Element | null;
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
    <div className="appbox px-4 py-3 mb-4">
      <div className={`d-flex mb-${children ? "3" : "0"} align-items-center`}>
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
                <span className="font-weight-normal">({changeCount})</span>
              )}
            </div>
            {canAddChanges ? (
              <div>
                {hasFeature ? (
                  <Button variant="ghost" onClick={() => onAddChange()}>
                    <FaPlusCircle
                      className="mr-2"
                      style={{ position: "relative", top: "-2px" }}
                    />
                    {addButtonCopy}
                  </Button>
                ) : (
                  <PremiumTooltip
                    commercialFeature={type}
                    body="You can add this to your draft, but you will not be able to start the experiment until upgrading."
                  >
                    <Button variant="ghost" onClick={() => onAddChange()}>
                      <FaPlusCircle
                        className="mr-2"
                        style={{ position: "relative", top: "-2px" }}
                      />
                      {addButtonCopy}
                    </Button>
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

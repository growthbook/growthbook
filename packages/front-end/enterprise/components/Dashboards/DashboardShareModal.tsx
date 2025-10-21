import React, { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiCheck, PiLink } from "react-icons/pi";
import {
  DashboardEditLevel,
  DashboardShareLevel,
} from "back-end/src/enterprise/validators/dashboard";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import Button from "@/ui/Button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import HelperText from "@/ui/HelperText";

interface DashboardShareModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Function to close the modal */
  onClose: () => void;
  /** Function to submit the form data */
  onSubmit: (data: {
    shareLevel: DashboardShareLevel;
    editLevel: DashboardEditLevel;
  }) => void;
  /** Initial values for the form */
  initialValues?: {
    shareLevel: DashboardShareLevel;
    editLevel: DashboardEditLevel;
  };
  /** Whether this is for a general dashboard (affects available options) */
  isGeneralDashboard?: boolean;
  /** Dashboard ID for generating share link */
  dashboardId?: string;
}

/**
 * Shared modal component for updating dashboard share and edit levels.
 * Can be used in dashboard index tables and dashboard editors.
 */
export default function DashboardShareModal({
  isOpen,
  onClose,
  onSubmit,
  initialValues,
  isGeneralDashboard = true,
  dashboardId,
}: DashboardShareModalProps) {
  const { hasCommercialFeature } = useUser();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [shareLevel, setShareLevel] = useState<DashboardShareLevel>(
    initialValues?.shareLevel || "private",
  );
  const [editLevel, setEditLevel] = useState<DashboardEditLevel>(
    initialValues?.editLevel || "private",
  );
  const [saveShareLevelStatus, setSaveShareLevelStatus] = useState<
    null | "loading" | "success" | "fail"
  >(null);
  const [saveEditLevelStatus, setSaveEditLevelStatus] = useState<
    null | "loading" | "success" | "fail"
  >(null);
  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 1500,
  });

  // Reset local state when modal opens or when initialValues change
  useEffect(() => {
    if (initialValues) {
      setShareLevel(initialValues.shareLevel);
      setEditLevel(initialValues.editLevel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues?.shareLevel, initialValues?.editLevel]);

  // Watch for changes and automatically call onSubmit (like ExperimentHeader)
  useEffect(() => {
    if (initialValues && isOpen) {
      const shareLevelChanged = initialValues.shareLevel !== shareLevel;
      const editLevelChanged = initialValues.editLevel !== editLevel;

      if (shareLevelChanged || editLevelChanged) {
        const newShareLevel = shareLevelChanged
          ? shareLevel
          : initialValues.shareLevel;
        const newEditLevel = editLevelChanged
          ? editLevel
          : initialValues.editLevel;

        // Set loading state
        if (shareLevelChanged) {
          setSaveShareLevelStatus("loading");
        }
        if (editLevelChanged) {
          setSaveEditLevelStatus("loading");
        }

        // Call onSubmit and handle the result
        try {
          onSubmit({
            shareLevel: newShareLevel,
            editLevel: newEditLevel,
          });

          // Set success state after a short delay
          setTimeout(() => {
            if (shareLevelChanged) {
              setSaveShareLevelStatus("success");
              setTimeout(() => setSaveShareLevelStatus(null), 3000);
            }
            if (editLevelChanged) {
              setSaveEditLevelStatus("success");
              setTimeout(() => setSaveEditLevelStatus(null), 3000);
            }
          }, 100);
        } catch (error) {
          // Set fail state
          if (shareLevelChanged) {
            setSaveShareLevelStatus("fail");
            setTimeout(() => setSaveShareLevelStatus(null), 3000);
          }
          if (editLevelChanged) {
            setSaveEditLevelStatus("fail");
            setTimeout(() => setSaveEditLevelStatus(null), 3000);
          }
        }
      }
    }
  }, [shareLevel, editLevel, initialValues, isOpen, onSubmit]);

  const handleFieldChange = (
    field: "shareLevel" | "editLevel",
    value: string,
  ) => {
    if (field === "shareLevel") {
      setShareLevel(value as DashboardShareLevel);
      // If share level is being set to private, also set edit level to private
      if (value === "private") {
        setEditLevel("private");
      }
    } else {
      setEditLevel(value as DashboardEditLevel);
    }
  };

  const shareLinkButton = copySuccess ? (
    <Button style={{ width: 130 }} icon={<PiCheck />}>
      Link copied
    </Button>
  ) : (
    <Button
      disabled={shareLevel === "private"}
      onClick={() => {
        if (dashboardId) {
          const url = window.location.href.replace(
            /[?#].*/,
            `#dashboards/${dashboardId}`,
          );
          performCopy(url);
        }
      }}
      style={{
        width: 130,
      }}
      icon={<PiLink />}
    >
      Copy Link
    </Button>
  );

  if (!isOpen) return null;

  return (
    <>
      {showUpgradeModal && (
        <UpgradeModal
          close={() => setShowUpgradeModal(false)}
          source="product-analytics-dashboard-share"
          commercialFeature="share-product-analytics-dashboards"
        />
      )}
      <Modal
        open={isOpen}
        size="md"
        trackingEventModalType="product-analytics-dashboard-share"
        header="Update Dashboard Access Settings"
        close={onClose}
        closeCta="Close"
        useRadixButton={true}
        secondaryCTA={shareLinkButton}
      >
        <Flex direction="column" gap="1">
          {!hasCommercialFeature("share-product-analytics-dashboards") ? (
            <UpgradeMessage
              isEnterprise={true}
              showUpgradeModal={() => setShowUpgradeModal(true)}
              commercialFeature="share-product-analytics-dashboards"
              upgradeMessage="share product dashboards with other members of your organization. You can also control who can edit the dashboard."
            />
          ) : (
            <>
              <div className="mb-1">
                {shareLevel === "private" ? (
                  <Callout status="info" size="sm">
                    Currently only you can view or edit this dashboard.
                  </Callout>
                ) : (
                  <Callout status="warning" size="sm">
                    {`This report is discoverable within your organization. ${editLevel === "private" ? "Only you can edit it." : "Anybody in your organization with permissions can edit it."}`}
                  </Callout>
                )}
              </div>
              <div>
                {isGeneralDashboard && (
                  <SelectField
                    label="View access"
                    options={[
                      { label: "Organization members", value: "published" },
                      { label: "Only me", value: "private" },
                      // { label: "Anyone with the link", value: "public" }, //TODO: Need to build this logic
                    ]}
                    value={shareLevel}
                    onChange={(value) => handleFieldChange("shareLevel", value)}
                  />
                )}
                <div className="mb-1" style={{ height: 24 }}>
                  {saveShareLevelStatus === "loading" ? (
                    <div className="position-relative" style={{ top: -6 }}>
                      <LoadingSpinner />
                    </div>
                  ) : saveShareLevelStatus === "success" ? (
                    <HelperText status="success" size="sm">
                      Sharing status has been updated
                    </HelperText>
                  ) : saveShareLevelStatus === "fail" ? (
                    <HelperText status="error" size="sm">
                      Unable to update sharing status
                    </HelperText>
                  ) : null}
                </div>
              </div>
              <div>
                <SelectField
                  label="Edit access"
                  disabled={shareLevel === "private"}
                  options={[
                    {
                      label: "Any organization members with editing permission",
                      value: "published",
                    },
                    { label: "Only me", value: "private" },
                  ]}
                  value={editLevel}
                  onChange={(value) => handleFieldChange("editLevel", value)}
                />
                <div className="mb-1" style={{ height: 24 }}>
                  {saveEditLevelStatus === "loading" ? (
                    <div className="position-relative" style={{ top: -6 }}>
                      <LoadingSpinner />
                    </div>
                  ) : saveEditLevelStatus === "success" ? (
                    <HelperText status="success" size="sm">
                      Edit access has been updated
                    </HelperText>
                  ) : saveEditLevelStatus === "fail" ? (
                    <HelperText status="error" size="sm">
                      Unable to update edit access
                    </HelperText>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </Flex>
      </Modal>
    </>
  );
}

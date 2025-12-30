import React, { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiCheck, PiLink } from "react-icons/pi";
import { DashboardEditLevel, DashboardShareLevel } from "shared/enterprise";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";
import Button from "@/ui/Button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import HelperText from "@/ui/HelperText";
import PremiumCallout from "@/ui/PremiumCallout";

interface DashboardShareModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Function to close the modal */
  onClose: () => void;
  /** Function to submit the form data */
  onSubmit: (data: {
    shareLevel: DashboardShareLevel;
    editLevel: DashboardEditLevel;
  }) => Promise<void>;
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
        const handleSubmit = async () => {
          try {
            await onSubmit({
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
        };

        handleSubmit();
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
      <Modal
        open={isOpen}
        size="lg"
        trackingEventModalType="product-analytics-dashboard-share"
        header={null}
        showHeaderCloseButton={false}
        close={onClose}
        closeCta="Close"
        useRadixButton={true}
        secondaryCTA={shareLinkButton}
      >
        <Flex direction="column" gap="1">
          <h2>Update Dashboard Access Settings</h2>
          <p className="mb-3">
            Share product analytics dashboards with other members of your
            organization, and control edit access.
          </p>
          {!hasCommercialFeature("share-product-analytics-dashboards") ? (
            <PremiumCallout
              commercialFeature="share-product-analytics-dashboards"
              id="dashboard-share-modal"
            >
              Creating shared dashboards requires an Enterprise plan, reach out
              to try a free Enterprise Trial.
            </PremiumCallout>
          ) : shareLevel === "private" ? (
            <Callout status="info" size="sm">
              Currently only you can view or edit this dashboard.
            </Callout>
          ) : (
            <Callout status="warning" size="sm">
              {`This report is discoverable within your organization. ${editLevel === "private" ? "Only you can edit it." : "Anybody in your organization with permissions can edit it."}`}
            </Callout>
          )}
          <div className="mt-3">
            <div>
              {isGeneralDashboard && (
                <SelectField
                  label="View access"
                  disabled={
                    !hasCommercialFeature("share-product-analytics-dashboards")
                  }
                  options={[
                    { label: "Organization members", value: "published" },
                    { label: "Only me", value: "private" },
                    // { label: "Anyone with the link", value: "public" }, // We'll add this when we build the public dashboard feature
                  ]}
                  value={shareLevel}
                  onChange={(value) => handleFieldChange("shareLevel", value)}
                  helpText={
                    <>
                      {saveShareLevelStatus === "loading" ? (
                        <div
                          className="position-relative pt-1"
                          style={{ top: -6 }}
                        >
                          <LoadingSpinner />
                        </div>
                      ) : saveShareLevelStatus === "success" ? (
                        <HelperText status="success" size="sm" mt="2">
                          Sharing status has been updated
                        </HelperText>
                      ) : saveShareLevelStatus === "fail" ? (
                        <HelperText status="error" size="sm" mt="2">
                          Unable to update sharing status
                        </HelperText>
                      ) : null}
                    </>
                  }
                />
              )}
            </div>
            <div>
              <SelectField
                label="Edit access"
                disabled={
                  shareLevel === "private" ||
                  !hasCommercialFeature("share-product-analytics-dashboards")
                }
                options={[
                  {
                    label: "Any organization members with editing permission",
                    value: "published",
                  },
                  { label: "Only me", value: "private" },
                ]}
                value={editLevel}
                onChange={(value) => handleFieldChange("editLevel", value)}
                helpText={
                  <>
                    {saveEditLevelStatus === "loading" ? (
                      <div
                        className="position-relative pt-1"
                        style={{ top: -6 }}
                      >
                        <LoadingSpinner />
                      </div>
                    ) : saveEditLevelStatus === "success" ? (
                      <HelperText status="success" size="sm" mt="2">
                        Edit access has been updated
                      </HelperText>
                    ) : saveEditLevelStatus === "fail" ? (
                      <HelperText status="error" size="sm" mt="2">
                        Unable to update edit access
                      </HelperText>
                    ) : null}
                  </>
                }
              />
            </div>
          </div>
        </Flex>
      </Modal>
    </>
  );
}

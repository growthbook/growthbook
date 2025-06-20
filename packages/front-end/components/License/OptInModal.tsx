import React, { useCallback, useState } from "react";
import { Box, Text } from "@radix-ui/themes";
import { AgreementType } from "back-end/src/validators/agreements";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";

// hard coded agreements for now:
const agreements = {
  ai: {
    title: "Enable AI features?",
    subtitle: "Please read and agree to the terms before proceeding.",
    terms: (
      <>
        GrowthBook supports the use of AI / LLMs to enhance your experience and
        provide advanced functionality. By agreeing, you consent to the use of
        AI features in accordance with our privacy policy and OpenAI&apos;s{" "}
        <a
          href="https://openai.com/enterprise-privacy/"
          target="_blank"
          rel="noreferrer"
        >
          privacy policy
        </a>
        . When you use AI features in GrowthBook, some data related to the
        functionality will be sent to OpenAI in order to provide the feature.
        This may include summary experiment results, metric SQL, and similar
        data as required. This data is only used to provide the AI features. You
        can disable these features at any time in your account settings.
      </>
    ),
    noPermission: (
      <>
        You must be an administrator to enable this feature. Please contact your
        administrator.
      </>
    ),
    version: "2025-06-19",
  },
};

type Props = {
  agreement: AgreementType;
  onConfirm?: () => void;
  onClose?: () => void;
};

const OptInModal = ({
  agreement,
  onConfirm,
  onClose,
}: Props): React.ReactElement => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const isAdmin = permissionsUtil.canManageOrgSettings();
  const { title, subtitle, terms, noPermission, version } =
    agreements[agreement] || {};
  const logAgree = useCallback(async () => {
    setLoading(true);
    // send API call to log the agreement
    const res = await apiCall<{ status: number; message?: string }>(
      `/agreements/agree/`,
      {
        method: "POST",
        body: JSON.stringify({
          agreement,
          version,
        }),
      }
    );
    setLoading(false);
    if (!res || res.status !== 200) {
      // handle error
      setError("Failed to log your agreement");
    } else {
      // they agreed to the terms... if this is the AI agreement, we need to update the user settings
      if (agreement === "ai") {
        // update the user settings to reflect the agreement
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({
            settings: { aiEnabled: true },
          }),
        });
      }
      await refreshOrganization();
      if (onConfirm) onConfirm();
      if (onClose) onClose();
    }
  }, [agreement, apiCall, onClose, onConfirm, refreshOrganization, version]);

  if (!agreements[agreement]) {
    return <></>;
  }

  return (
    <>
      <Modal
        trackingEventModalType="modal-opt-in"
        open={true}
        submit={logAgree}
        close={() => {
          if (onClose) onClose();
        }}
        size="lg"
        header={title}
        cta="I Agree"
        ctaEnabled={isAdmin}
        loading={loading}
        error={error}
        closeCta={isAdmin ? `No thanks` : `Close`}
      >
        <>
          {isAdmin ? (
            <>
              {subtitle !== "" && (
                <Box mb="3">
                  <Text size="2" weight="medium">
                    {subtitle}
                  </Text>
                </Box>
              )}
              <Box mb="3">{terms}</Box>
            </>
          ) : (
            <Box mb="3">{noPermission}</Box>
          )}
        </>
      </Modal>
    </>
  );
};
export default OptInModal;

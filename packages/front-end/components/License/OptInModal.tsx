import React, { useCallback, useState } from "react";
import { Box } from "@radix-ui/themes";
import { AgreementType } from "shared/validators";
import { PiCaretRight } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";

// hard coded agreements for now:
const agreements: Record<
  AgreementType,
  {
    title: string;
    subtitle: string;
    terms: React.ReactNode;
    noPermissionTitle?: string;
    noPermission: React.ReactNode;
    consentText: string;
    version: string;
  }
> = {
  ai: {
    title: "Enable AI for the Entire Organization",
    subtitle: "Please read and agree to the terms before proceeding.",
    terms: (
      <>
        This feature involves artificial intelligence technologies, which may
        include, but are not limited to, sharing information with trusted
        third-party providers, automated recommendations, content generation, or
        data analysis.
        <Box mt="2">
          For more information about how your data is used, please see our{" "}
          <a
            href="https://docs.growthbook.io/integrations/ai"
            target="_blank"
            rel="noreferrer"
          >
            AI docs
          </a>
          , review our{" "}
          <a
            href="https://www.growthbook.io/legal/privacy-policy/06-19-2025"
            target="_blank"
            rel="noreferrer"
          >
            privacy notice
          </a>{" "}
          and OpenAI&apos;s{" "}
          <a
            href="https://openai.com/enterprise-privacy/"
            target="_blank"
            rel="noreferrer"
          >
            privacy policy
          </a>
          . You can disable these features at any time in your account settings.
        </Box>
      </>
    ),
    consentText: "I consent to the use of artificial intelligence",
    noPermissionTitle: "AI is Not Enabled for this Organization",
    noPermission: (
      <>
        You must be an administrator to enable this feature. Please contact your
        administrator.
      </>
    ),
    version: "2025-06-19",
  },
  "managed-warehouse": {
    title: "Enable AI features?",
    subtitle: "Please read and agree to the terms before proceeding.",
    terms: (
      <>
        This feature stores data in a managed warehouse on your behalf. By
        enabling this feature you are agreeing to the terms of service of
        GrowthBook and Clickhouse, and allowing us to store your event data
        passed to us.
        <a
          href="https://www.growthbook.io/legal/privacy-policy/06-19-2025"
          target="_blank"
          rel="noreferrer"
        >
          Privacy Notice
        </a>{" "}
        and Clickhouse&apos;s{" "}
        <a
          href="https://clickhouse.com/legal/privacy-policy"
          target="_blank"
          rel="noreferrer"
        >
          Privacy Policy
        </a>
        .
      </>
    ),
    consentText: "I consent to the use of the managed warehouse.",
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
  const [checked, setChecked] = useState(false);
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const isAdmin = permissionsUtil.canManageOrgSettings();
  const {
    title,
    subtitle,
    terms,
    noPermissionTitle,
    noPermission,
    version,
    consentText,
  } = agreements[agreement] || {};
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
      },
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
        submit={isAdmin ? logAgree : undefined}
        close={() => {
          if (onClose) onClose();
        }}
        size="lg"
        header={null}
        showHeaderCloseButton={false}
        cta={
          <>
            I Agree <PiCaretRight size={16} />
          </>
        }
        ctaEnabled={isAdmin && checked}
        loading={loading}
        error={error}
        closeCta={isAdmin ? `No thanks` : `Close`}
        useRadixButton={true}
      >
        <>
          <Text size="large" weight="semibold" color="text-high">
            {isAdmin ? title : noPermissionTitle}
          </Text>
          {isAdmin ? (
            <Box
              style={{
                fontSize: "var(--font-size-3)",
                color: "var(--color-text-high)",
              }}
            >
              {subtitle !== "" && (
                <Box mb="3">
                  <Text size="large" weight="regular" color="text-mid">
                    {subtitle}
                  </Text>
                </Box>
              )}
              <Box mt="5" mb="3">
                {terms}
              </Box>
              <Checkbox
                mt="2"
                size="md"
                label="I agree"
                labelSize="3"
                value={checked}
                setValue={(v) => {
                  setChecked(v);
                }}
              />
              <Box ml="5">{consentText}</Box>
            </Box>
          ) : (
            <Box mb="3" mt="5">
              <Text size="large" color="text-high">
                {noPermission}
              </Text>
            </Box>
          )}
        </>
      </Modal>
    </>
  );
};
export default OptInModal;

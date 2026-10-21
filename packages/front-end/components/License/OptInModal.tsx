import React, { useCallback, useState } from "react";
import { Box, Text } from "@radix-ui/themes";
import { AgreementType } from "shared/validators";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useUser } from "@/services/UserContext";
import Checkbox from "@/ui/Checkbox";

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
    if (!res || res.status !== 200) {
      throw new Error("Failed to log your agreement");
    }
    // they agreed to the terms... if this is the AI agreement, we need to update the user settings
    if (agreement === "ai") {
      await apiCall(`/organization`, {
        method: "PUT",
        body: JSON.stringify({
          settings: { aiEnabled: true },
        }),
      });
    }
    await refreshOrganization();
    onConfirm?.();
  }, [agreement, apiCall, onConfirm, refreshOrganization, version]);

  if (!agreements[agreement]) {
    return <></>;
  }

  // A Radix dialog, so it stacks over another one it's opened from.
  return (
    <ModalStandard
      trackingEventModalType="modal-opt-in"
      open={true}
      header={(isAdmin ? title : noPermissionTitle) ?? title}
      submit={isAdmin ? logAgree : undefined}
      close={() => onClose?.()}
      size="lg"
      cta="I agree"
      ctaEnabled={isAdmin && checked}
      closeCta={isAdmin ? "No thanks" : "Close"}
    >
      {isAdmin ? (
        <Box
          style={{
            fontSize: "var(--font-size-3)",
            color: "var(--color-text-high)",
          }}
        >
          {subtitle !== "" && (
            <Box mb="3">
              <Text
                size="3"
                weight="regular"
                style={{ color: "var(--color-text-mid)" }}
              >
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
            labelSize="lg"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
          />
          <Box ml="5">{consentText}</Box>
        </Box>
      ) : (
        <Box mb="3" mt="5">
          <Text size="3" style={{ color: "var(--color-text-high)" }}>
            {noPermission}
          </Text>
        </Box>
      )}
    </ModalStandard>
  );
};
export default OptInModal;

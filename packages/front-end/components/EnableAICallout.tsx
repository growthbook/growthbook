import React, { useState } from "react";
import { BsStars } from "react-icons/bs";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { useAISettings } from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import OptInModal from "@/components/License/OptInModal";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import track from "@/services/track";
import { Status } from "@/ui/HelperText";

type Props = {
  size?: "sm" | "md";
  // Optional label describing where the callout is shown, used for tracking.
  source?: string;
} & MarginProps;

// Renders a callout whenever AI can't be used for the organization, explaining
// why and (where possible) offering an inline way to fix it:
//   - plan doesn't include AI     -> message only
//   - AI not enabled for the org  -> "Enable AI" CTA for admins, else ask an admin
//   - no provider API key set     -> link to the settings page for details
// Renders nothing when AI is fully usable.
export default function EnableAICallout({
  size,
  source,
  ...marginProps
}: Props) {
  const { aiEnabled, aiAgreedTo } = useAISettings();
  const permissionsUtil = usePermissionsUtil();
  const canManageOrgSettings = permissionsUtil.canManageOrgSettings();
  const { apiCall } = useAuth();
  const { refreshOrganization, settings, hasCommercialFeature } = useUser();
  const [showOptIn, setShowOptIn] = useState(false);

  const hasAISuggestions = hasCommercialFeature("ai-suggestions");
  // Whether the org setting is on (mirroring the settings-page checkbox:
  // `aiEnabled && aiAgreedTo`). `useAISettings().aiEnabled` additionally
  // requires a configured provider API key on self-hosted, so the two differ
  // when the setting is on but no key is set.
  const aiSettingEnabled = !!settings?.aiEnabled && aiAgreedTo;

  // Fully usable — nothing to show.
  if (hasAISuggestions && aiEnabled) return null;

  const enableAI = async () => {
    track("Enable AI Callout Clicked", { source });
    // The AI opt-in agreement must be accepted before AI can be enabled. If
    // the org hasn't agreed yet (cloud only), show the modal (which agrees and
    // flips the org setting). Otherwise just update the org setting directly.
    if (!aiAgreedTo) {
      setShowOptIn(true);
      return;
    }
    await apiCall("/organization", {
      method: "PUT",
      body: JSON.stringify({ settings: { aiEnabled: true } }),
    });
    await refreshOrganization();
  };

  let status: Status;
  let message: string;
  let action: React.ReactNode = undefined;

  if (!hasAISuggestions) {
    // Plan doesn't include AI — nothing the user can toggle to fix it.
    status = "info";
    message = "Your current plan does not include AI features.";
  } else if (!aiSettingEnabled) {
    // AI is available on the plan but turned off for the org.
    status = "wizard";
    if (canManageOrgSettings) {
      message =
        "You must first enable AI for your organization to use this feature.";
      action = (
        <Button color="inherit" onClick={enableAI}>
          Enable AI
        </Button>
      );
    } else {
      message =
        "AI features are disabled for your organization. Ask an admin to enable it.";
    }
  } else {
    // Enabled for the org but not usable — self-hosted with no provider API
    // key configured. That's an env var the settings page explains.
    status = "warning";
    message =
      "You must configure provider API keys in order to use AI features.";
    action = (
      <LinkButton href="/settings/#ai" color="inherit">
        View settings
      </LinkButton>
    );
  }

  return (
    <>
      {showOptIn && (
        <OptInModal agreement="ai" onClose={() => setShowOptIn(false)} />
      )}
      <Callout
        status={status}
        size={size}
        icon={<BsStars />}
        action={action}
        {...marginProps}
      >
        {message}
      </Callout>
    </>
  );
}

import React, { useState } from "react";
import { Code, Text } from "@radix-ui/themes";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import Callout from "../../components/Radix/Callout";
import { isCloud } from "../../services/env";
import { useUser } from "../../services/UserContext";
import UpgradeModal from "../Settings/UpgradeModal";

export function UsageCallout() {
  const [upgradeModal, setUpgradeModal] = useState(false);
  const { maxMeter } = useStripeSubscription();
  const permissionsUtil = usePermissionsUtil();
  const { accountPlan } = useUser();
  const canManageBilling = permissionsUtil.canManageBilling();
  const planName = accountPlan || "starter";

  // Initially, we only want to display this to free cloud orgs with metered usage
  if (maxMeter === null || !isCloud() || planName !== "starter") return null;

  // Don't display message if usage is below 80%
  if (maxMeter.percentUsed < 0.8) return null;

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason=""
          source="layout"
        />
      )}
      <Callout
        status={maxMeter.percentUsed >= 0.9 ? "error" : "warning"}
        mb="3"
      >
        Your organization has used{" "}
        <strong>{maxMeter.percentUsed * 100}%</strong> of this month&apos;s
        available CDN <Code>{maxMeter.meter}</Code>.{" "}
        {planName === "starter" && canManageBilling ? (
          <Text as="span">
            Upgrade to Pro to increase your organization&apos;s usage limits.
          </Text>
        ) : null}
      </Callout>
    </>
  );
}

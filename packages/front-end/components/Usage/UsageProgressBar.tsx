import { Flex, Progress, Text, Code } from "@radix-ui/themes";
import React from "react";
import Link from "next/link";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import usePermissionsUtil from "../../hooks/usePermissionsUtils";
import { useUser } from "../../services/UserContext";
import { isCloud } from "../../services/env";
import Tooltip from "../../components/Tooltip/Tooltip";

export default function UsageProgressBar() {
  const { maxMeter } = useStripeSubscription();
  const permissionsUtil = usePermissionsUtil();
  const { accountPlan } = useUser();
  const canManageBilling = permissionsUtil.canManageBilling();
  const planName = accountPlan || "starter";
  let statusColor: "cyan" | "yellow" | "red" = "cyan";

  // Only show for cloud orgs with metered usage
  if (maxMeter === null || !isCloud()) return null;

  if (maxMeter.percentUsed >= 0.8 && maxMeter.percentUsed < 0.9) {
    statusColor = "yellow";
  } else if (maxMeter.percentUsed >= 0.9) {
    statusColor = "red";
  }

  return (
    // <Flex className="px-3" direction="column">
    //   <Flex justify="between" align="center">
    //     <span>
    //       <Text as="label" weight="bold" size="1">
    //         {canManageBilling && planName !== "enterprise" ? (
    //           <Link href="/settings/billing" style={{ color: "#fff" }}>
    //             CDN Usage
    //           </Link>
    //         ) : (
    //           "CDN Usage"
    //         )}
    //       </Text>
    //       <Tooltip
    //         tipPosition="top"
    //         body={
    //           <Flex direction="column">
    //             <Text as="p">
    //               Your organization has used{" "}
    //               <strong>{maxMeter.percentUsed * 100}%</strong> of its
    //               available CDN <Code>{maxMeter.meter}</Code>.{" "}
    //             </Text>
    //             {planName === "enterprise" && canManageBilling ? (
    //               <Text as="p">
    //                 Upgrade to the Pro Plan to increase your organizations usage
    //                 limits.
    //               </Text>
    //             ) : null}
    //           </Flex>
    //         }
    //         className="pl-1"
    //       />
    //     </span>
    //     <Text as="label" weight="bold" size="1">
    //       {maxMeter.percentUsed * 100}%
    //     </Text>
    //   </Flex>
    //   <Progress
    //     value={maxMeter.percentUsed * 100}
    //     size="1"
    //     variant="surface"
    //     color={statusColor}
    //     className="mb-1"
    //   />
    // </Flex>
    <Flex className="px-3" direction="column">
      <Flex justify="between" align="center">
        <span>
          <Tooltip
            tipPosition="top"
            body={
              <Flex direction="column">
                <Text as="p">
                  Your organization has used{" "}
                  <strong>{maxMeter.percentUsed * 100}%</strong> of this
                  month&apos;s available CDN <Code>{maxMeter.meter}</Code>.
                </Text>
                {planName === "starter" && canManageBilling ? (
                  <Text as="p">
                    Upgrade to the Pro Plan to increase your organizations usage
                    limits.
                  </Text>
                ) : null}
              </Flex>
            }
            className="pl-1"
          >
            <Text as="label" weight="bold" size="1">
              {canManageBilling && planName !== "enterprise" ? (
                <Link href="/settings/billing" style={{ color: "#fff" }}>
                  CDN Usage
                </Link>
              ) : (
                "CDN Usage"
              )}
            </Text>
          </Tooltip>
        </span>
        <Text as="label" weight="bold" size="1">
          {maxMeter.percentUsed * 100}%
        </Text>
      </Flex>
      <Progress
        value={maxMeter.percentUsed * 100}
        size="1"
        variant="surface"
        color={statusColor}
        className="mb-1"
      />
    </Flex>
  );
}

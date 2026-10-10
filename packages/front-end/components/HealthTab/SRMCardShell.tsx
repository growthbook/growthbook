import { ReactNode, useEffect, useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentReportVariation } from "shared/types/report";
import { getSRMHealthData, SRMHealthStatus } from "shared/health";
import { DEFAULT_SRM_THRESHOLD } from "shared/constants";
import { useUser } from "@/services/UserContext";
import SRMWarning from "@/components/Experiment/SRMWarning";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import { StatusBadge } from "./StatusBadge";
import { IssueValue } from "./IssueTags";

/**
 * Computes the SRM health status using the org's configured threshold.
 */
export function useSrmHealth({
  srm,
  numOfVariations,
  totalUsersCount,
  minUsersPerVariation,
  onNotify,
}: {
  srm: number;
  numOfVariations: number;
  totalUsersCount: number;
  minUsersPerVariation: number;
  onNotify?: (issue: IssueValue) => void;
}): SRMHealthStatus {
  const { settings } = useUser();
  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const srmHealth = useMemo(
    () =>
      getSRMHealthData({
        srm,
        srmThreshold,
        numOfVariations,
        totalUsersCount,
        minUsersPerVariation,
      }),
    [srm, srmThreshold, numOfVariations, totalUsersCount, minUsersPerVariation],
  );

  useEffect(() => {
    if (srmHealth === "unhealthy" && onNotify) {
      onNotify({ label: "Experiment Balance", value: "balanceCheck" });
    }
  }, [srmHealth, onNotify]);

  return srmHealth;
}

export function SRMWarningFooter({
  srm,
  srmHealth,
  variations,
  users,
  isBandit,
}: {
  srm: number;
  srmHealth: SRMHealthStatus;
  variations?: ExperimentReportVariation[];
  users: number[];
  isBandit: boolean;
}) {
  if (srmHealth === "not-enough-traffic") {
    return (
      <Callout status="info">
        More traffic is required to detect a Sample Ratio Mismatch (SRM).
      </Callout>
    );
  }

  return (
    <SRMWarning
      srm={srm}
      variations={variations}
      users={users}
      showWhenHealthy
      isBandit={isBandit}
    />
  );
}

export default function SRMCardShell({
  title,
  description,
  srmHealth,
  className = "appbox",
  headerRight,
  children,
}: {
  title: string;
  description: ReactNode;
  srmHealth: SRMHealthStatus;
  /** Card surface class (e.g. "appbox" or "box"). Spacing is handled by the shell. */
  className?: string;
  /** Optional control rendered at the top-right of the header (e.g. a collapse caret). */
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const header = (
    <Flex align="center" gap="2">
      <Heading as="h2" size="lg">
        {title}
      </Heading>
      {srmHealth !== "healthy" && <StatusBadge status={srmHealth} />}
    </Flex>
  );

  return (
    <Box className={className} my="5" pl="4" py="4">
      <div style={{ overflow: "auto" }}>
        {headerRight ? (
          <Flex justify="between" align="start" gap="2">
            {header}
            <Box flexShrink="0">{headerRight}</Box>
          </Flex>
        ) : (
          header
        )}
        <Box asChild mt="1">
          <p>{description}</p>
        </Box>
        <Box asChild mb="0">
          <hr />
        </Box>
        <div style={{ paddingTop: "10px" }}>{children}</div>
      </div>
    </Box>
  );
}

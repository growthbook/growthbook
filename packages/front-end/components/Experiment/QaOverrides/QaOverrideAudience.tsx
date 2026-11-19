import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import { QaOverrideFilters } from "shared/types/experiment-qa-override";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import {
  QaOverrideFilterKind,
  QaOverrideNameLookups,
  qaOverrideAudienceParts,
  summarizeQaOverrideAudience,
} from "@/services/qaOverrides";
import ConditionDisplay, {
  operatorToText,
} from "@/components/Features/ConditionDisplay";
import Text from "@/ui/Text";
import { Popover } from "@/ui/Popover";
import styles from "./QaOverrides.module.scss";

type NamedConnection = { id: string; name: string };

export function useQaOverrideNameLookups(
  connections?: NamedConnection[],
): QaOverrideNameLookups {
  const { getSavedGroupById, getProjectById } = useDefinitions();
  const { data: connectionData } = useSDKConnections();
  return useMemo(
    () => ({
      savedGroupName: (id) => getSavedGroupById(id)?.groupName ?? id,
      projectName: (id) => getProjectById(id)?.name ?? id,
      sdkConnectionName: (id) =>
        connections?.find((c) => c.id === id)?.name ??
        connectionData?.connections?.find((c) => c.id === id)?.name ??
        id,
      operatorText: (operator) => operatorToText({ operator }),
    }),
    [connections, connectionData, getProjectById, getSavedGroupById],
  );
}

export function QaOverrideAnd() {
  return <span className={styles.and}>AND</span>;
}

export default function QaOverrideAudience({
  filters,
  lookups,
  order,
  environment,
  usesExperimentTargeting = false,
  variant,
}: {
  filters: QaOverrideFilters;
  lookups: QaOverrideNameLookups;
  order?: QaOverrideFilterKind[];
  environment?: string;
  usesExperimentTargeting?: boolean;
  variant: "sentence" | "inline";
}) {
  const sentence = variant === "sentence";
  const size = sentence ? "sm" : "inherit";
  const parts = qaOverrideAudienceParts({
    segments: summarizeQaOverrideAudience(filters, lookups, order),
    environment,
    usesExperimentTargeting,
    variant,
  });

  return (
    <Flex
      role={sentence ? "note" : undefined}
      aria-label={sentence ? "Who sees it summary" : undefined}
      align="baseline"
      wrap="wrap"
      style={{ columnGap: 6, rowGap: 2, minWidth: 0 }}
    >
      {parts.map((part, i) => {
        if (part.type === "and") return <QaOverrideAnd key={i} />;
        const suffix = part.suffix && (
          <Text size={size} color="text-mid">
            {part.suffix}
          </Text>
        );
        if (part.custom) {
          return (
            <span key={i}>
              <Popover
                openOnHover
                side="top"
                align="start"
                trigger={
                  <span
                    tabIndex={0}
                    className={clsx(styles.help, styles.dotted)}
                  >
                    <Text size={size} color="text-mid">
                      {part.text}
                    </Text>
                  </span>
                }
                content={
                  <Flex direction="column" style={{ maxWidth: 420 }}>
                    <ConditionDisplay condition={filters.condition} />
                  </Flex>
                }
              />
              {suffix}
            </span>
          );
        }
        const value = part.type === "value";
        return (
          <span key={i}>
            <Text
              size={size}
              color={value ? "text-high" : "text-mid"}
              weight={value && sentence ? "semibold" : undefined}
            >
              {part.text}
            </Text>
            {suffix}
          </span>
        );
      })}
    </Flex>
  );
}

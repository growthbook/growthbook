import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import { QaOverrideFilters } from "shared/types/experiment-qa-override";
import {
  QaOverrideFilterKind,
  QaOverrideNameLookups,
  qaOverrideAudienceParts,
  summarizeQaOverrideAudience,
} from "@/services/qaOverrides";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import styles from "./QaOverrides.module.scss";

function QaOverrideAnd() {
  return (
    <Text size="sm" weight="semibold" color="text-mid">
      AND
    </Text>
  );
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
  const size = sentence ? "md" : "inherit";
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
      gapX="2"
      gapY="1"
      minWidth="0"
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
                  // A real button, so Enter and Space open it.
                  <Link
                    color="inherit"
                    underline="none"
                    className={clsx(styles.help, styles.dotted)}
                  >
                    <Text size={size} color="text-mid">
                      {part.text}
                    </Text>
                  </Link>
                }
                content={
                  <Flex direction="column" maxWidth="420px">
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

import { CSSProperties, Fragment, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { QaOverrideFilters } from "shared/types/experiment-qa-override";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import {
  QaOverrideFilterKind,
  QaOverrideNameLookups,
  summarizeQaOverrideAudience,
} from "@/services/qaOverrides";
import ConditionDisplay, {
  operatorToText,
} from "@/components/Features/ConditionDisplay";
import Text from "@/ui/Text";
import { Popover } from "@/ui/Popover";

type NamedConnection = { id: string; name: string };

/**
 * Display names for ids in filters. `connections` lets a page that already
 * fetched the relevant SDK connections (the experiment endpoint returns the
 * ones the viewer may see) avoid a second request; anything missing falls
 * back to the org-wide list.
 */
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

const AND_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  color: "var(--color-text-mid)",
};

export function QaOverrideAnd() {
  return <span style={AND_STYLE}>AND</span>;
}

/**
 * Who an override applies to, in words. Values only, comma-separated within
 * a filter type and joined by a small AND between types.
 *
 * - `sentence` (the add/edit modal): "Anyone matching **id = 123** AND
 *   **Local dev (React)**." or "Everyone in **dev**."
 * - `inline` (the table): the same without the opener or the full stop, and
 *   "Experiment targeting" leading when the experiment's targeting applies.
 */
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
  /** Order of the filter cards, so the sentence reads top to bottom. */
  order?: QaOverrideFilterKind[];
  environment?: string;
  /** Test mode: filters narrow the experiment's own targeting. */
  usesExperimentTargeting?: boolean;
  variant: "sentence" | "inline";
}) {
  const segments = summarizeQaOverrideAudience(filters, lookups, order);
  const sentence = variant === "sentence";
  const size = sentence ? "sm" : "inherit";

  if (!segments.length && !usesExperimentTargeting) {
    return (
      <Text as={sentence ? "p" : "span"} size={size} color="text-mid" mb="0">
        Everyone in{" "}
        {environment ? (
          <Text size={size} weight="semibold" color="text-high">
            {environment}
          </Text>
        ) : (
          "the selected environment"
        )}
        {sentence ? "." : ""}
      </Text>
    );
  }

  const opener = usesExperimentTargeting
    ? sentence
      ? "Anyone matching the experiment\u2019s targeting"
      : "Experiment targeting"
    : sentence
      ? "Anyone matching"
      : null;

  return (
    <Flex
      role={sentence ? "note" : undefined}
      aria-label={sentence ? "Who sees it summary" : undefined}
      align="baseline"
      wrap="wrap"
      style={{ columnGap: 6, rowGap: 2, minWidth: 0 }}
    >
      {opener && (
        <Text size={size} color="text-mid">
          {opener}
          {sentence && !segments.length ? "." : ""}
        </Text>
      )}
      {segments.map((segment, i) => {
        const last = i === segments.length - 1;
        const stop = sentence && last ? "." : "";
        return (
          <Fragment key={segment.kind}>
            {(i > 0 || usesExperimentTargeting) && <QaOverrideAnd />}
            {segment.custom ? (
              <span>
                <Popover
                  openOnHover
                  side="top"
                  align="start"
                  trigger={
                    <span
                      tabIndex={0}
                      style={{
                        cursor: "help",
                        textDecoration: "underline dotted",
                        textUnderlineOffset: 3,
                      }}
                    >
                      <Text size={size} color="text-mid">
                        {sentence ? segment.text : "Custom condition"}
                      </Text>
                    </span>
                  }
                  content={
                    <Flex direction="column" style={{ maxWidth: 420 }}>
                      <ConditionDisplay condition={filters.condition} />
                    </Flex>
                  }
                />
                {stop && (
                  <Text size={size} color="text-mid">
                    {stop}
                  </Text>
                )}
              </span>
            ) : (
              <Text
                size={size}
                color="text-high"
                weight={sentence ? "semibold" : undefined}
              >
                {segment.text}
                {stop}
              </Text>
            )}
          </Fragment>
        );
      })}
    </Flex>
  );
}

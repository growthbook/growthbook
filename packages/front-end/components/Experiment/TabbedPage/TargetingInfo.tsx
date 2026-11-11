import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import { changedTargeting, hasAttributeCondition } from "shared/experiments";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { coveragePercentFormatter, formatTrafficSplit } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import useOrgSettings from "@/hooks/useOrgSettings";
import ChangesTable, {
  ChangesTableRow,
} from "@/components/Reviews/ChangesTable";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useTargetingDefaults } from "@/components/Experiment/useExperimentTargetingForm";
import SetupFieldRow, { SetupFieldGroup } from "./SetupFieldRow";

function formatRanges(ranges: [number, number][]): string {
  return ranges.map(([start, end]) => `[${start} - ${end}]`).join(" ");
}

const none = <em>None</em>;

type TargetingField = {
  key: keyof ExperimentTargetingData;
  label: string;
  // Shown once it changes; otherwise the summary keeps to who's included.
  advanced?: boolean;
  render: (targeting: ExperimentTargetingData) => ReactNode;
};

function useTargetingFields(
  experiment: ExperimentInterfaceStringDates,
): TargetingField[] {
  const { namespaces } = useOrgSettings();
  return [
    {
      key: "savedGroups",
      label: "Saved Group targeting",
      render: ({ savedGroups }) =>
        savedGroups?.length ? (
          <SavedGroupTargetingDisplay savedGroups={savedGroups} />
        ) : (
          none
        ),
    },
    {
      key: "condition",
      label: "Attribute targeting",
      render: ({ condition }) =>
        hasAttributeCondition(condition) ? (
          <ConditionDisplay condition={condition} />
        ) : (
          none
        ),
    },
    {
      key: "prerequisites",
      label: "Prerequisite targeting",
      render: ({ prerequisites }) =>
        prerequisites?.length ? (
          <ConditionDisplay prerequisites={prerequisites} />
        ) : (
          none
        ),
    },
    {
      key: "namespace",
      label: "Namespace targeting",
      render: ({ namespace }) => {
        if (!namespace?.enabled) return <em>Global (all users)</em>;
        const { coverage, ranges, name } = getNamespaceDisplayData(
          namespace,
          namespaces,
        );
        return (
          <>
            {name}{" "}
            <Text color="text-low">
              ({coveragePercentFormatter.format(coverage)})
            </Text>
            {ranges.length > 0 && (
              <Text size="sm" color="text-low" ml="1">
                {formatRanges(ranges)}
              </Text>
            )}
          </>
        );
      },
    },
    {
      key: "coverage",
      label: "Traffic percent",
      render: ({ coverage }) => coveragePercentFormatter.format(coverage),
    },
    ...(experiment.type !== "multi-armed-bandit"
      ? [
          {
            key: "variationWeights",
            label: "Variation weights",
            render: ({ variationWeights }) =>
              formatTrafficSplit(variationWeights, 2),
          } satisfies TargetingField,
        ]
      : []),
    {
      key: "hashAttribute",
      label: "Assignment attribute",
      advanced: true,
      render: ({ hashAttribute }) => hashAttribute,
    },
    {
      key: "fallbackAttribute",
      label: "Fallback attribute",
      advanced: true,
      render: ({ fallbackAttribute }) => fallbackAttribute || none,
    },
    {
      key: "disableStickyBucketing",
      label: "Sticky bucketing",
      advanced: true,
      render: ({ disableStickyBucketing }) =>
        disableStickyBucketing ? "Disabled" : "Enabled",
    },
    {
      key: "hashVersion",
      label: "Hashing algorithm",
      advanced: true,
      render: ({ hashVersion }) =>
        hashVersion === 1 ? "V1 (Legacy)" : "V2 (Preferred)",
    },
  ];
}

function Disclosure({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: string;
}) {
  return (
    <Link
      size="sm"
      aria-expanded={open}
      onClick={(e) => {
        e.preventDefault();
        onToggle();
      }}
    >
      <Flex align="center" gap="1">
        {children}
        {open ? <PiCaretDown /> : <PiCaretRight />}
      </Flex>
    </Link>
  );
}

/** Who the experiment includes now. */
export default function TargetingInfo({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const targeting = useTargetingDefaults(experiment);
  const fields = useTargetingFields(experiment);
  return (
    <SetupFieldGroup inset>
      {experiment.phases.length ? (
        fields
          .filter((field) => !field.advanced)
          .map((field) => (
            <SetupFieldRow key={field.key} label={field.label} content="text">
              <Text as="div" color="text-high">
                {field.render(targeting)}
              </Text>
            </SetupFieldRow>
          ))
      ) : (
        <Box py="2">
          <em>No targeting configured yet</em>
        </Box>
      )}
    </SetupFieldGroup>
  );
}

/** Live targeting beside `value`, with the phase and seed its release starts. */
export function TargetingChanges({
  experiment,
  value,
}: {
  experiment: ExperimentInterfaceStringDates;
  value: ExperimentTargetingData;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const live = useTargetingDefaults(experiment);
  const fields = useTargetingFields(experiment);
  // Judged as the save judges them, so only what it would write shows.
  const changed = new Set(Object.keys(changedTargeting(value, live)));
  const phase = experiment.phases.length;
  const bucketMoved = changed.has("bucketVersion");
  const minBucketMoved = changed.has("minBucketVersion");
  // What the release plan does, in words; the settings behind each open up.
  const releaseRows: ChangesTableRow[] = [
    ...(value.newPhase
      ? [
          {
            key: "phase",
            label: "Phase",
            changed: true,
            before: phase ? `Phase ${phase}` : none,
            after: `Phase ${phase + 1}`,
          },
        ]
      : []),
    ...(value.newPhase && value.reseed && phase
      ? [
          {
            key: "assignment",
            label: "Assignment",
            changed: true,
            before: "As assigned now",
            after: "Randomized again",
            details: [
              {
                label: "Seed",
                before: live.seed || experiment.trackingKey,
                after: "A new seed",
              },
            ],
          },
        ]
      : []),
    ...(bucketMoved || minBucketMoved
      ? [
          {
            key: "stickyBucketing",
            label: "Sticky bucketed users",
            changed: true,
            before: "Keep their assigned variation",
            after: minBucketMoved
              ? "Excluded from the experiment"
              : "Reassigned",
            // Only the versions that move.
            details: [
              ...(bucketMoved
                ? [
                    {
                      label: "Bucket version",
                      before: live.bucketVersion,
                      after: value.bucketVersion ?? live.bucketVersion,
                    },
                  ]
                : []),
              ...(minBucketMoved
                ? [
                    {
                      label: "Minimum bucket version",
                      before: live.minBucketVersion,
                      after: value.minBucketVersion ?? live.minBucketVersion,
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
  ];
  const targetingRows = fields
    .filter((field) => changed.has(field.key) || (showAll && !field.advanced))
    .map((field) => ({
      key: field.key,
      label: field.label,
      changed: changed.has(field.key),
      before: field.render(live),
      after: field.render(value),
    }));
  return (
    <ChangesTable
      before="Live"
      after="After publishing"
      showDetails={showDetails}
      groups={[
        {
          key: "release",
          rows: releaseRows,
          footer: releaseRows.some((row) => row.details) ? (
            <Disclosure
              open={showDetails}
              onToggle={() => setShowDetails(!showDetails)}
            >
              {showDetails ? "Hide details" : "Show details"}
            </Disclosure>
          ) : undefined,
        },
        {
          key: "targeting",
          rows: targetingRows,
          footer: (
            <Disclosure open={showAll} onToggle={() => setShowAll(!showAll)}>
              {showAll ? "Show changes only" : "Show full targeting"}
            </Disclosure>
          ),
        },
      ]}
    />
  );
}

import { ReactNode } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import { changedTargeting, hasAttributeCondition } from "shared/experiments";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { formatTrafficSplit } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import useOrgSettings from "@/hooks/useOrgSettings";
import { GBInfo } from "@/components/Icons";
import ChangesTable, {
  ChangesTableRow,
} from "@/components/Reviews/ChangesTable";
import { useTargetingDefaults } from "@/components/Experiment/useExperimentTargetingForm";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function formatRanges(ranges: [number, number][]): string {
  return ranges.map(([start, end]) => `[${start} - ${end}]`).join(" ");
}

const none = <em>None</em>;

type TargetingField = {
  key: keyof ExperimentTargetingData;
  label: string;
  tooltip?: string;
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
      tooltip:
        "Use namespaces to run mutually exclusive experiments. Manage namespaces under Experimentation → Namespaces",
      render: ({ namespace }) => {
        if (!namespace?.enabled) return <em>Global (all users)</em>;
        const { coverage, ranges, name } = getNamespaceDisplayData(
          namespace,
          namespaces,
        );
        return (
          <>
            {name}{" "}
            <span className="text-muted">
              ({percentFormatter.format(coverage)})
            </span>
            {ranges.length > 0 && (
              <span className="text-muted small ml-1">
                {formatRanges(ranges)}
              </span>
            )}
          </>
        );
      },
    },
    {
      key: "coverage",
      label: "Traffic percent",
      render: ({ coverage }) => percentFormatter.format(coverage),
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

/** Who the experiment includes now. */
export default function TargetingInfo({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const targeting = useTargetingDefaults(experiment);
  const fields = useTargetingFields(experiment);
  if (!experiment.phases.length) {
    return (
      <div className="mb-3">
        <em>No targeting configured yet</em>
      </div>
    );
  }
  return (
    <div>
      {fields
        .filter((field) => !field.advanced)
        .map((field) => (
          <div key={field.key} className="mb-3">
            <div className="mb-1">
              <strong>{field.label}</strong>
              {field.tooltip ? (
                <>
                  {" "}
                  <Tooltip body={field.tooltip}>
                    <GBInfo />
                  </Tooltip>
                </>
              ) : null}
            </div>
            <div>{field.render(targeting)}</div>
          </div>
        ))}
    </div>
  );
}

/**
 * The experiment's targeting live beside `value`, with any new phase and seed
 * its release starts. Changes are judged as the save judges them, so only what
 * it would write shows as one.
 */
export function TargetingChanges({
  experiment,
  value,
  showAll,
}: {
  experiment: ExperimentInterfaceStringDates;
  value: ExperimentTargetingData;
  showAll: boolean;
}) {
  const live = useTargetingDefaults(experiment);
  const fields = useTargetingFields(experiment);
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
            details: [
              {
                label: "Bucket version",
                before: live.bucketVersion,
                after: value.bucketVersion ?? live.bucketVersion,
              },
              {
                label: "Minimum bucket version",
                before: live.minBucketVersion,
                after: value.minBucketVersion ?? live.minBucketVersion,
              },
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
  if (!releaseRows.length && !targetingRows.length) {
    return (
      <div className="mb-3">
        <em>No changes</em>
      </div>
    );
  }
  return (
    <ChangesTable
      before="Live"
      after="After publishing"
      groups={[releaseRows, targetingRows]}
    />
  );
}

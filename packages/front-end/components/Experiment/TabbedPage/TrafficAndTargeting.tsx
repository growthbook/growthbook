import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { calculateNamespaceCoverage } from "shared/util";
import { hasTargetingConfigured } from "shared/experiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import {
  formatTrafficSplit,
  getHoldoutTrafficBreakdown,
} from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { HashVersionTooltip } from "@/components/Experiment/HashVersionSelector";
import useOrgSettings from "@/hooks/useOrgSettings";
import { GBInfo } from "@/components/Icons";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
  editTraffic?: (() => void) | null;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function TrafficAndTargeting({
  phaseIndex = null,
  experiment,
  editTargeting,
  editTraffic,
}: Props) {
  const { namespaces } = useOrgSettings();

  const phase = experiment.phases?.[phaseIndex ?? experiment.phases.length - 1];
  const hasNamespace = phase?.namespace && phase.namespace.enabled;

  // Calculate total namespace allocation
  const namespaceRange =
    hasNamespace && phase.namespace
      ? calculateNamespaceCoverage(phase.namespace)
      : 1;

  const namespaceName = hasNamespace
    ? namespaces?.find((n) => n.name === phase.namespace!.name)?.label ||
      phase.namespace!.name
    : "";

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";
  const holdoutTraffic = getHoldoutTrafficBreakdown(phase);

  const hasConfiguredTargeting = hasTargetingConfigured(phase);

  return (
    <>
      {phase ? (
        <>
          <Frame>
            <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
              <Heading color="text-high" as="h4" size="small" mb="0">
                Traffic Allocation
              </Heading>
              <div className="flex-1" />
              {editTraffic && !(isBandit && experiment.status === "running") ? (
                <Link onClick={() => editTraffic()}>
                  <Text weight="semibold">Edit</Text>
                </Link>
              ) : null}
            </div>

            <div className="row">
              <div className="col-4">
                <div className="h5">Traffic</div>
                {!isHoldout && (
                  <div>
                    <Text color="text-mid">
                      {Math.floor(phase.coverage * 100)}% included
                      {experiment.type !== "multi-armed-bandit" && (
                        <>
                          , {formatTrafficSplit(phase.variationWeights, 2)}{" "}
                          split
                        </>
                      )}
                    </Text>
                  </div>
                )}
                {isHoldout && (
                  <>
                    <div>
                      <Text color="text-mid">
                        {holdoutTraffic.inHoldoutPercent}% in holdout
                      </Text>
                    </div>
                    <div>
                      <Text color="text-mid">
                        {holdoutTraffic.forMeasurementPercent}% not in holdout
                        (for measurement)
                      </Text>
                    </div>
                    <div>
                      <Text color="text-mid">
                        {holdoutTraffic.notForMeasurementPercent}% not in
                        holdout (not for measurement)
                      </Text>
                    </div>
                  </>
                )}
              </div>

              <div className="col-4">
                <div className="h5">
                  Assignment Attribute
                  {experiment.fallbackAttribute ? "s" : ""}{" "}
                  <Tooltip
                    popperStyle={{ lineHeight: 1.5 }}
                    body="This user attribute will be used to assign variations. This is typically either a logged-in user id or an anonymous id stored in a long-lived cookie."
                  >
                    <GBInfo />
                  </Tooltip>
                </div>
                <div className="d-flex flex-wrap align-items-center gap-1">
                  <AttributeBadge
                    attributeId={experiment.hashAttribute || "id"}
                  />
                  {experiment.fallbackAttribute ? (
                    <>
                      ,{" "}
                      <AttributeBadge
                        attributeId={experiment.fallbackAttribute}
                      />
                    </>
                  ) : null}
                  {!isHoldout ? (
                    <HashVersionTooltip>
                      <small className="text-muted ml-1">
                        (V{experiment.hashVersion || 2} hashing)
                      </small>
                    </HashVersionTooltip>
                  ) : null}
                </div>
                {!isHoldout && experiment.disableStickyBucketing ? (
                  <div className="mt-1">
                    <Text color="text-mid">
                      Sticky bucketing: <em>disabled</em>
                    </Text>
                  </div>
                ) : null}
              </div>

              {!isHoldout && (
                <div className="col-4">
                  <div className="h5">
                    Namespace{" "}
                    <Tooltip
                      popperStyle={{ lineHeight: 1.5 }}
                      body="Use namespaces to run mutually exclusive experiments. Manage namespaces under Experimentation → Namespaces"
                    >
                      <GBInfo />
                    </Tooltip>
                  </div>
                  <div>
                    {hasNamespace ? (
                      <Text color="text-mid">
                        {namespaceName} (
                        {percentFormatter.format(namespaceRange)})
                      </Text>
                    ) : (
                      <Text color="text-mid">Global (all users)</Text>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Frame>

          <Frame>
            <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
              <Heading color="text-high" as="h4" size="small" mb="0">
                Targeting
              </Heading>
              <div className="flex-1" />
              {editTargeting &&
              !(isBandit && experiment.status === "running") ? (
                <Link onClick={editTargeting}>
                  <Text weight="semibold">Edit</Text>
                </Link>
              ) : null}
            </div>
            {hasConfiguredTargeting ? (
              <div className="row">
                <div className="col-4">
                  <div className="h5">Attribute Targeting</div>
                  <div>
                    {phase.condition && phase.condition !== "{}" ? (
                      <ConditionDisplay condition={phase.condition} />
                    ) : (
                      <Text color="text-mid">--</Text>
                    )}
                  </div>
                </div>

                <div className="col-4">
                  <div className="h5">Saved Group Targeting</div>
                  <div>
                    {phase.savedGroups?.length ? (
                      <SavedGroupTargetingDisplay
                        savedGroups={phase.savedGroups}
                      />
                    ) : (
                      <Text color="text-mid">--</Text>
                    )}
                  </div>
                </div>

                {!isHoldout && (
                  <div className="col-4">
                    <div className="h5">Prerequisite Targeting</div>
                    <div>
                      {phase.prerequisites?.length ? (
                        <ConditionDisplay prerequisites={phase.prerequisites} />
                      ) : (
                        <Text color="text-mid">--</Text>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Text color="text-mid">
                No targeting ({isHoldout ? "holdout" : "experiment"} will
                include all traffic)
              </Text>
            )}
          </Frame>
        </>
      ) : (
        <Callout status="warning" mb="4">
          No traffic allocation or targeting configured yet. Add a phase to this
          experiment.
        </Callout>
      )}
    </>
  );
}

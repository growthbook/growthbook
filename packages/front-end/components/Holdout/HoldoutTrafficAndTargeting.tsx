import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { hasTargetingConfigured } from "shared/experiments";
import { Trans, useLingui } from "@lingui/react/macro";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { GBInfo } from "@/components/Icons";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import HoldoutTrafficBreakdown from "./HoldoutTrafficBreakdown";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
  editTraffic?: (() => void) | null;
}

export default function HoldoutTrafficAndTargeting({
  phaseIndex = null,
  experiment,
  editTargeting,
  editTraffic,
}: Props) {
  const { t } = useLingui();
  const phase = experiment.phases?.[phaseIndex ?? experiment.phases.length - 1];

  const hasConfiguredTargeting = hasTargetingConfigured(phase);

  return (
    <>
      {phase ? (
        <>
          <Frame>
            <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
              <Heading color="text-high" as="h4" size="sm" mb="0">
                <Trans>Traffic Allocation</Trans>
              </Heading>
              <div className="flex-1" />
              {editTraffic ? (
                <Link onClick={editTraffic}>
                  <Text weight="semibold">
                    <Trans>Edit</Trans>
                  </Text>
                </Link>
              ) : null}
            </div>

            <div className="row">
              <div className="col-4">
                <div className="h5">
                  <Trans>Traffic</Trans>
                </div>
                <HoldoutTrafficBreakdown phase={phase} color="text-mid" />
              </div>

              <div className="col-4">
                <div className="h5">
                  {experiment.fallbackAttribute ? (
                    <Trans>Assignment Attributes</Trans>
                  ) : (
                    <Trans>Assignment Attribute</Trans>
                  )}{" "}
                  <Tooltip
                    popperStyle={{ lineHeight: 1.5 }}
                    body={t`This user attribute will be used to assign variations. This is typically either a logged-in user id or an anonymous id stored in a long-lived cookie.`}
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
                </div>
              </div>
            </div>
          </Frame>

          <Frame>
            <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
              <Heading color="text-high" as="h4" size="sm" mb="0">
                <Trans>Targeting</Trans>
              </Heading>
              <div className="flex-1" />
              {editTargeting ? (
                <Link onClick={editTargeting}>
                  <Text weight="semibold">
                    <Trans>Edit</Trans>
                  </Text>
                </Link>
              ) : null}
            </div>
            {hasConfiguredTargeting ? (
              <div className="row">
                <div className="col-4">
                  <div className="h5">
                    <Trans>Attribute Targeting</Trans>
                  </div>
                  <div>
                    {phase.condition && phase.condition !== "{}" ? (
                      <ConditionDisplay condition={phase.condition} />
                    ) : (
                      <Text color="text-mid">--</Text>
                    )}
                  </div>
                </div>

                <div className="col-4">
                  <div className="h5">
                    <Trans>Saved Group Targeting</Trans>
                  </div>
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
              </div>
            ) : (
              <Text color="text-mid">
                <Trans>No targeting (holdout will include all traffic)</Trans>
              </Text>
            )}
          </Frame>
        </>
      ) : (
        <Callout status="warning" mb="4">
          <Trans>
            No traffic allocation or targeting configured yet. Add a phase to
            this experiment.
          </Trans>
        </Callout>
      )}
    </>
  );
}

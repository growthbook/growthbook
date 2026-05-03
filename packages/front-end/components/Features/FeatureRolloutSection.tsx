import { FeatureInterface } from "shared/types/feature";
import { useMemo } from "react";
import { RampScheduleInterface, RampScheduleScope } from "shared/validators";
import { MdRocketLaunch } from "react-icons/md";
import {
  PiShieldCheckBold,
  PiLockSimpleBold,
  PiArrowsClockwise,
  PiCheckCircleBold,
} from "react-icons/pi";
import { Box, Flex, Separator } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";

function statusBadge(status: RampScheduleInterface["status"]) {
  switch (status) {
    case "running":
      return <Badge label="Running" color="blue" />;
    case "paused":
      return <Badge label="Paused" color="yellow" />;
    case "pending-approval":
      return <Badge label="Pending Approval" color="purple" />;
    case "completed":
      return <Badge label="Completed" color="green" />;
    case "rolled-back":
      return <Badge label="Rolled Back" color="red" />;
    case "ready":
      return <Badge label="Ready" color="gray" />;
    case "pending":
      return <Badge label="Pending" color="gray" />;
    default:
      return <Badge label={status} color="gray" />;
  }
}

function scopeLabel(scope: RampScheduleScope | undefined) {
  if (scope === "feature") return "Feature Rollout";
  return "Rule Ramp";
}

function CoverageBar({ coverage }: { coverage: number }) {
  return (
    <Tooltip body={`${Math.round(coverage * 100)}% coverage`}>
      <Box
        style={{
          width: 120,
          height: 8,
          borderRadius: 4,
          background: "var(--gray-4)",
          overflow: "hidden",
        }}
      >
        <Box
          style={{
            width: `${coverage * 100}%`,
            height: "100%",
            borderRadius: 4,
            background:
              coverage >= 1
                ? "var(--green-9)"
                : coverage > 0
                  ? "var(--blue-9)"
                  : "var(--gray-6)",
            transition: "width 300ms ease",
          }}
        />
      </Box>
    </Tooltip>
  );
}

export default function FeatureRolloutSection({
  feature,
  mutate,
  canEdit,
}: {
  feature: FeatureInterface;
  mutate: () => Promise<unknown>;
  canEdit: boolean;
}) {
  const { apiCall } = useAuth();

  const { data: scheduleData } = useApi<{
    rampSchedule: RampScheduleInterface;
  }>(`/api/v1/ramp-schedules/${feature.activeRampScheduleId ?? ""}`, {
    shouldRun: () => !!feature.activeRampScheduleId,
  });

  const { data: allSchedulesData } = useApi<{
    rampSchedules: RampScheduleInterface[];
  }>(`/ramp-schedules?featureId=${feature.id}`);

  const activeSchedule = scheduleData?.rampSchedule;
  const featureSchedules = useMemo(() => {
    return (allSchedulesData?.rampSchedules ?? []).filter(
      (s) => s.scope === "feature",
    );
  }, [allSchedulesData]);

  const hasActiveRollout = !!activeSchedule;
  const isTerminal =
    activeSchedule &&
    ["completed", "rolled-back"].includes(activeSchedule.status);

  const isFeatureLiveInAnyEnv = Object.values(
    feature.environmentSettings || {},
  ).some((s) => s.enabled);

  if (!hasActiveRollout && !featureSchedules.length) {
    return (
      <Frame mb="4" px="6" py="4">
        <Flex align="center" justify="between">
          <Flex align="center" gap="2">
            <MdRocketLaunch size={18} />
            <Heading size="small" as="h4" mb="0">
              Controlled Rollout
            </Heading>
          </Flex>
          {canEdit && (
            <Tooltip
              body={
                isFeatureLiveInAnyEnv
                  ? "Feature is already enabled. Controlled rollouts are for first-time publishing."
                  : "Plan a staged rollout with monitoring and approval gates"
              }
            >
              <Button
                size="sm"
                variant={isFeatureLiveInAnyEnv ? "outline" : "solid"}
              >
                Plan Rollout
              </Button>
            </Tooltip>
          )}
        </Flex>
        <Text as="p" size="small" color="text-mid" mt="2" mb="0">
          Safely publish this feature with staged coverage, monitoring, and
          approval gates.
        </Text>
      </Frame>
    );
  }

  const schedule = activeSchedule ?? featureSchedules[0];
  if (!schedule) return null;

  const coverage = schedule.gateConfig?.coverage ?? 0;
  const currentStep = schedule.currentStepIndex;
  const totalSteps = schedule.steps.length;
  const lockdown = schedule.lockdownConfig;
  const monitoring = schedule.monitoringConfig;

  return (
    <Frame mb="4" px="6" py="4">
      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="2">
          <MdRocketLaunch size={18} />
          <Heading size="small" as="h4" mb="0">
            {scopeLabel(schedule.scope)}
          </Heading>
          {statusBadge(schedule.status)}
        </Flex>
        <Flex gap="2">
          {canEdit && !isTerminal && schedule.status === "pending-approval" && (
            <Button
              size="sm"
              onClick={async () => {
                await apiCall(
                  `/api/v1/ramp-schedules/${schedule.id}/actions/approve-step`,
                  { method: "POST" },
                );
                await mutate();
              }}
            >
              Approve Step
            </Button>
          )}
          {canEdit && !isTerminal && schedule.status === "running" && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await apiCall(
                  `/api/v1/ramp-schedules/${schedule.id}/actions/pause`,
                  { method: "POST" },
                );
                await mutate();
              }}
            >
              Pause
            </Button>
          )}
          {canEdit && schedule.status === "paused" && (
            <Button
              size="sm"
              onClick={async () => {
                await apiCall(
                  `/api/v1/ramp-schedules/${schedule.id}/actions/resume`,
                  { method: "POST" },
                );
                await mutate();
              }}
            >
              Resume
            </Button>
          )}
        </Flex>
      </Flex>

      {schedule.gateConfig && (
        <Box mb="3">
          <Flex align="center" gap="3" mb="2">
            <Text size="small" weight="semibold">
              Gate Coverage
            </Text>
            <CoverageBar coverage={coverage} />
            <Text size="small" color="text-mid">
              {Math.round(coverage * 100)}%
            </Text>
          </Flex>
          {schedule.gateConfig.condition && (
            <Flex align="center" gap="3">
              <Text size="small" weight="semibold">
                Targeting
              </Text>
              <Text size="small" color="text-mid">
                {schedule.gateConfig.condition}
              </Text>
            </Flex>
          )}
        </Box>
      )}

      {totalSteps > 0 && (
        <Box mb="3">
          <Text size="small" weight="semibold" mb="1">
            Step {Math.max(0, currentStep + 1)} of {totalSteps}
          </Text>
          <Flex gap="1">
            {schedule.steps.map((step, i) => (
              <Tooltip
                key={i}
                body={`Step ${i + 1}: ${step.trigger.type}${step.monitored ? " (monitored)" : ""}`}
              >
                <Box
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 3,
                    background:
                      i <= currentStep
                        ? "var(--blue-9)"
                        : i === currentStep + 1 && schedule.status === "running"
                          ? "var(--blue-5)"
                          : "var(--gray-4)",
                    transition: "background 300ms ease",
                  }}
                />
              </Tooltip>
            ))}
          </Flex>
        </Box>
      )}

      <Separator size="4" mb="3" />

      <Flex gap="4" wrap="wrap">
        {monitoring && (
          <Flex align="center" gap="1">
            <PiShieldCheckBold size={14} style={{ color: "var(--blue-9)" }} />
            <Text size="small" color="text-mid">
              {monitoring.guardrailMetricIds.length} guardrail
              {monitoring.guardrailMetricIds.length !== 1 ? "s" : ""}
            </Text>
          </Flex>
        )}
        {lockdown && lockdown.mode !== "none" && (
          <Flex align="center" gap="1">
            <PiLockSimpleBold size={14} style={{ color: "var(--amber-9)" }} />
            <Text size="small" color="text-mid">
              Lockdown:{" "}
              {lockdown.mode === "all-edits" ? "All edits" : "Elevated only"}
            </Text>
          </Flex>
        )}
        {schedule.steps.some((s) => s.trigger.type === "approval") && (
          <Flex align="center" gap="1">
            <PiCheckCircleBold size={14} style={{ color: "var(--purple-9)" }} />
            <Text size="small" color="text-mid">
              Approval gates
            </Text>
          </Flex>
        )}
        {schedule.steps.some((s) => s.trigger.type === "interval") && (
          <Flex align="center" gap="1">
            <PiArrowsClockwise size={14} style={{ color: "var(--gray-9)" }} />
            <Text size="small" color="text-mid">
              Timed steps
            </Text>
          </Flex>
        )}
      </Flex>

      {lockdown && lockdown.mode !== "none" && !isTerminal && (
        <Callout status="warning" size="sm" mt="3" mb="0">
          Feature rules are locked while this rollout is active.
          {lockdown.mode === "elevated-only" &&
            " Org admins can still make changes."}
        </Callout>
      )}

      <Flex mt="3" justify="end">
        <a
          href={`/features/${feature.id}?tab=rollout`}
          className="font-weight-semibold"
          style={{ fontSize: "0.875rem" }}
        >
          View full schedule
        </a>
      </Flex>
    </Frame>
  );
}

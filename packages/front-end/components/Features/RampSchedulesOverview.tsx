import { useState } from "react";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiHourglassMediumFill } from "react-icons/pi";
import { RampScheduleInterface } from "shared/validators";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import RampTimeline, {
  getRampBadgeColor,
  getRampStatusLabel,
  getRampStepsCompleted,
} from "@/components/RampSchedule/RampTimeline";
import { useAuth } from "@/services/auth";

interface Props {
  rampSchedules: RampScheduleInterface[];
  mutate: () => Promise<unknown>;
  onEditTarget: (environment: string, ruleId: string) => void;
  onEditSchedule: (rs: RampScheduleInterface) => void;
  onReviewDraft: (version: number) => void;
  onConfirmDelete: (id: string, name: string) => void;
}

export default function RampSchedulesOverview({
  rampSchedules,
  mutate,
  onEditTarget,
  onEditSchedule,
  onReviewDraft,
  onConfirmDelete,
}: Props) {
  const { apiCall } = useAuth();
  const [approveErrors, setApproveErrors] = useState<Record<string, string>>(
    {},
  );
  const [approveLoading, setApproveLoading] = useState<Record<string, boolean>>(
    {},
  );

  return (
    <>
      {rampSchedules.map((rs) => {
        const isTerminal = ["completed", "expired", "rolled-back"].includes(
          rs.status,
        );
        const activeTargets = rs.targets.filter(
          (t) => t.status === "active" && t.ruleId && t.environment,
        );
        const stepsCompleted = getRampStepsCompleted(rs);

        return (
          <div
            key={rs.id}
            id={`ramp-${rs.id}`}
            className="appbox px-3 pt-3 pb-2"
          >
            {/* Row 1: name / status / edit link / CTAs / menu */}
            <Flex align="center" gap="2" mb="1" wrap="nowrap">
              {/* Icon + name + badge */}
              <Flex
                align="center"
                gap="1"
                style={{ flexShrink: 0, minWidth: 0 }}
              >
                <PiHourglassMediumFill size={18} />
                <span style={{ whiteSpace: "nowrap" }}>
                  <Text weight="medium">{rs.name}</Text>
                </span>
              </Flex>
              <Badge
                label={getRampStatusLabel(rs)}
                color={getRampBadgeColor(rs.status)}
                radius="full"
              />

              {/* Step counter — only for active ramps */}
              {rs.steps.length > 0 && !isTerminal && (
                <>
                  <Separator
                    orientation="vertical"
                    style={{ height: 14, flexShrink: 0 }}
                  />
                  <span style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
                    <Text as="span" size="small" color="text-mid">
                      {`Step ${stepsCompleted} of ${rs.steps.length}`}
                    </Text>
                  </span>
                </>
              )}

              <Box flexGrow="1" />

              {/* Inline CTAs */}
              <Flex gap="3" align="center" style={{ flexShrink: 0 }}>
                {rs.status === "pending" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (activeTargets.length === 1) {
                        onEditTarget(
                          activeTargets[0].environment!,
                          activeTargets[0].ruleId!,
                        );
                      } else {
                        onEditSchedule(rs);
                      }
                    }}
                  >
                    Edit ramp
                  </Button>
                )}
                {rs.status === "paused" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await apiCall(`/ramp-schedule/${rs.id}/actions/resume`, {
                        method: "POST",
                      });
                      await mutate();
                    }}
                  >
                    Resume
                  </Button>
                )}
                {rs.status === "pending-approval" &&
                  rs.pendingApprovalRevisionId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={approveLoading[rs.id]}
                      onClick={async () => {
                        setApproveErrors((prev) => ({ ...prev, [rs.id]: "" }));
                        setApproveLoading((prev) => ({
                          ...prev,
                          [rs.id]: true,
                        }));
                        try {
                          await apiCall(
                            `/ramp-schedule/${rs.id}/actions/approve-step`,
                            { method: "POST" },
                          );
                          await mutate();
                        } catch (e) {
                          const msg =
                            e instanceof Error ? e.message : String(e);
                          // If a merge conflict, also surface a link to open the draft
                          setApproveErrors((prev) => ({
                            ...prev,
                            [rs.id]: msg,
                          }));
                        } finally {
                          setApproveLoading((prev) => ({
                            ...prev,
                            [rs.id]: false,
                          }));
                        }
                      }}
                    >
                      Approve and continue
                    </Button>
                  )}
                {/* ⋮ menu */}
                <DropdownMenu
                  trigger={
                    <IconButton
                      variant="ghost"
                      color="gray"
                      radius="full"
                      size="2"
                      highContrast
                    >
                      <BsThreeDotsVertical size={18} />
                    </IconButton>
                  }
                  menuPlacement="end"
                  variant="soft"
                >
                  {/* Edit schedule */}
                  {rs.status === "running" ? (
                    <Tooltip
                      tipPosition="top"
                      body="Pause the ramp to edit the schedule"
                    >
                      <div style={{ cursor: "not-allowed" }}>
                        <DropdownMenuItem disabled>
                          Edit schedule
                        </DropdownMenuItem>
                      </div>
                    </Tooltip>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => {
                        if (activeTargets.length === 1) {
                          onEditTarget(
                            activeTargets[0].environment!,
                            activeTargets[0].ruleId!,
                          );
                        } else {
                          onEditSchedule(rs);
                        }
                      }}
                    >
                      Edit schedule
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator />

                  {/* pending: blocked Start */}
                  {rs.status === "pending" && (
                    <Tooltip
                      tipPosition="top"
                      body={`Cannot start while ramp is pending.${
                        rs.targets.find(
                          (t) => t.activatingRevisionVersion != null,
                        )?.activatingRevisionVersion != null
                          ? ` Publish Revision ${rs.targets.find((t) => t.activatingRevisionVersion != null)?.activatingRevisionVersion} first.`
                          : ""
                      }`}
                    >
                      <div style={{ cursor: "not-allowed" }}>
                        <DropdownMenuItem disabled>Start now</DropdownMenuItem>
                      </div>
                    </Tooltip>
                  )}

                  {/* ready: Start now */}
                  {rs.status === "ready" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await apiCall(`/ramp-schedule/${rs.id}/actions/start`, {
                          method: "POST",
                        });
                        await mutate();
                      }}
                    >
                      Start now
                    </DropdownMenuItem>
                  )}

                  {/* Pause */}
                  {["running", "pending-approval"].includes(rs.status) && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await apiCall(`/ramp-schedule/${rs.id}/actions/pause`, {
                          method: "POST",
                        });
                        await mutate();
                      }}
                    >
                      Pause
                    </DropdownMenuItem>
                  )}

                  {/* Resume */}
                  {rs.status === "paused" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await apiCall(
                          `/ramp-schedule/${rs.id}/actions/resume`,
                          { method: "POST" },
                        );
                        await mutate();
                      }}
                    >
                      Resume
                    </DropdownMenuItem>
                  )}

                  {/* Complete + Reset + Jump — active (non-terminal) states only */}
                  {!["completed", "expired", "rolled-back"].includes(
                    rs.status,
                  ) && (
                    <>
                      <DropdownMenuItem
                        onClick={async () => {
                          await apiCall(
                            `/ramp-schedule/${rs.id}/actions/complete`,
                            { method: "POST" },
                          );
                          await mutate();
                        }}
                      >
                        Complete ramp up
                      </DropdownMenuItem>
                      {/* Roll back to > — backward targets only */}
                      {rs.currentStepIndex >= 0 &&
                        (() => {
                          const backSteps = rs.steps
                            .map((_, stepIdx) => stepIdx)
                            .filter((stepIdx) => stepIdx < rs.currentStepIndex);
                          return (
                            <DropdownSubMenu trigger="Roll back to">
                              <DropdownMenuItem
                                onClick={async () => {
                                  await apiCall(
                                    `/ramp-schedule/${rs.id}/actions/jump`,
                                    {
                                      method: "POST",
                                      body: JSON.stringify({
                                        targetStepIndex: -1,
                                      }),
                                    },
                                  );
                                  await mutate();
                                }}
                              >
                                Start
                              </DropdownMenuItem>
                              {backSteps.length > 0 && (
                                <DropdownMenuSeparator />
                              )}
                              {backSteps.map((stepIdx) => (
                                <DropdownMenuItem
                                  key={stepIdx}
                                  onClick={async () => {
                                    await apiCall(
                                      `/ramp-schedule/${rs.id}/actions/jump`,
                                      {
                                        method: "POST",
                                        body: JSON.stringify({
                                          targetStepIndex: stepIdx,
                                        }),
                                      },
                                    );
                                    await mutate();
                                  }}
                                >
                                  Step {stepIdx + 1}
                                </DropdownMenuItem>
                              ))}
                            </DropdownSubMenu>
                          );
                        })()}
                      {/* Jump ahead to > — forward targets only (End is already "Complete ramp up") */}
                      {rs.currentStepIndex < rs.steps.length - 1 && (
                        <DropdownSubMenu trigger="Jump ahead to">
                          {rs.steps
                            .map((_, stepIdx) => stepIdx)
                            .filter((stepIdx) => stepIdx > rs.currentStepIndex)
                            .map((stepIdx) => (
                              <DropdownMenuItem
                                key={stepIdx}
                                onClick={async () => {
                                  await apiCall(
                                    `/ramp-schedule/${rs.id}/actions/jump`,
                                    {
                                      method: "POST",
                                      body: JSON.stringify({
                                        targetStepIndex: stepIdx,
                                      }),
                                    },
                                  );
                                  await mutate();
                                }}
                              >
                                Step {stepIdx + 1}
                              </DropdownMenuItem>
                            ))}
                        </DropdownSubMenu>
                      )}
                    </>
                  )}

                  {/* Restart — terminal states */}
                  {["completed", "expired", "rolled-back"].includes(
                    rs.status,
                  ) && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await apiCall(`/ramp-schedule/${rs.id}/actions/reset`, {
                          method: "POST",
                        });
                        await mutate();
                      }}
                    >
                      Restart ramp
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator />

                  {/* Delete — blocked while running or pending-approval */}
                  {["running", "pending-approval"].includes(rs.status) ? (
                    <Tooltip
                      tipPosition="bottom"
                      body="Pause or complete the ramp before deleting."
                    >
                      <div style={{ cursor: "not-allowed" }}>
                        <DropdownMenuItem disabled color="red">
                          Delete
                        </DropdownMenuItem>
                      </div>
                    </Tooltip>
                  ) : (
                    <DropdownMenuItem
                      color="red"
                      onClick={() => onConfirmDelete(rs.id, rs.name)}
                    >
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenu>
              </Flex>
            </Flex>

            {/* Error callout for approve-step failures */}
            {approveErrors[rs.id] && (
              <Callout status="error" mb="2">
                <Flex justify="between" align="start" gap="3">
                  <Text>{approveErrors[rs.id]}</Text>
                  <Flex gap="2" flexShrink="0">
                    {approveErrors[rs.id]
                      .toLowerCase()
                      .includes("conflict") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const parts =
                            rs.pendingApprovalRevisionId?.split(":") ?? [];
                          const v = parseInt(parts[parts.length - 1], 10);
                          if (!isNaN(v)) onReviewDraft(v);
                        }}
                      >
                        Open draft
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setApproveErrors((prev) => ({ ...prev, [rs.id]: "" }))
                      }
                    >
                      Dismiss
                    </Button>
                  </Flex>
                </Flex>
              </Callout>
            )}

            {/* Row 2: Timeline nodes */}
            <RampTimeline
              rs={rs}
              hideHeader
              onEditTarget={(target) => {
                if (target.ruleId && target.environment) {
                  onEditTarget(target.environment, target.ruleId);
                }
              }}
            />
          </div>
        );
      })}
    </>
  );
}

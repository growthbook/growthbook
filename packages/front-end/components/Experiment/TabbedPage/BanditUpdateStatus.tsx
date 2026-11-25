import React, { ReactNode, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { isAutoSnapshotScheduled } from "shared/experiments";
import { BanditEvent } from "shared/validators";
import { ago, datetime, getValidDate } from "shared/dates";
import { PiCaretDown, PiWarningFill } from "react-icons/pi";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import RefreshBanditButton from "@/components/Experiment/RefreshBanditButton";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import Callout from "@/ui/Callout";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import styles from "./BanditUpdateStatus.module.scss";

function SectionLabel({ children, mt }: { children: ReactNode; mt?: "3" }) {
  return (
    <Box gridColumn="1 / -1" mt={mt} mb="1">
      <Text weight="semibold" color="text-high">
        {children}
      </Text>
    </Box>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <Text color="text-mid">{label}</Text>
      <Text color="text-high" whiteSpace="nowrap">
        {children}
      </Text>
    </>
  );
}

export default function BanditUpdateStatus({
  experiment,
  mutate,
  isPublic,
  ssrSnapshot,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutate?: () => void;
  isPublic?: boolean;
  ssrSnapshot?: ExperimentSnapshotInterface;
}) {
  const { t } = useLingui();
  const { latestSummary: _latest } = useSnapshot();
  const latest = _latest ?? ssrSnapshot;
  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const phase = experiment.phases?.[experiment.phases.length - 1];

  const lastEvent: BanditEvent | undefined =
    phase?.banditEvents?.[(phase?.banditEvents?.length ?? 0) - 1];
  const updateType = lastEvent?.banditResult?.reweight ? "reweight" : "refresh";

  let lastReweightEvent: BanditEvent | undefined = undefined;
  if (updateType === "refresh") {
    for (let i = phase?.banditEvents?.length || 0; i >= 0; i--) {
      const event = phase?.banditEvents?.[i];
      if (event?.banditResult?.reweight) {
        lastReweightEvent = event;
        break;
      }
    }
  }

  const start = getValidDate(
    experiment?.banditStageDateStarted ?? phase?.dateStarted,
  ).getTime();
  const burnInHoursMultiple = experiment.banditBurnInUnit === "days" ? 24 : 1;
  const burnInRunDate = getValidDate(
    start +
      (experiment?.banditBurnInValue ?? 0) *
        burnInHoursMultiple *
        60 *
        60 *
        1000,
  );

  const _error = !lastEvent?.banditResult
    ? t`Bandit update failed`
    : lastEvent?.banditResult?.error;

  const [error, setError] = useState<string | undefined>(_error);
  // Held open through a refresh: closing would drop its progress and let a
  // second one start.
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [generatedSnapshot, setGeneratedSnapshot] = useState<
    ExperimentSnapshotInterface | undefined
  >(undefined);

  const hasUpdated = (phase?.banditEvents?.length ?? 0) > 1;
  const isRunning = experiment.status === "running";
  const isExploring =
    !isPublic && isRunning && experiment.banditStage === "explore";
  const showScheduling =
    isRunning &&
    !isPublic &&
    ["explore", "exploit"].includes(experiment.banditStage ?? "");
  const queriesSnapshot = generatedSnapshot || latest;

  const never = (
    <Text size="inherit" fontStyle="italic">
      <Trans>never</Trans>
    </Text>
  );
  const scheduleValue = experiment.banditScheduleValue ?? "";
  const scheduleUnit = experiment.banditScheduleUnit;
  const burnInDate = datetime(burnInRunDate);
  const burnInAgo = ago(burnInRunDate);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next || !refreshing) setOpen(next);
      }}
      side="bottom"
      align="end"
      contentStyle={{ width: 380 }}
      trigger={
        <button type="button" className={styles.trigger}>
          <Flex as="span" direction="column" align="end">
            <Flex as="span" align="center" gap="1">
              {error && !isPublic ? (
                <PiWarningFill size={14} color="var(--red-9)" />
              ) : null}
              <Text size="sm" weight="semibold" color="text-mid">
                <Trans>last updated</Trans>
              </Text>
            </Flex>
            <Flex as="span" align="center" gap="1">
              <Tooltip
                content={
                  hasUpdated ? datetime(lastEvent?.date ?? "") : t`never`
                }
              >
                <Text size="sm" color="text-mid" whiteSpace="nowrap">
                  {hasUpdated ? ago(lastEvent?.date ?? "") : never}
                </Text>
              </Tooltip>
              <PiCaretDown size={12} />
            </Flex>
          </Flex>
        </button>
      }
      content={
        <Flex direction="column" gap="4">
          <Grid columns="auto 1fr" gapX="4" gapY="1">
            <SectionLabel>
              <Trans>Current update</Trans>
            </SectionLabel>
            <DetailRow label={t`Last updated at`}>
              {hasUpdated ? datetime(lastEvent?.date ?? "") : never}
            </DetailRow>
            {lastReweightEvent ? (
              <DetailRow label={t`Last weights updated`}>
                {datetime(lastReweightEvent.date)}
              </DetailRow>
            ) : null}
            {showScheduling && (
              <>
                <SectionLabel mt="3">
                  <Trans>Scheduling</Trans>
                </SectionLabel>
                <DetailRow label={t`Next scheduled update`}>
                  {experiment.nextSnapshotAttempt &&
                  isAutoSnapshotScheduled(experiment) ? (
                    ago(experiment.nextSnapshotAttempt)
                  ) : (
                    <Text size="inherit" fontStyle="italic">
                      <Trans>Not scheduled</Trans>
                    </Text>
                  )}
                </DetailRow>
              </>
            )}
            {!isPublic && (
              <DetailRow label={t`Current schedule`}>
                {scheduleUnit === "hours" ? (
                  <Trans>every {scheduleValue} hours</Trans>
                ) : scheduleUnit === "days" ? (
                  <Trans>every {scheduleValue} days</Trans>
                ) : (
                  <Trans>every {scheduleValue}</Trans>
                )}
              </DetailRow>
            )}
          </Grid>

          <Flex direction="column" gap="2">
            <Text as="div">
              {!isRunning ||
              !experiment.banditStage ||
              experiment.banditStage === "paused" ? (
                <Trans>The Bandit is not running.</Trans>
              ) : experiment.banditStage === "exploit" ? (
                <Trans>
                  The Bandit is in the{" "}
                  <Text size="inherit" weight="semibold">
                    Exploit
                  </Text>{" "}
                  stage.
                </Trans>
              ) : isExploring ? (
                <Trans>
                  The Bandit is in the{" "}
                  <Text size="inherit" weight="semibold">
                    Exploratory
                  </Text>{" "}
                  stage and is waiting until more data is collected.
                </Trans>
              ) : (
                <Trans>
                  The Bandit is in the{" "}
                  <Text size="inherit" weight="semibold">
                    Exploratory
                  </Text>{" "}
                  stage.
                </Trans>
              )}
            </Text>
            {isExploring && (
              <Text as="div">
                <Trans>
                  It will start updating weights and enter the Exploit stage on{" "}
                  <Text size="inherit" fontStyle="italic" whiteSpace="nowrap">
                    {burnInDate}
                  </Text>{" "}
                  ({burnInAgo}).
                </Trans>
              </Text>
            )}
          </Flex>

          {!isPublic && error ? (
            <Callout
              status="error"
              size="sm"
              action={
                queriesSnapshot ? (
                  <ViewAsyncQueriesButton
                    queries={queriesSnapshot.queries?.map((q) => q.query) ?? []}
                    error={queriesSnapshot.error}
                    status={status}
                    display={null}
                    color="link link-purple p-0 pb-1"
                    condensed={true}
                    hideQueryCount={true}
                  />
                ) : undefined
              }
            >
              {error}
            </Callout>
          ) : null}

          {!isPublic && isRunning && mutate && (
            <>
              <Separator size="4" />
              <RefreshBanditButton
                mutate={mutate}
                experiment={experiment}
                setError={setError}
                setGeneratedSnapshot={setGeneratedSnapshot}
                onLoadingChange={setRefreshing}
              />
            </>
          )}
        </Flex>
      }
    />
  );
}

import React, { ReactNode, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { BanditEvent } from "shared/validators";
import { ago, datetime, getValidDate } from "shared/dates";
import { upperFirst } from "lodash";
import { PiCaretDown, PiWarningFill } from "react-icons/pi";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
import RefreshBanditButton from "@/components/Experiment/RefreshBanditButton";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import Callout from "@/ui/Callout";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
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
    ? "Bandit update failed"
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
      never
    </Text>
  );

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
                last updated
              </Text>
            </Flex>
            <Flex as="span" align="center" gap="1">
              <Text
                size="sm"
                color="text-mid"
                whiteSpace="nowrap"
                title={hasUpdated ? datetime(lastEvent?.date ?? "") : "never"}
              >
                {hasUpdated ? ago(lastEvent?.date ?? "") : never}
              </Text>
              <PiCaretDown size={12} />
            </Flex>
          </Flex>
        </button>
      }
      content={
        <Flex direction="column" gap="4">
          <Grid columns="auto 1fr" gapX="4" gapY="1">
            <SectionLabel>Current update</SectionLabel>
            <DetailRow label="Last updated at">
              {hasUpdated ? datetime(lastEvent?.date ?? "") : never}
            </DetailRow>
            {lastReweightEvent ? (
              <DetailRow label="Last weights updated">
                {datetime(lastReweightEvent.date)}
              </DetailRow>
            ) : null}
            {showScheduling && (
              <>
                <SectionLabel mt="3">Scheduling</SectionLabel>
                <DetailRow label="Next scheduled update">
                  {experiment.nextSnapshotAttempt &&
                  experiment.autoSnapshots &&
                  !experiment.disableAutoSnapshots ? (
                    ago(experiment.nextSnapshotAttempt)
                  ) : (
                    <Text size="inherit" fontStyle="italic">
                      Not scheduled
                    </Text>
                  )}
                </DetailRow>
              </>
            )}
            {!isPublic && (
              <DetailRow label="Current schedule">
                every {experiment.banditScheduleValue ?? ""}{" "}
                {experiment.banditScheduleUnit ?? ""}
              </DetailRow>
            )}
          </Grid>

          <Flex direction="column" gap="2">
            <Text as="div">
              The Bandit is{" "}
              {isRunning &&
              experiment.banditStage &&
              experiment.banditStage !== "paused" ? (
                <>
                  in the{" "}
                  <Text size="inherit" weight="semibold">
                    {experiment.banditStage === "explore"
                      ? "Exploratory"
                      : upperFirst(experiment.banditStage)}
                  </Text>{" "}
                  stage
                </>
              ) : (
                "not running"
              )}
              {isExploring && <> and is waiting until more data is collected</>}
              .
            </Text>
            {isExploring && (
              <Text as="div">
                It will start updating weights and enter the Exploit stage on{" "}
                <Text size="inherit" fontStyle="italic" whiteSpace="nowrap">
                  {datetime(burnInRunDate)}
                </Text>{" "}
                ({ago(burnInRunDate)}).
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

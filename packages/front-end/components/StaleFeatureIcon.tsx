import { useState, useEffect } from "react";
import { OLD_TEMP_ROLLOUT_DAYS, StaleFeatureReason } from "shared/util";
import { FeatureValueType } from "shared/types/feature";
import { ago } from "shared/dates";
import { PiArrowClockwise } from "react-icons/pi";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
// eslint-disable-next-line no-restricted-imports
import { Badge, Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import { Popover } from "@/ui/Popover";
import Modal from "@/components/Modal";
import ValueDisplay from "@/components/Features/ValueDisplay";
import LoadingSpinner from "@/components/LoadingSpinner";
import { FeatureHealthStateEntry } from "@/hooks/useFeatureHealthStates";
import { useIncrementer } from "@/hooks/useIncrementer";
import { isPartiallyStale } from "@/services/health";
import { ExperimentDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import styles from "./StaleFeatureIcon.module.scss";

const staleReasonToMessageMap: Record<StaleFeatureReason, MessageDescriptor> = {
  "never-stale": msg`Stale detection is disabled.`,
  "recently-updated": msg`Updated within the last two weeks.`,
  "active-draft": msg`Active draft in progress.`,
  "has-dependents": msg`Used by a non-stale dependent feature or experiment.`,
  "no-rules": msg`No rules defined.`,
  "rules-one-sided": msg`All reachable rules are one-sided.`,
  "abandoned-draft": msg`Draft not updated in over a month.`,
  "toggled-off": msg`Environment is disabled.`,
  "active-experiment": msg`Live experiment rule in this environment.`,
  "temp-rollout": msg`Temp rollout from a recently stopped experiment.`,
  "old-temp-rollout": msg`Only serves a temp rollout from an experiment stopped ${OLD_TEMP_ROLLOUT_DAYS}+ days ago.`,
  "has-rules": msg`Has rules with targeting conditions.`,
  error: msg`Error evaluating staleness.`,
};

function VerdictChip({
  color,
  label,
}: {
  color: "yellow" | "green" | "gray";
  label: string;
}) {
  return (
    <Flex gap="1" align="center" style={{ whiteSpace: "nowrap" }}>
      <ExperimentDot color={color} />
      {label}
    </Flex>
  );
}

export default function StaleFeatureIcon({
  neverStale,
  valueType,
  staleData,
  fetchStaleData,
  onDisable,
  context = "detail",
  open: controlledOpen,
  onOpenChange,
}: {
  neverStale?: boolean;
  valueType?: FeatureValueType;
  staleData?: FeatureHealthStateEntry;
  fetchStaleData?: () => Promise<void>;
  onDisable?: () => void;
  context?: "list" | "detail";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  const [rerunning, setRerunning] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [, tick] = useIncrementer();
  useEffect(() => {
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [tick]);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };

  // neverStale can be known from the feature prop before staleData loads
  const effectiveNeverStale = neverStale ?? staleData?.neverStale ?? false;

  const neverStaleContent = (
    <Box>
      <Flex direction="column" gap="4">
        <Box>
          <span style={{ color: "var(--gray-11)" }}>
            <Text size="lg" weight="semibold">
              <Trans>Stale detection off</Trans>
            </Text>
          </span>
          <Text as="div" size="md" color="text-low" mt="1">
            <Trans>Stale detection is disabled for this feature.</Trans>
          </Text>
        </Box>
      </Flex>
      {onDisable && (
        <Flex justify="end" mt="4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(false);
              onDisable();
            }}
          >
            <Trans>Enable stale detection</Trans>
          </Button>
        </Flex>
      )}
    </Box>
  );

  // Show the permanent badge immediately — no staleData needed
  if (effectiveNeverStale) {
    if (context === "list") {
      return (
        <Popover
          open={open}
          onOpenChange={setOpen}
          side="bottom"
          align="start"
          showArrow={true}
          contentStyle={{ maxWidth: 600, textAlign: "left" }}
          trigger={
            <span className={styles.listTrigger}>
              <VerdictChip color="gray" label={t`Stale detection off`} />
            </span>
          }
          content={neverStaleContent}
        />
      );
    }

    return (
      <>
        <Badge
          color="green"
          variant="soft"
          radius="full"
          size="2"
          className={styles.freshBadge}
          onClick={() => setOpen(true)}
        >
          <Trans>Stale detection off</Trans>
        </Badge>
        {open && (
          <Modal
            open={open}
            close={() => setOpen(false)}
            header={t`Stale Status`}
            trackingEventModalType="stale-feature-status"
            closeCta={t`Close`}
          >
            {neverStaleContent}
          </Modal>
        )}
      </>
    );
  }

  if (!staleData) {
    const loadingContent = (
      <Box>
        <LoadingSpinner />
      </Box>
    );
    if (context === "list") {
      return (
        <span style={{ whiteSpace: "nowrap" }}>
          <Text size="sm" color="text-low">
            <Trans>Computing staleness…</Trans>
          </Text>
        </span>
      );
    }
    return (
      <>
        <Badge
          color="gray"
          variant="soft"
          radius="full"
          size="2"
          className={styles.permanentBadge}
          onClick={() => setOpen(true)}
        >
          —
        </Badge>
        {open && (
          <Modal
            open={open}
            close={() => setOpen(false)}
            header={t`Stale Status`}
            trackingEventModalType="stale-feature-status"
            closeCta={t`Close`}
          >
            {loadingContent}
          </Modal>
        )}
      </>
    );
  }

  const staleReason: StaleFeatureReason | undefined = staleData.reason;
  const envResults = staleData.envResults ?? {};
  const computedAt = staleData.computedAt;

  const mixed = isPartiallyStale(staleData);

  const envEntries = Object.entries(envResults);
  const computedAgo = computedAt ? ago(new Date(computedAt)) : null;
  // Reasons the map doesn't know show as they came.
  const reasonText = (reason: string) => {
    const reasonMessage = staleReasonToMessageMap[reason as StaleFeatureReason];
    return reasonMessage ? i18n._(reasonMessage) : reason;
  };

  const handleRerun = fetchStaleData
    ? async () => {
        setRerunning(true);
        try {
          await fetchStaleData();
        } finally {
          setRerunning(false);
        }
      }
    : undefined;

  const body = (
    <Box>
      <Flex direction="column" gap="4">
        <Box>
          <Text
            as="div"
            size="sm"
            weight="semibold"
            color="text-mid"
            textTransform="uppercase"
            mb="1"
          >
            <Trans>Overall Status</Trans>
          </Text>
          {staleData.stale ? (
            <span style={{ color: "var(--yellow-11)" }}>
              <Text size="lg" weight="semibold">
                <Trans>Stale</Trans>
              </Text>
            </span>
          ) : (
            <span style={{ color: "var(--green-10)" }}>
              <Text size="lg" weight="semibold">
                <Trans>Not stale</Trans>
              </Text>
              {mixed && (
                <Text as="div" size="md" color="text-low" mt="1">
                  <Trans>
                    Some environments are stale. See the breakdown below.
                  </Trans>
                </Text>
              )}
            </span>
          )}
        </Box>

        {staleReason && (
          <Box>
            <Text
              as="div"
              size="sm"
              weight="semibold"
              color="text-mid"
              textTransform="uppercase"
              mb="1"
            >
              <Trans>Reason</Trans>
            </Text>
            <Text size="md" as="div">
              {i18n._(staleReasonToMessageMap[staleReason])}
            </Text>
          </Box>
        )}

        {envEntries.length > 0 && (
          <Box mt="4">
            <Text
              as="div"
              size="sm"
              weight="semibold"
              color="text-mid"
              textTransform="uppercase"
            >
              <Trans>Environment Statuses</Trans>
            </Text>

            <Box mt="2" style={{ maxHeight: 300, overflowY: "auto" }}>
              <table
                className="table table-sm table-valign-top"
                style={{ tableLayout: "fixed", width: "100%" }}
              >
                <thead>
                  <tr>
                    <th style={{ width: "20%" }} />
                    <th style={{ width: "15%" }}>
                      <Trans>Status</Trans>
                    </th>
                    <th style={{ width: "25%" }}>
                      <Trans>Reason</Trans>
                    </th>
                    <th>
                      <Trans>Evaluates to</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {envEntries.map(([envId, info]) => (
                    <tr key={envId} style={{ verticalAlign: "top" }}>
                      <td style={{ overflow: "hidden" }}>
                        <Text size="md" weight="medium" truncate title={envId}>
                          {envId}
                        </Text>
                      </td>
                      <td>
                        {info.stale ? (
                          <span style={{ color: "var(--yellow-11)" }}>
                            <Text weight="semibold">
                              <Trans>Stale</Trans>
                            </Text>
                          </span>
                        ) : (
                          <span style={{ color: "var(--green-10)" }}>
                            <Text weight="semibold">
                              <Trans>Not Stale</Trans>
                            </Text>
                          </span>
                        )}
                      </td>
                      <td>
                        <Text size="sm" color="text-mid">
                          {info.reason ? reasonText(info.reason) : null}
                        </Text>
                      </td>
                      <td>
                        {info.evaluatesTo !== undefined &&
                          (info.reason === "toggled-off" || !valueType) && (
                            <span
                              style={{
                                fontFamily: "var(--code-font-family)",
                                fontSize: "0.85em",
                              }}
                            >
                              {info.evaluatesTo}
                            </span>
                          )}
                        {info.evaluatesTo !== undefined &&
                          info.reason !== "toggled-off" &&
                          valueType && (
                            <ValueDisplay
                              value={info.evaluatesTo}
                              type={valueType}
                              fullStyle={{
                                maxHeight: 80,
                                overflowY: "auto",
                                maxWidth: "100%",
                              }}
                            />
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Box>
        )}
      </Flex>
      {(handleRerun || onDisable || computedAt) && (
        <Flex direction="column" align="end" gap="2" mt="2">
          {computedAt && (
            <Text size="sm" color="text-low">
              <Trans>Last calculated: {computedAgo}</Trans>
            </Text>
          )}
          {(handleRerun || onDisable) && (
            <Flex gap="2">
              {handleRerun && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleRerun}
                  disabled={rerunning}
                >
                  {rerunning ? <LoadingSpinner /> : <PiArrowClockwise />}{" "}
                  <Trans>Re-run</Trans>
                </Button>
              )}
              {onDisable && (
                <Button
                  size="sm"
                  color="red"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    onDisable();
                  }}
                >
                  <Trans>Disable stale detection</Trans>
                </Button>
              )}
            </Flex>
          )}
        </Flex>
      )}
    </Box>
  );

  const badgeColor = staleData.stale ? "yellow" : "green";
  const badgeClass = staleData.stale ? styles.staleBadge : styles.freshBadge;
  const label = staleData.stale
    ? t`Stale`
    : mixed
      ? t`Not stale*`
      : t`Not stale`;

  if (context === "list") {
    return (
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        align="start"
        showArrow={true}
        contentStyle={{ maxWidth: 600, textAlign: "left" }}
        trigger={
          <span className={styles.listTrigger}>
            <VerdictChip
              color={staleData.stale ? "yellow" : "green"}
              label={label}
            />
          </span>
        }
        content={body}
      />
    );
  }

  return (
    <>
      <Badge
        color={badgeColor}
        variant="soft"
        radius="full"
        size="2"
        className={badgeClass}
        onClick={() => setOpen(true)}
      >
        {label}
      </Badge>
      {open && (
        <Modal
          open={open}
          close={() => setOpen(false)}
          header={t`Stale Status`}
          trackingEventModalType="stale-feature-status"
          closeCta={t`Close`}
          size="lg"
        >
          {body}
        </Modal>
      )}
    </>
  );
}

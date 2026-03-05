import { useState, useEffect } from "react";
import { StaleFeatureReason } from "shared/util";
import { FeatureValueType } from "shared/types/feature";
import { ago } from "shared/dates";
import { PiArrowClockwise } from "react-icons/pi";
// eslint-disable-next-line no-restricted-imports
import { Badge, Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import { Popover } from "@/ui/Popover";
import Modal from "@/components/Modal";
import ValueDisplay from "@/components/Features/ValueDisplay";
import LoadingSpinner from "@/components/LoadingSpinner";
import { StaleStateEntry } from "@/hooks/useFeatureStaleStates";
import { useIncrementer } from "@/hooks/useIncrementer";
import styles from "./StaleFeatureIcon.module.scss";

const staleReasonToMessageMap: Record<StaleFeatureReason, string> = {
  "never-stale": "Stale detection is disabled.",
  "recently-updated": "Updated within the last two weeks.",
  "active-draft": "Active draft in progress.",
  "has-dependents": "Used by a non-stale dependent feature or experiment.",
  "no-rules": "No rules defined.",
  "rules-one-sided": "All reachable rules are one-sided.",
  "abandoned-draft": "Draft not updated in over a month.",
  "toggled-off": "Environment is disabled.",
  "active-experiment": "Live experiment rule in this environment.",
  "has-rules": "Has rules with targeting conditions.",
  error: "Error evaluating staleness.",
};

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
  staleData?: StaleStateEntry;
  fetchStaleData?: () => Promise<void>;
  onDisable?: () => void;
  context?: "list" | "detail";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
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
            <Text size="large" weight="semibold">
              Detection Off
            </Text>
          </span>
          <Text as="div" size="medium" color="text-low" mt="1">
            Stale detection is disabled for this feature.
          </Text>
        </Box>
      </Flex>
      {onDisable && (
        <Flex justify="end" mt="4">
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setOpen(false);
              onDisable();
            }}
          >
            Enable stale detection
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
            <span
              className={styles.listTrigger}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span className={`${styles.dot} ${styles.permanentDot}`} />
              Off
            </span>
          }
          content={neverStaleContent}
        />
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
          Stale detection off
        </Badge>
        <Modal
          open={open}
          close={() => setOpen(false)}
          header="Stale Status"
          trackingEventModalType="stale-feature-status"
          closeCta="Close"
          useRadixButton={true}
        >
          {neverStaleContent}
        </Modal>
      </>
    );
  }

  if (!staleData) return null;

  const isStale = staleData.stale;
  const staleReason: StaleFeatureReason | undefined = staleData.reason;
  const envResults = staleData.envResults ?? {};
  const computedAt = staleData.computedAt;

  const hasSomeStaleEnvs = Object.values(envResults).some((e) => e.stale);
  const mixed = !isStale && hasSomeStaleEnvs;

  const envEntries = Object.entries(envResults);

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
            size="small"
            weight="semibold"
            color="text-mid"
            textTransform="uppercase"
            mb="1"
          >
            Overall Status
          </Text>
          {isStale ? (
            <span style={{ color: "var(--yellow-11)" }}>
              <Text size="large" weight="semibold">
                Stale
              </Text>
            </span>
          ) : (
            <span style={{ color: "var(--green-10)" }}>
              <Text size="large" weight="semibold">
                Not Stale
              </Text>
              {mixed && (
                <Text as="div" size="medium" color="text-low" mt="1">
                  Some environments may be stale
                </Text>
              )}
            </span>
          )}
        </Box>

        {staleReason && (
          <Box>
            <Text
              as="div"
              size="small"
              weight="semibold"
              color="text-mid"
              textTransform="uppercase"
              mb="1"
            >
              Reason
            </Text>
            <Text size="medium" as="div">
              {staleReasonToMessageMap[staleReason]}
            </Text>
          </Box>
        )}

        {envEntries.length > 0 && (
          <Box mt="4">
            <Text
              as="div"
              size="small"
              weight="semibold"
              color="text-mid"
              textTransform="uppercase"
            >
              Environment Statuses
            </Text>

            <Box mt="2" style={{ maxHeight: 300, overflowY: "auto" }}>
              <table
                className="table table-sm table-valign-top"
                style={{ tableLayout: "fixed", width: "100%" }}
              >
                <thead>
                  <tr>
                    <th style={{ width: "20%" }} />
                    <th style={{ width: "15%" }}>Status</th>
                    <th style={{ width: "25%" }}>Reason</th>
                    <th>Evaluates to</th>
                  </tr>
                </thead>
                <tbody>
                  {envEntries.map(([envId, info]) => (
                    <tr key={envId} style={{ verticalAlign: "top" }}>
                      <td style={{ overflow: "hidden" }}>
                        <Text
                          size="medium"
                          weight="medium"
                          truncate
                          title={envId}
                        >
                          {envId}
                        </Text>
                      </td>
                      <td>
                        {info.stale ? (
                          <span style={{ color: "var(--yellow-11)" }}>
                            <Text weight="semibold">Stale</Text>
                          </span>
                        ) : (
                          <span style={{ color: "var(--green-10)" }}>
                            <Text weight="semibold">Not Stale</Text>
                          </span>
                        )}
                      </td>
                      <td>
                        <Text size="small" color="text-mid">
                          {info.reason
                            ? (staleReasonToMessageMap[
                                info.reason as StaleFeatureReason
                              ] ?? info.reason)
                            : null}
                        </Text>
                      </td>
                      <td>
                        {info.evaluatesTo !== undefined &&
                          (info.reason === "toggled-off" || !valueType) && (
                            <span
                              style={{
                                fontFamily: "monospace",
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
            <Text size="small" color="text-low">
              Last calculated: {ago(new Date(computedAt))}
            </Text>
          )}
          {(handleRerun || onDisable) && (
            <Flex gap="2">
              {handleRerun && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={handleRerun}
                  disabled={rerunning}
                >
                  {rerunning ? <LoadingSpinner /> : <PiArrowClockwise />} Re-run
                </Button>
              )}
              {onDisable && (
                <Button
                  size="xs"
                  color="red"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    onDisable();
                  }}
                >
                  Disable stale detection
                </Button>
              )}
            </Flex>
          )}
        </Flex>
      )}
    </Box>
  );

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
          <span
            className={styles.listTrigger}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span
              className={`${styles.dot} ${isStale ? styles.staleDot : mixed ? styles.mixedDot : styles.freshDot}`}
            />
            {isStale ? "Stale" : mixed ? "Not Stale*" : "Not stale"}
          </span>
        }
        content={body}
      />
    );
  }

  return (
    <>
      <Badge
        color={isStale ? "yellow" : "green"}
        variant="soft"
        radius="full"
        size="2"
        className={isStale ? styles.staleBadge : styles.freshBadge}
        onClick={() => setOpen(true)}
      >
        {isStale ? "Stale" : mixed ? "Not Stale*" : "Not stale"}
      </Badge>
      <Modal
        open={open}
        close={() => setOpen(false)}
        header="Stale Status"
        trackingEventModalType="stale-feature-status"
        closeCta="Close"
        size="lg"
        useRadixButton={true}
      >
        {body}
      </Modal>
    </>
  );
}

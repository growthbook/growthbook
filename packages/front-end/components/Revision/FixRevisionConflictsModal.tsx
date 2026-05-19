import { useState, useMemo } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import Collapsible from "react-collapsible";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { PiCheckBold, PiGitMergeBold } from "react-icons/pi";
import {
  Revision,
  checkMergeConflicts,
  Conflict,
  normalizeProposedChanges,
  patchOpsToPartial,
} from "shared/enterprise";
import { isEqual } from "lodash";
import { Box, Flex, Grid } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import { useAuth } from "@/services/auth";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import Callout from "@/ui/Callout";

export interface Props {
  revision: Revision;
  currentState: Record<string, unknown>;
  close: () => void;
  mutate: () => void | Promise<void>;
}

type MergeStrategy = "discard" | "overwrite" | "";

export function ExpandableConflict({
  conflict,
  strategy,
  setStrategy,
}: {
  conflict: Conflict;
  strategy: MergeStrategy;
  setStrategy: (strategy: MergeStrategy) => void;
}) {
  const [open, setOpen] = useState(true);

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return String(value);
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    return JSON.stringify(value, null, 2);
  };

  const baseStr = formatValue(conflict.baseValue);
  const liveStr = formatValue(conflict.liveValue);
  const proposedStr = formatValue(conflict.proposedValue);

  return (
    <Box
      className="diff-wrapper"
      mb="4"
      style={{
        border: "1px solid var(--gray-a6)",
        overflow: "hidden",
      }}
    >
      <Flex
        align="center"
        gap="2"
        px="3"
        py="2"
        style={{
          cursor: "pointer",
          borderBottom: "1px solid var(--gray-a6)",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        {strategy && (
          <span style={{ color: "var(--green-9)", lineHeight: 1 }}>
            <PiCheckBold size={20} />
          </span>
        )}
        <Text color="text-low" whiteSpace="nowrap">
          Conflict:
        </Text>
        <Text weight="semibold">{conflict.field}</Text>
        <Box ml="auto">{open ? <FaAngleDown /> : <FaAngleRight />}</Box>
      </Flex>

      <Collapsible
        open={open}
        trigger=""
        triggerDisabled
        transitionTime={250}
        easing="ease-out"
      >
        <Box style={{ background: "var(--color-surface)" }}>
          {/* External Change vs Your Change columns */}
          <Grid columns="2">
            <Box
              px="3"
              pt="2"
              pb="3"
              style={{ borderRight: "1px solid var(--gray-a5)" }}
            >
              <Flex align="center" justify="between" gap="2" mb="2">
                <Flex align="center" gap="2" wrap="wrap">
                  <Heading as="h4" size="x-small" mb="0">
                    External Change
                  </Heading>
                  <Text size="small" color="text-low">
                    The change that is currently live
                  </Text>
                </Flex>
                <Button
                  size="sm"
                  variant={strategy === "discard" ? "solid" : "outline"}
                  style={{ flexShrink: 0 }}
                  preventDefault
                  onClick={() => {
                    setStrategy("discard");
                    setTimeout(() => setOpen(false), 50);
                  }}
                >
                  Use External Change
                </Button>
              </Flex>
              <ReactDiffViewer
                oldValue={baseStr}
                newValue={liveStr}
                compareMethod={DiffMethod.LINES}
                styles={COMPACT_DIFF_STYLES}
              />
            </Box>
            <Box px="3" pt="2" pb="3">
              <Flex align="center" justify="between" gap="2" mb="2">
                <Flex align="center" gap="2" wrap="wrap">
                  <Heading as="h4" size="x-small" mb="0">
                    Your Change
                  </Heading>
                  <Text size="small" color="text-low">
                    The change in this draft
                  </Text>
                </Flex>
                <Button
                  size="sm"
                  variant={strategy === "overwrite" ? "solid" : "outline"}
                  style={{ flexShrink: 0 }}
                  preventDefault
                  onClick={() => {
                    setStrategy("overwrite");
                    setTimeout(() => setOpen(false), 250);
                  }}
                >
                  Use My Change
                </Button>
              </Flex>
              <ReactDiffViewer
                oldValue={baseStr}
                newValue={proposedStr}
                compareMethod={DiffMethod.LINES}
                styles={COMPACT_DIFF_STYLES}
              />
            </Box>
          </Grid>
        </Box>
      </Collapsible>
    </Box>
  );
}

export default function FixRevisionConflictsModal({
  revision,
  currentState,
  close,
  mutate,
}: Props) {
  const { apiCall } = useAuth();

  const [strategies, setStrategies] = useState<Record<string, MergeStrategy>>(
    {},
  );
  const [step, setStep] = useState(0);

  const baseSnapshot = revision.target.snapshot as Record<string, unknown>;
  const proposedChanges = normalizeProposedChanges(
    revision.target.proposedChanges,
  );
  const liveSnapshot = currentState;

  // Raw output of checkMergeConflicts. We send this (not the wrapper below) as
  // the optimistic-lock payload to /rebase, because the server recomputes the
  // same shape and compares via JSON.stringify — the two must match byte-for-byte.
  const rawConflictCheck = useMemo(
    () => checkMergeConflicts(baseSnapshot, liveSnapshot, proposedChanges),
    [baseSnapshot, liveSnapshot, proposedChanges],
  );

  const mergeResult = useMemo(() => {
    const proposedAsPartial =
      patchOpsToPartial<Record<string, unknown>>(proposedChanges);

    const conflicts = rawConflictCheck.conflicts || [];
    const resolvedChanges: Record<string, unknown> = { ...liveSnapshot };
    const unresolvedConflicts: Conflict[] = [];

    conflicts.forEach((conflict) => {
      const strategy = strategies[conflict.field];
      if (strategy === "overwrite") {
        if (conflict.proposedValue != null) {
          resolvedChanges[conflict.field] = conflict.proposedValue;
        }
      } else if (strategy === "discard") {
        // Keep the live value — no-op
      } else {
        unresolvedConflicts.push(conflict);
      }
    });

    // Include non-conflicting proposed changes
    Object.entries(proposedAsPartial).forEach(([field, value]) => {
      if (value != null && !conflicts.find((c) => c.field === field)) {
        resolvedChanges[field] = value;
      }
    });

    // Calculate new proposed changes relative to live state
    const newProposedChanges: Record<string, unknown> = {};
    Object.keys(resolvedChanges).forEach((field) => {
      const value = resolvedChanges[field];
      if (value != null && !isEqual(value, liveSnapshot[field])) {
        newProposedChanges[field] = value;
      }
    });

    return {
      success: unresolvedConflicts.length === 0,
      conflicts,
      resolvedChanges:
        unresolvedConflicts.length === 0 ? resolvedChanges : undefined,
      newProposedChanges:
        unresolvedConflicts.length === 0 ? newProposedChanges : undefined,
    };
  }, [liveSnapshot, proposedChanges, rawConflictCheck, strategies]);

  const hasChanges =
    mergeResult.newProposedChanges &&
    Object.keys(mergeResult.newProposedChanges).length > 0;

  if (!mergeResult.conflicts.length) return null;

  return (
    <PagedModal
      trackingEventModalType="resolve-revision-conflicts"
      header="Resolve Conflicts"
      step={step}
      setStep={setStep}
      submit={async () => {
        try {
          await apiCall(`/revision/${revision.id}/rebase`, {
            method: "POST",
            body: JSON.stringify({
              // Must match the server's checkMergeConflicts() output exactly,
              // not the wrapper mergeResult object used for UI state above.
              mergeResultSerialized: JSON.stringify(rawConflictCheck),
              strategies,
            }),
          });
        } catch (e) {
          await mutate();
          throw e;
        }
        await mutate();
      }}
      cta={step === 1 ? "Update Draft" : "Next"}
      ctaEnabled={!!mergeResult.success}
      close={close}
      closeCta="Cancel"
      size="max"
      useRadixButton={true}
    >
      <Page
        display="Fix Conflicts"
        enabled
        validate={async () => {
          if (!mergeResult?.success) {
            throw new Error("Please resolve all conflicts first");
          }
        }}
      >
        <Box mb="4" style={{ maxWidth: 800, margin: "0 auto var(--space-4)" }}>
          <Callout
            status="info"
            contentsAs="div"
            icon={<PiGitMergeBold size={18} />}
          >
            <Text as="p">
              Conflicting changes have been published since you created this
              revision. Resolve each conflict below, then click{" "}
              <Text as="span" weight="medium">
                Update Draft
              </Text>{" "}
              to rebase your draft onto the current live version.
            </Text>
          </Callout>
        </Box>

        <Flex justify="center" gap="3" mb="4" wrap="wrap">
          <Button
            variant="outline"
            onClick={() => {
              const newStrategies: Record<string, MergeStrategy> = {};
              mergeResult.conflicts.forEach((conflict) => {
                newStrategies[conflict.field] = "discard";
              });
              setStrategies(newStrategies);
            }}
          >
            Use All External Changes
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const newStrategies: Record<string, MergeStrategy> = {};
              mergeResult.conflicts.forEach((conflict) => {
                newStrategies[conflict.field] = "overwrite";
              });
              setStrategies(newStrategies);
            }}
          >
            Use All My Changes
          </Button>
        </Flex>

        {mergeResult.conflicts.map((conflict) => (
          <ExpandableConflict
            conflict={conflict}
            key={conflict.field}
            strategy={strategies[conflict.field] || ""}
            setStrategy={(strategy) => {
              setStrategies({
                ...strategies,
                [conflict.field]: strategy,
              });
            }}
          />
        ))}
      </Page>

      <Page display="Review Changes">
        <Box mb="4" style={{ maxWidth: 800, margin: "0 auto var(--space-4)" }}>
          <Callout
            status="info"
            contentsAs="div"
            icon={<PiGitMergeBold size={18} />}
          >
            <Text as="p">
              Almost done — your revision has been successfully rebased onto the
              current live version. Review the changes below, then click{" "}
              <Text as="span" weight="semibold">
                Update Draft
              </Text>{" "}
              to apply them.
            </Text>
          </Callout>
        </Box>
        {hasChanges ? (
          <Flex direction="column" gap="4">
            <Box mb="3">
              <Text weight="semibold">Fields changed:</Text>
              <Flex direction="column" gap="5" mt="2">
                {Object.keys(mergeResult.newProposedChanges || {}).map(
                  (field) => {
                    const formatValue = (value: unknown): string => {
                      if (value === null || value === undefined)
                        return String(value);
                      if (typeof value === "string") return value;
                      if (
                        typeof value === "number" ||
                        typeof value === "boolean"
                      )
                        return String(value);
                      return JSON.stringify(value, null, 2);
                    };

                    return (
                      <Box key={field}>
                        <Text weight="semibold" size="large">
                          {field}
                        </Text>
                        <Box className="diff-wrapper" mt="2">
                          <ReactDiffViewer
                            oldValue={formatValue(liveSnapshot[field])}
                            newValue={formatValue(
                              mergeResult.newProposedChanges![field],
                            )}
                            compareMethod={DiffMethod.LINES}
                            styles={COMPACT_DIFF_STYLES}
                            splitView={true}
                          />
                        </Box>
                      </Box>
                    );
                  },
                )}
              </Flex>
            </Box>
          </Flex>
        ) : (
          <Text as="p" color="text-low">
            Your revision and the live version are identical.
          </Text>
        )}
      </Page>
    </PagedModal>
  );
}

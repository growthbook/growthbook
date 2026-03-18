import { useState, useMemo } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import Collapsible from "react-collapsible";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { PiCheckBold, PiGitMergeBold } from "react-icons/pi";
import { Revision, checkMergeConflicts, Conflict } from "shared/enterprise";
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
  mutate: () => void;
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

  // Format values for display - handle different types appropriately
  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return String(value);
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    // For objects and arrays, pretty-print as JSON
    return JSON.stringify(value, null, 2);
  };

  const baseStr = formatValue(conflict.baseValue);
  const liveStr = formatValue(conflict.liveValue);
  const proposedStr = formatValue(conflict.proposedValue);

  return (
    <div
      className="diff-wrapper mb-4"
      style={{
        border: "1px solid var(--gray-a6)",
        overflow: "hidden",
      }}
    >
      <div
        className="list-group-item list-group-item-action d-flex align-items-center"
        style={{
          cursor: "pointer",
          gap: "0.5rem",
          border: "none",
          borderBottom: "1px solid var(--gray-a6)",
          borderRadius: 0,
        }}
        onClick={() => setOpen((o) => !o)}
      >
        {strategy && (
          <span style={{ color: "var(--green-9)", lineHeight: 1 }}>
            <PiCheckBold size={20} />
          </span>
        )}
        <span className="text-muted" style={{ whiteSpace: "nowrap" }}>
          Conflict:
        </span>
        <strong>{conflict.field}</strong>
        <div className="ml-auto">
          {open ? <FaAngleDown /> : <FaAngleRight />}
        </div>
      </div>

      <Collapsible
        open={open}
        trigger=""
        triggerDisabled
        transitionTime={250}
        easing="ease-out"
      >
        <div className="p-0" style={{ background: "var(--color-surface)" }}>
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
        </div>
      </Collapsible>
    </div>
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
  const proposedChanges = revision.target.proposedChanges as Record<
    string,
    unknown
  >;
  const liveSnapshot = currentState;

  const mergeResult = useMemo(() => {
    const conflictCheck = checkMergeConflicts(
      baseSnapshot,
      liveSnapshot,
      proposedChanges,
    );

    const conflicts = conflictCheck.conflicts || [];
    const resolvedChanges: Record<string, unknown> = { ...liveSnapshot };
    const unresolvedConflicts: Conflict[] = [];

    conflicts.forEach((conflict) => {
      const strategy = strategies[conflict.field];
      if (strategy === "overwrite") {
        resolvedChanges[conflict.field] = conflict.proposedValue;
      } else if (strategy === "discard") {
        // Keep the live value
      } else {
        unresolvedConflicts.push(conflict);
      }
    });

    Object.keys(proposedChanges).forEach((field) => {
      if (!conflicts.find((c) => c.field === field)) {
        resolvedChanges[field] = proposedChanges[field];
      }
    });

    const newProposedChanges: Record<string, unknown> = {};
    Object.keys(resolvedChanges).forEach((field) => {
      if (!isEqual(resolvedChanges[field], liveSnapshot[field])) {
        newProposedChanges[field] = resolvedChanges[field];
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
  }, [baseSnapshot, liveSnapshot, proposedChanges, strategies]);

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
              mergeResultSerialized: JSON.stringify(mergeResult),
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
              revision. Your draft is based on an older version of the saved
              group, but the live version has since been updated with
              conflicting changes.
            </Text>
            <Text as="p">
              Resolve each conflict below, then click{" "}
              <Text as="span" weight="medium">
                Update Draft
              </Text>{" "}
              to rebase your draft onto the current live version.
            </Text>
          </Callout>
        </Box>

        <Flex justify="center" gap="3" mb="4">
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
            <div className="mb-3">
              <strong>Fields changed:</strong>
              <ul style={{ listStyle: "none", paddingLeft: 0 }}>
                {Object.keys(mergeResult.newProposedChanges || {}).map(
                  (field) => {
                    const formatValue = (value: unknown): string => {
                      if (value === null || value === undefined) {
                        return String(value);
                      }
                      if (typeof value === "string") {
                        return value;
                      }
                      if (
                        typeof value === "number" ||
                        typeof value === "boolean"
                      ) {
                        return String(value);
                      }
                      return JSON.stringify(value, null, 2);
                    };

                    return (
                      <li key={field} style={{ marginBottom: "1.5rem" }}>
                        <strong style={{ fontSize: "1.1em" }}>{field}</strong>
                        <div className="diff-wrapper mt-2">
                          <ReactDiffViewer
                            oldValue={formatValue(liveSnapshot[field])}
                            newValue={formatValue(
                              mergeResult.newProposedChanges![field],
                            )}
                            compareMethod={DiffMethod.LINES}
                            styles={COMPACT_DIFF_STYLES}
                            splitView={true}
                          />
                        </div>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
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

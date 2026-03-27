/**
 * Generic Conflict Resolution Modal for Revisions
 *
 * This modal handles merge conflicts for any entity type that uses the revision system.
 * When a draft is based on an older version and the live version has changed, conflicts
 * may arise that need manual resolution.
 *
 * Usage:
 * 1. Create an autoMerge function for your entity type that returns AutoMergeResult<TResult>
 * 2. Create a RevisionDiffConfig for your entity type
 * 3. Pass these along with your entity and revisions to this modal
 *
 * Example (Saved Groups):
 * ```tsx
 * <FixConflictsModal<SavedGroupInterface, Partial<SavedGroupInterface>>
 *   entityName="saved-group"
 *   entity={savedGroup}
 *   revisions={allRevisions}
 *   selectedRevision={selectedRevision}
 *   diffConfig={REVISION_SAVED_GROUP_DIFF_CONFIG}
 *   autoMerge={(live, base, _revision, proposedChanges, strategies) =>
 *     autoMergeSavedGroup(live, base, live, proposedChanges, strategies)
 *   }
 *   applyMergeResult={(entity, result) => ({ ...entity, ...result })}
 *   close={closeModal}
 *   mutate={refreshData}
 * />
 * ```
 *
 * The modal will:
 * 1. Display conflicts side-by-side with base/live/revision values
 * 2. Allow user to choose "Use External Change" or "Use My Change" for each conflict
 * 3. Show a diff preview of the rebased draft
 * 4. Submit the resolution to POST /revision/:id/rebase
 */
import { useState, useMemo } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import Collapsible from "react-collapsible";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { PiCheckBold, PiGitMergeBold } from "react-icons/pi";
import { datetime } from "shared/dates";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { Revision } from "shared/enterprise";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import { useAuth } from "@/services/auth";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import Callout from "@/ui/Callout";
import { useRevisionDiff, RevisionDiffConfig } from "./useRevisionDiff";

export type MergeStrategy = "" | "overwrite" | "discard";

export interface MergeConflict {
  name: string;
  key: string;
  resolved: boolean;
  base: string;
  live: string;
  revision: string;
}

export type AutoMergeResult<TResult> =
  | {
      success: true;
      conflicts: MergeConflict[];
      result: TResult;
    }
  | {
      success: false;
      conflicts: MergeConflict[];
    };

export interface Props<T extends object, TResult extends object> {
  entityName: string;
  entity: T;
  revisions: Revision[];
  selectedRevision: Revision;
  diffConfig: RevisionDiffConfig<T>;
  autoMerge: (
    live: T,
    base: T,
    revision: T,
    proposedChanges: Partial<T>,
    strategies: Record<string, MergeStrategy>,
  ) => AutoMergeResult<TResult>;
  applyMergeResult: (entity: T, result: TResult) => T;
  close: () => void;
  mutate: () => void;
  open?: boolean;
}

export function ExpandableConflict({
  conflict,
  strategy,
  setStrategy,
  liveRevision,
  draftRevision,
}: {
  conflict: MergeConflict;
  strategy: MergeStrategy;
  setStrategy: (strategy: MergeStrategy) => void;
  liveRevision?: Revision;
  draftRevision?: Revision;
}) {
  const [open, setOpen] = useState(true);

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
        <strong>{conflict.name}</strong>
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
                    {liveRevision
                      ? liveRevision.title || `v${liveRevision.version ?? 0}`
                      : "External Change"}
                  </Heading>
                  {liveRevision && (
                    <Text size="small" color="text-low">
                      {datetime(liveRevision.dateUpdated)}
                    </Text>
                  )}
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
                oldValue={conflict.base}
                newValue={conflict.live}
                compareMethod={DiffMethod.LINES}
                styles={COMPACT_DIFF_STYLES}
              />
            </Box>
            <Box px="3" pt="2" pb="3">
              <Flex align="center" justify="between" gap="2" mb="2">
                <Flex align="center" gap="2" wrap="wrap">
                  <Heading as="h4" size="x-small" mb="0">
                    {draftRevision
                      ? draftRevision.title || `v${draftRevision.version ?? 0}`
                      : "Your Change"}
                  </Heading>
                  {draftRevision && (
                    <Text size="small" color="text-low">
                      {datetime(draftRevision.dateUpdated)}
                    </Text>
                  )}
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
                oldValue={conflict.base}
                newValue={conflict.revision}
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

export default function FixConflictsModal<
  T extends object,
  TResult extends object,
>({
  entityName,
  entity,
  revisions,
  selectedRevision,
  diffConfig,
  autoMerge,
  applyMergeResult,
  close,
  mutate,
}: Props<T, TResult>) {
  const { apiCall } = useAuth();

  const [strategies, setStrategies] = useState<Record<string, MergeStrategy>>(
    {},
  );
  const [step, setStep] = useState(0);

  const liveRevision = revisions.find((r) => r.status === "merged");

  const baseSnapshot = (selectedRevision.target.snapshot ?? entity) as T;
  const liveSnapshot = (
    liveRevision?.target.type === selectedRevision.target.type
      ? liveRevision.target.snapshot
      : entity
  ) as T;

  const mergeResult = useMemo(() => {
    if (!selectedRevision) return null;
    const proposedChanges = (selectedRevision.target.proposedChanges ??
      {}) as Partial<T>;
    return autoMerge(
      liveSnapshot,
      baseSnapshot,
      entity,
      proposedChanges,
      strategies,
    );
  }, [
    selectedRevision,
    liveSnapshot,
    baseSnapshot,
    entity,
    strategies,
    autoMerge,
  ]);

  const mergedEntity = useMemo(() => {
    if (!mergeResult?.success) return entity;
    return applyMergeResult(entity, mergeResult.result);
  }, [entity, mergeResult, applyMergeResult]);

  const { diffs } = useRevisionDiff<T>(entity, mergedEntity, diffConfig);

  if (!selectedRevision || !mergeResult || !mergeResult.conflicts.length)
    return null;

  const hasChanges =
    mergeResult.success && Object.keys(mergeResult.result).length > 0;

  return (
    <PagedModal
      trackingEventModalType={`resolve-${entityName}-conflicts`}
      header={"Resolve Conflicts"}
      step={step}
      setStep={setStep}
      submit={async () => {
        try {
          await apiCall(`/revision/${selectedRevision.id}/rebase`, {
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
              Your changes{" "}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  whiteSpace: "nowrap",
                  backgroundColor: "var(--gray-a2)",
                  padding: "1px 4px",
                  margin: "2px",
                  borderRadius: "var(--radius-2)",
                }}
              >
                <Text
                  as="span"
                  size="medium"
                  weight="semibold"
                  color="text-high"
                >
                  {selectedRevision.title ||
                    `v${selectedRevision.version ?? 0}`}
                </Text>
              </span>{" "}
              conflict with{" "}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  whiteSpace: "nowrap",
                  backgroundColor: "var(--gray-a2)",
                  padding: "1px 4px",
                  margin: "2px",
                  borderRadius: "var(--radius-2)",
                }}
              >
                <Text
                  as="span"
                  size="medium"
                  weight="semibold"
                  color="text-high"
                >
                  the current live version
                </Text>
              </span>
              .
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

        {mergeResult.conflicts.map((conflict) => (
          <ExpandableConflict
            conflict={conflict}
            key={conflict.key}
            strategy={strategies[conflict.key] || ""}
            setStrategy={(strategy) => {
              setStrategies({
                ...strategies,
                [conflict.key]: strategy,
              });
            }}
            liveRevision={liveRevision}
            draftRevision={selectedRevision}
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
              Almost done —{" "}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  whiteSpace: "nowrap",
                  backgroundColor: "var(--gray-a2)",
                  padding: "1px 4px",
                  margin: "2px",
                  borderRadius: "var(--radius-2)",
                }}
              >
                <Text as="span" weight="semibold" color="text-high">
                  {selectedRevision.title ||
                    `v${selectedRevision.version ?? 0}`}
                </Text>
              </span>{" "}
              has been successfully rebased onto{" "}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  whiteSpace: "nowrap",
                  backgroundColor: "var(--gray-a2)",
                  padding: "1px 4px",
                  margin: "2px",
                  borderRadius: "var(--radius-2)",
                }}
              >
                <Text as="span" weight="semibold" color="text-high">
                  the current live version
                </Text>
              </span>
              . Review the changes below, then click{" "}
              <Text as="span" weight="semibold">
                Update Draft
              </Text>{" "}
              to apply them.
            </Text>
          </Callout>
        </Box>
        {hasChanges ? (
          <Flex direction="column" gap="4">
            {diffs
              .filter((d) => d.a !== d.b)
              .map((diff) => (
                <div
                  key={diff.label}
                  className="diff-wrapper mb-4"
                  style={{ border: "1px solid var(--gray-a6)" }}
                >
                  <div
                    className="list-group-item d-flex align-items-center"
                    style={{
                      cursor: "default",
                      gap: "0.5rem",
                      border: "none",
                      borderBottom: "1px solid var(--gray-a6)",
                      borderRadius: 0,
                    }}
                  >
                    <strong>{diff.label}</strong>
                  </div>
                  <div
                    className="p-0"
                    style={{ background: "var(--color-surface)" }}
                  >
                    {diff.customRender || (
                      <ReactDiffViewer
                        oldValue={diff.a}
                        newValue={diff.b}
                        compareMethod={DiffMethod.LINES}
                        styles={COMPACT_DIFF_STYLES}
                        splitView={true}
                      />
                    )}
                  </div>
                </div>
              ))}
          </Flex>
        ) : (
          <Text as="p" color="text-low">
            Your draft and the live version are identical.
          </Text>
        )}
      </Page>
    </PagedModal>
  );
}

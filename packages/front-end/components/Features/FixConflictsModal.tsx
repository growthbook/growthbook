import { FeatureInterface } from "shared/types/feature";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { useState, useMemo } from "react";
import Collapsible from "react-collapsible";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { PiCheckBold, PiGitMergeBold } from "react-icons/pi";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { datetime } from "shared/dates";
import {
  MergeConflict,
  MergeStrategy,
  autoMerge,
  fillRevisionFromFeature,
  liveRevisionFromFeature,
  mergeResultHasChanges,
  filterEnvironmentsByFeature,
} from "shared/util";
import { Box, Flex, Grid } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import { useEnvironments } from "@/services/features";
import EventUser from "@/components/Avatar/EventUser";
import RevisionStatusBadge from "@/components/Features/RevisionStatusBadge";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Features/RevisionLabel";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import { useAuth } from "@/services/auth";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import {
  useFeatureRevisionDiff,
  featureToFeatureRevisionDiffInput,
  mergeResultToDiffInput,
} from "@/hooks/useFeatureRevisionDiff";
import Callout from "@/ui/Callout";
import { ExpandableDiff } from "./DraftModal";

export interface Props {
  feature: FeatureInterface;
  version: number;
  revisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
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
  liveRevision?: FeatureRevisionInterface;
  draftRevision?: FeatureRevisionInterface;
}) {
  const [open, setOpen] = useState(true);

  return (
    // Border lives on the outer wrapper so it stays fully drawn during the
    // Collapsible animation. overflow:hidden clips the sliding content cleanly.
    <div
      className="diff-wrapper mb-4"
      style={{
        border: "1px solid var(--gray-a6)",
        overflow: "hidden",
      }}
    >
      {/* Header — no individual border; outer wrapper supplies the outline */}
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

      {/* Two-column diff body — animated collapse */}
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
                    {liveRevision ? (
                      <OverflowText
                        maxWidth={200}
                        title={revisionLabelText(
                          liveRevision.version,
                          liveRevision.title,
                        )}
                      >
                        <RevisionLabel
                          version={liveRevision.version}
                          title={liveRevision.title}
                        />
                      </OverflowText>
                    ) : (
                      "External Change"
                    )}
                  </Heading>
                  {liveRevision && (
                    <RevisionStatusBadge
                      revision={liveRevision}
                      liveVersion={liveRevision.version}
                    />
                  )}
                  {liveRevision?.createdBy && (
                    <Text size="small" color="text-low">
                      <EventUser
                        user={liveRevision.createdBy}
                        display="name-email"
                      />
                    </Text>
                  )}
                  {liveRevision && (
                    <Text size="small" color="text-low">
                      {datetime(
                        liveRevision.datePublished ?? liveRevision.dateUpdated,
                      )}
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
                    {draftRevision ? (
                      <OverflowText
                        maxWidth={200}
                        title={revisionLabelText(
                          draftRevision.version,
                          draftRevision.title,
                        )}
                      >
                        <RevisionLabel
                          version={draftRevision.version}
                          title={draftRevision.title}
                        />
                      </OverflowText>
                    ) : (
                      "Your Change"
                    )}
                  </Heading>
                  {draftRevision && (
                    <RevisionStatusBadge
                      revision={draftRevision}
                      liveVersion={-1}
                    />
                  )}
                  {draftRevision?.createdBy && (
                    <Text size="small" color="text-low">
                      <EventUser
                        user={draftRevision.createdBy}
                        display="name-email"
                      />
                    </Text>
                  )}
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

export default function FixConflictsModal({
  feature,
  version,
  revisions,
  close,
  mutate,
}: Props) {
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);

  const { apiCall } = useAuth();

  const [strategies, setStrategies] = useState<Record<string, MergeStrategy>>(
    {},
  );
  const [step, setStep] = useState(0);

  const revision = revisions.find((r) => r.version === version);
  const baseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion,
  );
  const liveRevision = revisions.find((r) => r.version === feature.version);

  const envIds = environments.map((e) => e.id);

  const mergeResult = useMemo(() => {
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevisionFromFeature(liveRevision, feature),
      fillRevisionFromFeature(baseRevision, feature),
      revision,
      envIds,
      strategies,
    );
  }, [revision, baseRevision, liveRevision, envIds, strategies, feature]);

  const currentRevisionData = featureToFeatureRevisionDiffInput(feature);
  const resultDiffs = useFeatureRevisionDiff({
    current: currentRevisionData,
    draft: mergeResult?.success
      ? mergeResultToDiffInput(mergeResult.result, currentRevisionData)
      : currentRevisionData,
  });

  if (!revision || !mergeResult || !mergeResult.conflicts.length) return null;

  const hasChanges = mergeResultHasChanges(mergeResult);

  return (
    <PagedModal
      trackingEventModalType="resolve-conflicts"
      header={"Resolve Conflicts"}
      step={step}
      setStep={setStep}
      submit={async () => {
        try {
          await apiCall(`/feature/${feature.id}/${revision.version}/rebase`, {
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
                  <OverflowText
                    maxWidth={200}
                    title={revisionLabelText(revision.version, revision.title)}
                  >
                    <RevisionLabel
                      version={revision.version}
                      title={revision.title}
                    />
                  </OverflowText>
                </Text>
                <RevisionStatusBadge
                  revision={revision}
                  liveVersion={liveRevision?.version ?? -1}
                />
              </span>{" "}
              are based on{" "}
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
                  <OverflowText
                    maxWidth={200}
                    title={revisionLabelText(
                      baseRevision?.version ?? 0,
                      baseRevision?.title,
                    )}
                  >
                    <RevisionLabel
                      version={baseRevision?.version ?? 0}
                      title={baseRevision?.title}
                    />
                  </OverflowText>
                </Text>
                {baseRevision && (
                  <RevisionStatusBadge
                    revision={baseRevision}
                    liveVersion={liveRevision?.version ?? -1}
                  />
                )}
              </span>
              {", but "}
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
                  <OverflowText
                    maxWidth={200}
                    title={revisionLabelText(
                      liveRevision?.version ?? 0,
                      liveRevision?.title,
                    )}
                  >
                    <RevisionLabel
                      version={liveRevision?.version ?? 0}
                      title={liveRevision?.title}
                    />
                  </OverflowText>
                </Text>
                {liveRevision && (
                  <RevisionStatusBadge
                    revision={liveRevision}
                    liveVersion={liveRevision.version}
                  />
                )}
              </span>{" "}
              has since been published with conflicting changes.
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
            key={conflict.name}
            strategy={strategies[conflict.key] || ""}
            setStrategy={(strategy) => {
              setStrategies({
                ...strategies,
                [conflict.key]: strategy,
              });
            }}
            liveRevision={liveRevision}
            draftRevision={revision}
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
                  <OverflowText
                    maxWidth={200}
                    title={revisionLabelText(revision.version, revision.title)}
                  >
                    <RevisionLabel
                      version={revision.version}
                      title={revision.title}
                    />
                  </OverflowText>
                </Text>
                <RevisionStatusBadge
                  revision={revision}
                  liveVersion={liveRevision?.version ?? -1}
                />
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
                  <OverflowText
                    maxWidth={200}
                    title={revisionLabelText(
                      liveRevision?.version ?? 0,
                      liveRevision?.title,
                    )}
                  >
                    <RevisionLabel
                      version={liveRevision?.version ?? 0}
                      title={liveRevision?.title}
                    />
                  </OverflowText>
                </Text>
                {liveRevision && (
                  <RevisionStatusBadge
                    revision={liveRevision}
                    liveVersion={liveRevision.version}
                  />
                )}
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
            {resultDiffs
              .filter((d) => d.a !== d.b)
              .map((diff) => (
                <ExpandableDiff
                  key={diff.title}
                  {...diff}
                  defaultOpen
                  styles={COMPACT_DIFF_STYLES}
                  leftTitle={
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "var(--space-1)",
                        fontFamily: "var(--default-font-family)",
                        marginBottom: "var(--space-2)",
                      }}
                    >
                      <Text as="span" weight="semibold" color="text-high">
                        <OverflowText
                          maxWidth={200}
                          title={revisionLabelText(
                            liveRevision?.version ?? 0,
                            liveRevision?.title,
                          )}
                        >
                          <RevisionLabel
                            version={liveRevision?.version ?? 0}
                            title={liveRevision?.title}
                          />
                        </OverflowText>
                      </Text>
                      {liveRevision && (
                        <RevisionStatusBadge
                          revision={liveRevision}
                          liveVersion={liveRevision.version}
                        />
                      )}
                    </span>
                  }
                  rightTitle={
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "var(--space-1)",
                        fontFamily: "var(--default-font-family)",
                        marginBottom: "var(--space-2)",
                      }}
                    >
                      <Text as="span" weight="semibold" color="text-high">
                        <OverflowText
                          maxWidth={200}
                          title={revisionLabelText(
                            revision.version,
                            revision.title,
                          )}
                        >
                          <RevisionLabel
                            version={revision.version}
                            title={revision.title}
                          />
                        </OverflowText>
                      </Text>
                      <RevisionStatusBadge
                        revision={revision}
                        liveVersion={liveRevision?.version ?? -1}
                      />
                    </span>
                  }
                />
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

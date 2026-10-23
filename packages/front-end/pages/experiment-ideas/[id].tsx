import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiArrowLeft, PiCaretUp, PiCaretUpFill } from "react-icons/pi";
import { ExperimentIdeaDetail } from "shared/validators";
import { ago, date } from "shared/dates";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useCustomFields } from "@/hooks/useCustomFields";
import { useExperiments } from "@/hooks/useExperiments";
import { filterCustomFieldsForSectionAndProject } from "@/services/customFields";
import LoadingOverlay from "@/components/LoadingOverlay";
import ConfirmModal from "@/components/ConfirmModal";
import DiscussionThread from "@/components/DiscussionThread";
import Owner from "@/components/Avatar/Owner";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import EditLearningModal from "@/components/Learnings/EditLearningModal";
import IdeaFormModal from "@/components/ExperimentIdeas/IdeaFormModal";
import DerivedStateBadges from "@/components/ExperimentIdeas/DerivedStateBadges";
import { useExperimentIdeaStages } from "@/components/ExperimentIdeas/useExperimentIdeas";
import styles from "@/components/ExperimentIdeas/ExperimentIdeas.module.scss";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { FilterItem } from "@/components/Search/SearchFilters";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box className="appbox" p="4" mb="4">
      <Heading as="h3" size="md" mb="3">
        {title}
      </Heading>
      {children}
    </Box>
  );
}

function TextBlock({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <div className={styles.sectionLabel}>{label}</div>
      <Text as="div" color={value ? "text-high" : "text-low"} mt="1">
        <span style={{ whiteSpace: "pre-wrap" }}>{value || "Not set"}</span>
      </Text>
    </Box>
  );
}

function RailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Flex justify="between" gap="3" py="1">
      <Text color="text-mid">{label}</Text>
      <Box style={{ textAlign: "right" }}>{children}</Box>
    </Flex>
  );
}

const ExperimentIdeaPage = (): React.ReactElement => {
  const router = useRouter();
  const ideaId = typeof router.query.id === "string" ? router.query.id : "";
  const { apiCall } = useAuth();
  const { getOwnerDisplay, hasCommercialFeature } = useUser();
  const { getProjectById, getExperimentMetricById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const allCustomFields = useCustomFields();
  const { stages } = useExperimentIdeaStages();
  const hasLearnings = hasCommercialFeature("learnings");

  const { data, error, mutate } = useApi<{ idea: ExperimentIdeaDetail }>(
    `/experiment-ideas/${ideaId}`,
    { shouldRun: () => !!ideaId },
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [writingLearning, setWritingLearning] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const idea = data?.idea;
  const concluded = useMemo(
    () => idea?.linkedExperiments.filter((e) => e.status === "stopped") ?? [],
    [idea],
  );
  const { experiments } = useExperiments("", true, "standard");

  if (error) {
    return (
      <div className="container-fluid pagecontents p-4">
        <Callout status="error">{error.message}</Callout>
      </div>
    );
  }
  if (!idea) return <LoadingOverlay />;

  const stage = stages.find((s) => s.id === idea.stage);
  const canManage = idea.canManage;
  const canCreateExperiment = permissionsUtil.canCreateExperiment({
    project: idea.project,
  });
  const customFields =
    filterCustomFieldsForSectionAndProject(
      allCustomFields,
      "experiment-idea",
      idea.project || undefined,
    )?.filter((f) => idea.customFields[f.id] !== undefined) ?? [];

  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      await mutate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleUpvote = () =>
    act(() =>
      apiCall(`/experiment-ideas/${idea.id}/upvote`, {
        method: idea.upvotedByMe ? "DELETE" : "POST",
      }),
    );

  const voterNames = idea.upvotes
    .map((u) => getOwnerDisplay(u))
    .filter(Boolean);

  return (
    <div className="container-fluid pagecontents p-4">
      <Box mb="3">
        <Link href="/experiment-ideas">
          <Flex align="center" gap="1" display="inline-flex">
            <PiArrowLeft /> Back to ideas
          </Flex>
        </Link>
      </Box>

      <Flex justify="between" align="start" gap="4" mb="4" wrap="wrap">
        <Flex direction="column" gap="2">
          <Heading as="h1" size="xl" weight="medium" mb="0">
            {idea.title}
          </Heading>
          <DerivedStateBadges
            states={idea.derivedStates}
            archived={idea.archived}
            linkedExperimentCount={idea.linkedExperimentCount}
          />
        </Flex>
        <Flex align="center" gap="3">
          <Button
            variant="outline"
            icon={idea.upvotedByMe ? <PiCaretUpFill /> : <PiCaretUp />}
            onClick={toggleUpvote}
          >
            {`Upvote · ${idea.upvoteCount}`}
          </Button>
          {canManage && (
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="2"
                  highContrast
                  aria-label="Idea actions"
                >
                  <BsThreeDotsVertical size={16} />
                </IconButton>
              }
              open={menuOpen}
              onOpenChange={setMenuOpen}
              menuPlacement="end"
            >
              <DropdownMenuLabel>Stage</DropdownMenuLabel>
              {stages.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => {
                    setMenuOpen(false);
                    if (s.id !== idea.stage) {
                      act(() =>
                        apiCall(`/experiment-ideas/${idea.id}`, {
                          method: "PUT",
                          body: JSON.stringify({ stage: s.id }),
                        }),
                      );
                    }
                  }}
                >
                  <FilterItem item={s.label} exists={s.id === idea.stage} />
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setEditing(true);
                  setMenuOpen(false);
                }}
              >
                Edit
              </DropdownMenuItem>
              {hasLearnings && (
                <DropdownMenuItem
                  disabled={!concluded.length}
                  tooltip={
                    concluded.length
                      ? undefined
                      : "Available once a linked experiment concludes"
                  }
                  onClick={() => {
                    setWritingLearning(true);
                    setMenuOpen(false);
                  }}
                >
                  Write learning
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled tooltip="Coming soon">
                <Flex align="center" gap="2">
                  Push to Jira
                  <Badge label="Soon" color="gray" variant="soft" size="xs" />
                </Flex>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  act(() =>
                    apiCall(
                      `/experiment-ideas/${idea.id}/${idea.archived ? "restore" : "archive"}`,
                      { method: "POST" },
                    ),
                  );
                }}
              >
                {idea.archived ? "Restore" : "Archive"}
              </DropdownMenuItem>
              <DropdownMenuItem
                color="red"
                onClick={() => {
                  setConfirmingDelete(true);
                  setMenuOpen(false);
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenu>
          )}
          {canCreateExperiment && (
            <Button onClick={() => setConverting(true)}>
              Create experiment
            </Button>
          )}
        </Flex>
      </Flex>

      {actionError && (
        <Box mb="3">
          <Callout status="error">{actionError}</Callout>
        </Box>
      )}

      <Grid columns={{ initial: "1", md: "1fr 300px" }} gap="4">
        <Box style={{ minWidth: 0 }}>
          <Box className="appbox" p="4" mb="4">
            <Flex direction="column" gap="4">
              <TextBlock label="Description" value={idea.description} />
              <Grid columns={{ initial: "1", sm: "2" }} gap="4">
                <TextBlock label="Hypothesis" value={idea.hypothesis} />
                <TextBlock
                  label="Expected outcome"
                  value={idea.expectedOutcome}
                />
              </Grid>
              <TextBlock label="Rationale" value={idea.rationale} />
            </Flex>
          </Box>

          <Section title="Related work">
            <Box mb="4">
              <div className={styles.sectionLabel}>Informed by</div>
              {idea.priorWork.length === 0 ? (
                <Text as="div" color="text-low" mt="1">
                  No prior work cited.
                </Text>
              ) : (
                idea.priorWork.map((p) => (
                  <Flex
                    key={`${p.kind}:${p.id}`}
                    align="center"
                    gap="2"
                    className={styles.priorWorkRow}
                  >
                    <Badge
                      label={p.kind === "learning" ? "Learning" : "Experiment"}
                      color={p.kind === "learning" ? "green" : "violet"}
                      variant="soft"
                      size="xs"
                    />
                    <Link
                      href={
                        p.kind === "learning"
                          ? `/learnings/${p.id}`
                          : `/experiment/${p.id}`
                      }
                    >
                      {p.name}
                    </Link>
                  </Flex>
                ))
              )}
            </Box>
            <Box mb="4">
              <div className={styles.sectionLabel}>
                Experiments from this idea
              </div>
              {idea.linkedExperiments.length === 0 ? (
                <Text as="div" color="text-low" mt="1">
                  Not converted yet.
                </Text>
              ) : (
                idea.linkedExperiments.map((e) => (
                  <Flex
                    key={e.id}
                    align="center"
                    justify="between"
                    gap="2"
                    className={styles.priorWorkRow}
                  >
                    <Link href={`/experiment/${e.id}`}>{e.name}</Link>
                    <Text color="text-mid">{e.status}</Text>
                  </Flex>
                ))
              )}
            </Box>
            {hasLearnings && (
              <Box>
                <div className={styles.sectionLabel}>Resulting learnings</div>
                {idea.resultingLearnings.map((l) => (
                  <Flex
                    key={l.id}
                    align="center"
                    gap="2"
                    className={styles.priorWorkRow}
                  >
                    <Badge
                      label={
                        l.relation === "supporting"
                          ? "Supporting"
                          : "Contradicting"
                      }
                      color={l.relation === "supporting" ? "green" : "red"}
                      variant="soft"
                      size="xs"
                    />
                    <Link href={`/learnings/${l.id}`}>{l.title}</Link>
                  </Flex>
                ))}
                {idea.resultingLearnings.length === 0 &&
                  (concluded.length > 0 && canManage ? (
                    <Callout status="info" mt="2">
                      <Flex align="center" justify="between" gap="3">
                        <span>
                          {concluded[0].name} has concluded. Write up what it
                          taught you.
                        </span>
                        <Button
                          size="sm"
                          variant="soft"
                          onClick={() => setWritingLearning(true)}
                        >
                          Write learning
                        </Button>
                      </Flex>
                    </Callout>
                  ) : (
                    <Text as="div" color="text-low" mt="1">
                      None yet.
                    </Text>
                  ))}
              </Box>
            )}
          </Section>

          {customFields.length > 0 && (
            <Section title="Custom Fields">
              {customFields.map((f) => (
                <RailRow key={f.id} label={f.name}>
                  <Text>{String(idea.customFields[f.id])}</Text>
                </RailRow>
              ))}
            </Section>
          )}

          <Box mb="4">
            <DiscussionThread
              type="experimentIdea"
              id={idea.id}
              projects={idea.project ? [idea.project] : []}
              showTitle={true}
              title="Discussion"
            />
          </Box>
        </Box>

        <Box>
          <Box className="appbox" p="4" mb="4">
            <RailRow label="Stage">
              <Badge
                label={stage?.label ?? "Unknown stage"}
                color={stage?.color ?? "gray"}
                variant="soft"
                size="sm"
              />
            </RailRow>
            <RailRow label="Owner">
              <Owner ownerId={idea.owner} />
            </RailRow>
            <RailRow label="Upvotes">
              <Text>
                {idea.upvoteCount}
                {voterNames.length > 0 &&
                  ` · ${voterNames.slice(0, 2).join(", ")}${voterNames.length > 2 ? ` +${voterNames.length - 2} more` : ""}`}
              </Text>
            </RailRow>
            <RailRow label="Created by">
              <Text>{getOwnerDisplay(idea.createdBy) || "Unknown"}</Text>
            </RailRow>
            <RailRow label="Project">
              <Text>
                {idea.project
                  ? getProjectById(idea.project)?.name || idea.project
                  : "All Projects"}
              </Text>
            </RailRow>
            {idea.productArea && (
              <RailRow label="Product area">
                <Text>{idea.productArea}</Text>
              </RailRow>
            )}
            {idea.tags.length > 0 && (
              <RailRow label="Tags">
                <Flex gap="1" wrap="wrap" justify="end">
                  {idea.tags.map((t) => (
                    <Badge
                      key={t}
                      label={t}
                      color="gray"
                      variant="soft"
                      size="xs"
                    />
                  ))}
                </Flex>
              </RailRow>
            )}
            <RailRow label="Created">
              <Text title={date(idea.dateCreated)}>
                {ago(idea.dateCreated)}
              </Text>
            </RailRow>
            <RailRow label="Updated">
              <Text title={date(idea.dateUpdated)}>
                {ago(idea.dateUpdated)}
              </Text>
            </RailRow>
          </Box>
          {idea.metricIds.length > 0 && (
            <Box className="appbox" p="4" mb="4">
              <div className={styles.sectionLabel}>Metrics of interest</div>
              <Flex direction="column" gap="1" mt="2">
                {idea.metricIds.map((id) => {
                  const m = getExperimentMetricById(id);
                  return (
                    <Link key={id} href={`/metric/${id}`}>
                      {m?.name ?? id}
                    </Link>
                  );
                })}
              </Flex>
              <Text as="div" size="sm" color="text-mid" mt="2">
                No primary metric is chosen for you: pick goals when creating
                the experiment.
              </Text>
            </Box>
          )}
        </Box>
      </Grid>

      {editing && (
        <IdeaFormModal
          idea={idea}
          close={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            mutate();
          }}
        />
      )}
      {converting && (
        <NewExperimentForm
          onClose={() => setConverting(false)}
          source="experiment-idea"
          isNewExperiment={true}
          initialValue={{
            type: "standard",
            name: idea.title,
            description: idea.description,
            hypothesis: idea.hypothesis,
            project: idea.project,
            tags: idea.tags,
            sourceExperimentIdeaId: idea.id,
          }}
          onCreate={(id) => router.push(`/experiment/${id}`)}
        />
      )}
      {writingLearning && (
        <EditLearningModal
          experiments={experiments}
          defaultProjects={idea.project ? [idea.project] : []}
          defaultSupportingExperimentIds={concluded.map((e) => e.id)}
          close={() => setWritingLearning(false)}
          onSaved={() => {
            setWritingLearning(false);
            mutate();
          }}
        />
      )}
      <ConfirmModal
        title="Delete this idea?"
        subtitle="Experiments created from it are kept. This cannot be undone."
        yesText="Delete"
        noText="Cancel"
        modalState={confirmingDelete}
        setModalState={setConfirmingDelete}
        onConfirm={async () => {
          setActionError(null);
          try {
            await apiCall(`/experiment-ideas/${idea.id}`, {
              method: "DELETE",
            });
            router.push("/experiment-ideas");
          } catch (e) {
            setActionError(e instanceof Error ? e.message : String(e));
            setConfirmingDelete(false);
          }
        }}
      />
    </div>
  );
};

export default ExperimentIdeaPage;

import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiArrowLeft,
  PiPencilSimple,
  PiSparkleFill,
  PiTrash,
} from "react-icons/pi";
import { InsightWithCanManage } from "shared/validators";
import { date, getValidDate } from "shared/dates";
import { DEFAULT_LEARNING_STATUSES } from "shared/constants";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import LoadingOverlay from "@/components/LoadingOverlay";
import Markdown from "@/components/Markdown/Markdown";
import ConfirmModal from "@/components/ConfirmModal";
import DiscussionThread from "@/components/DiscussionThread";
import EditInsightModal from "@/components/Insights/EditInsightModal";
import ExperimentChips from "@/components/Insights/ExperimentChips";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

const InsightPage = (): React.ReactElement => {
  const router = useRouter();
  const { lid } = router.query;
  const insightId = typeof lid === "string" ? lid : "";

  const { apiCall } = useAuth();
  const { getOwnerDisplay } = useUser();
  const { getProjectById } = useDefinitions();
  const orgSettings = useOrgSettings();
  const learningStatuses =
    orgSettings.learningStatuses ?? DEFAULT_LEARNING_STATUSES;

  const { data, error, mutate } = useApi<{ insight: InsightWithCanManage }>(
    `/insights/${insightId}`,
    { shouldRun: () => !!insightId },
  );

  // All readable experiments (across projects) so supporting/contrary ids
  // resolve to names even outside the current project context
  const { experiments } = useExperiments("", true, "standard");
  const experimentMap = useMemo(
    () => new Map(experiments.map((e) => [e.id, e])),
    [experiments],
  );

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (error) {
    return (
      <div className="container-fluid pagecontents p-4">
        <Callout status="error">{error.message}</Callout>
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const insight = data.insight;
  const status = insight.status
    ? learningStatuses.find((s) => s.id === insight.status)
    : undefined;
  const ownerName = getOwnerDisplay(insight.owner) || "Unknown";
  const edited =
    getValidDate(insight.dateUpdated).getTime() -
      getValidDate(insight.dateCreated).getTime() >
    1000;
  const editorNames = (insight.authors || [])
    .filter((u) => u && u !== insight.owner)
    .map((u) => getOwnerDisplay(u) || "Unknown");

  return (
    <div className="container-fluid pagecontents p-4">
      <Box mb="3">
        <Link href="/learnings#saved">
          <Flex align="center" gap="1" display="inline-flex">
            <PiArrowLeft /> Saved Learnings
          </Flex>
        </Link>
      </Box>
      <Flex justify="between" align="start" gap="3" mb="2">
        <Flex gap="2" align="center" wrap="wrap">
          <Heading as="h1" size="x-large" weight="medium" mb="0">
            {insight.title}
          </Heading>
          {insight.source === "ai" && (
            <Badge
              label={
                <Flex gap="1" align="center">
                  <PiSparkleFill /> AI-suggested
                </Flex>
              }
              color="violet"
              variant="soft"
              size="sm"
            />
          )}
          {insight.status && (
            <Badge
              label={status?.label || insight.status}
              color={status?.color || "gray"}
              variant="soft"
              size="sm"
              title={
                status ? undefined : "This status no longer exists in settings"
              }
            />
          )}
        </Flex>
        {insight.canManage && (
          <Flex gap="1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              aria-label="Edit insight"
            >
              <PiPencilSimple />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDelete(true)}
              aria-label="Delete insight"
            >
              <PiTrash />
            </Button>
          </Flex>
        )}
      </Flex>
      <Box mb="4">
        <Text size="small" color="text-mid" as="div">
          Created {date(insight.dateCreated)} by {ownerName}
          {edited ? ` · edited ${date(insight.dateUpdated)}` : ""}
          {editorNames.length > 0
            ? ` · also edited by ${editorNames.join(", ")}`
            : ""}
        </Text>
        {insight.projects && insight.projects.length > 0 && (
          <Box mt="1">
            <Flex gap="2" wrap="wrap" align="center">
              <Text size="small" color="text-mid">
                Projects:
              </Text>
              {insight.projects.map((p) => (
                <Badge
                  key={p}
                  label={getProjectById(p)?.name || p}
                  color="gray"
                  variant="soft"
                  size="sm"
                />
              ))}
            </Flex>
          </Box>
        )}
      </Box>
      {deleteError && (
        <Box mb="3">
          <Callout status="error">{deleteError}</Callout>
        </Box>
      )}
      <Box
        p="4"
        mb="4"
        style={{
          border: "1px solid var(--gray-a5)",
          borderRadius: 8,
          background: "var(--color-panel-solid)",
        }}
      >
        <Box mb="3">
          <Markdown>{insight.text}</Markdown>
        </Box>
        {insight.tags && insight.tags.length > 0 && (
          <Box mb="3">
            <Flex gap="2" wrap="wrap">
              {insight.tags.map((t) => (
                <Badge
                  key={t}
                  label={t}
                  color="violet"
                  variant="soft"
                  size="sm"
                />
              ))}
            </Flex>
          </Box>
        )}
        <Flex direction="column" gap="3">
          <ExperimentChips
            label="Supporting experiments"
            experimentIds={insight.supportingExperimentIds}
            experimentMap={experimentMap}
          />
          <ExperimentChips
            label="Contrary evidence"
            experimentIds={insight.contraryEvidence || []}
            experimentMap={experimentMap}
            variant="contrary"
          />
        </Flex>
      </Box>
      <Box mb="4">
        <DiscussionThread
          type="insight"
          id={insight.id}
          projects={insight.projects || []}
          showTitle={true}
          title="Discussion"
        />
      </Box>
      {editing && (
        <EditInsightModal
          insight={insight}
          experiments={experiments}
          close={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            mutate();
          }}
        />
      )}
      <ConfirmModal
        title="Delete this insight?"
        subtitle="This action cannot be undone."
        yesText="Yes, delete it"
        noText="Cancel"
        modalState={confirmingDelete}
        setModalState={setConfirmingDelete}
        onConfirm={async () => {
          setDeleteError(null);
          try {
            await apiCall(`/insights/${insight.id}`, { method: "DELETE" });
            router.push("/learnings#saved");
          } catch (e) {
            setDeleteError(
              e instanceof Error ? e.message : "Could not delete insight",
            );
            setConfirmingDelete(false);
          }
        }}
      />
    </div>
  );
};

export default InsightPage;

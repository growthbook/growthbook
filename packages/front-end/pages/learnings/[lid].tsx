import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiArrowLeft, PiSparkleFill } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { LearningWithCanManage } from "shared/validators";
import { date, getValidDate } from "shared/dates";
import { DEFAULT_LEARNING_STATUSES } from "shared/constants";
import useApi from "@/hooks/useApi";
import useOrgSettings, { useAISettings } from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import LoadingOverlay from "@/components/LoadingOverlay";
import Markdown from "@/components/Markdown/Markdown";
import ConfirmModal from "@/components/ConfirmModal";
import DiscussionThread from "@/components/DiscussionThread";
import EditLearningModal from "@/components/Learnings/EditLearningModal";
import RefreshLearningsModal from "@/components/Learnings/RefreshLearningsModal";
import ExperimentChips from "@/components/Learnings/ExperimentChips";
import Badge from "@/ui/Badge";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

const LearningPage = (): React.ReactElement => {
  const router = useRouter();
  const { lid } = router.query;
  const learningId = typeof lid === "string" ? lid : "";

  const { apiCall } = useAuth();
  const { getOwnerDisplay } = useUser();
  const { getProjectById } = useDefinitions();
  const orgSettings = useOrgSettings();
  const { aiEnabled } = useAISettings();
  const learningStatuses =
    orgSettings.learningStatuses ?? DEFAULT_LEARNING_STATUSES;

  const { data, error, mutate } = useApi<{ learning: LearningWithCanManage }>(
    `/learnings/${learningId}`,
    { shouldRun: () => !!learningId },
  );

  // All readable experiments (across projects) so supporting/contrary ids
  // resolve to names even outside the current project context
  const { experiments } = useExperiments("", true, "standard");
  const experimentMap = useMemo(
    () => new Map(experiments.map((e) => [e.id, e])),
    [experiments],
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
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

  const learning = data.learning;
  const status = learning.status
    ? learningStatuses.find((s) => s.id === learning.status)
    : undefined;
  const ownerName = getOwnerDisplay(learning.owner) || "Unknown";
  const edited =
    getValidDate(learning.dateUpdated).getTime() -
      getValidDate(learning.dateCreated).getTime() >
    1000;
  const editorNames = (learning.authors || [])
    .filter((u) => u && u !== learning.owner)
    .map((u) => getOwnerDisplay(u) || "Unknown");

  return (
    <div className="container-fluid pagecontents p-4">
      <Box mb="3">
        <Link href="/learnings#saved">
          <Flex align="center" gap="1" display="inline-flex">
            <PiArrowLeft /> Learnings
          </Flex>
        </Link>
      </Box>
      <Flex justify="between" align="start" gap="3" mb="2">
        <Flex gap="2" align="center" wrap="wrap">
          <Heading as="h1" size="x-large" weight="medium" mb="0">
            {learning.title}
          </Heading>
          {learning.source === "ai" && (
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
          {learning.status && (
            <Badge
              label={status?.label || learning.status}
              color={status?.color || "gray"}
              variant="soft"
              size="sm"
              title={
                status ? undefined : "This status no longer exists in settings"
              }
            />
          )}
        </Flex>
        {learning.canManage && (
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="2"
                highContrast
                aria-label="Learning actions"
              >
                <BsThreeDotsVertical size={16} />
              </IconButton>
            }
            open={menuOpen}
            onOpenChange={setMenuOpen}
            menuPlacement="end"
          >
            <DropdownMenuItem
              onClick={() => {
                setEditing(true);
                setMenuOpen(false);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!aiEnabled}
              tooltip={
                aiEnabled
                  ? "Re-checks this Learning against experiments that finished since it was last reviewed, and suggests updated wording plus any new supporting or contradicting experiments. Nothing changes until you review and apply."
                  : "AI features are not enabled for this organization."
              }
              onClick={() => {
                setRefreshOpen(true);
                setMenuOpen(false);
              }}
            >
              Refresh against newer experiments
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
      </Flex>
      <Box mb="4">
        <Text size="small" color="text-mid" as="div">
          Created {date(learning.dateCreated)} by {ownerName}
          {edited ? ` · edited ${date(learning.dateUpdated)}` : ""}
          {editorNames.length > 0
            ? ` · also edited by ${editorNames.join(", ")}`
            : ""}
        </Text>
        {learning.projects && learning.projects.length > 0 && (
          <Box mt="1">
            <Flex gap="2" wrap="wrap" align="center">
              <Text size="small" color="text-mid">
                Projects:
              </Text>
              {learning.projects.map((p) => (
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
          <Markdown>{learning.text}</Markdown>
        </Box>
        {learning.tags && learning.tags.length > 0 && (
          <Box mb="3">
            <Flex gap="2" wrap="wrap">
              {learning.tags.map((t) => (
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
            experimentIds={learning.supportingExperimentIds}
            experimentMap={experimentMap}
          />
          <ExperimentChips
            label="Contradicting experiments"
            experimentIds={learning.contradictingExperimentIds || []}
            experimentMap={experimentMap}
            variant="contrary"
          />
        </Flex>
      </Box>
      <Box mb="4">
        <DiscussionThread
          type="learning"
          id={learning.id}
          projects={learning.projects || []}
          showTitle={true}
          title="Discussion"
        />
      </Box>
      {refreshOpen && (
        <RefreshLearningsModal
          experiments={experiments}
          learningIds={[learning.id]}
          close={() => setRefreshOpen(false)}
          onApplied={() => mutate()}
        />
      )}
      {editing && (
        <EditLearningModal
          learning={learning}
          experiments={experiments}
          close={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            mutate();
          }}
        />
      )}
      <ConfirmModal
        title="Delete this learning?"
        subtitle="This action cannot be undone."
        yesText="Yes, delete it"
        noText="Cancel"
        modalState={confirmingDelete}
        setModalState={setConfirmingDelete}
        onConfirm={async () => {
          setDeleteError(null);
          try {
            await apiCall(`/learnings/${learning.id}`, { method: "DELETE" });
            router.push("/learnings#saved");
          } catch (e) {
            setDeleteError(
              e instanceof Error ? e.message : "Could not delete learning",
            );
            setConfirmingDelete(false);
          }
        }}
      />
    </div>
  );
};

export default LearningPage;

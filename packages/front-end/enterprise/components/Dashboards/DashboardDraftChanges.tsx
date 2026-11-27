import { Box, Flex } from "@radix-ui/themes";
import { useState } from "react";
import { PiSparkle } from "react-icons/pi";
import {
  DashboardInterface,
  DashboardContentChange,
  DashboardVersionInterface,
  diffDashboardContent,
} from "shared/enterprise";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

// What publishing the draft would change, who made each change, and a note for the history.
export default function DashboardDraftChanges({
  dashboard,
  draft,
  note,
  setNote,
  onRevert,
}: {
  dashboard: DashboardInterface;
  draft: DashboardVersionInterface;
  note: string;
  setNote: (note: string) => void;
  // Puts one change back to what is published.
  onRevert?: (
    target: Pick<DashboardContentChange, "blockId" | "setting">,
  ) => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const { getUserDisplay } = useUser();
  const { aiEnabled } = useAISettings();
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Later changes win, so each block shows who touched it last.
  const who = (c: (typeof draft.changes)[number]) =>
    c.byAI ? "AI Assistant" : getUserDisplay(c.userId);
  const authors = new Map(
    draft.changes.flatMap((c) => (c.blockId ? [[c.blockId, who(c)]] : [])),
  );
  // Setting changes are not recorded per setting, so name someone only when it is unambiguous.
  const settingAuthors = new Set(
    draft.changes.filter((c) => c.type === "settings").map(who),
  );
  const authorOf = (change: DashboardContentChange) =>
    change.blockId
      ? authors.get(change.blockId)
      : settingAuthors.size === 1
        ? [...settingAuthors][0]
        : undefined;
  const changes = diffDashboardContent(dashboard, draft.content);

  const draftNote = async () => {
    setDrafting(true);
    setError(null);
    try {
      const res = await apiCall<{ summary: string }>(
        `/dashboards/${dashboard.id}/draft/summary`,
        { method: "POST" },
      );
      setNote(res.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setDrafting(false);
  };

  return (
    <Flex direction="column" gap="2">
      <Text weight="semibold">Changes in This Version</Text>
      {changes.length === 0 ? (
        <Text size="sm" color="text-low">
          Nothing a viewer would notice.
        </Text>
      ) : null}
      {changes.map((change) => (
        <Flex
          key={`${change.type}:${change.blockId ?? change.setting}`}
          align="center"
          gap="3"
        >
          <Flex flexGrow="1">
            <Text size="sm">{change.summary}</Text>
          </Flex>
          <Text size="sm" color="text-low">
            {authorOf(change)}
          </Text>
          {onRevert ? (
            <Button
              variant="ghost"
              size="sm"
              setError={setError}
              onClick={() =>
                onRevert({ blockId: change.blockId, setting: change.setting })
              }
            >
              Revert
            </Button>
          ) : null}
        </Flex>
      ))}
      <Field
        label="Version Note"
        textarea
        minRows={2}
        placeholder="What changed, for people reading the version history"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={error ?? undefined}
      />
      {aiEnabled && changes.length > 0 ? (
        <Box>
          <Button
            variant="ghost"
            size="sm"
            icon={<PiSparkle />}
            onClick={draftNote}
            loading={drafting}
          >
            Draft with AI
          </Button>
        </Box>
      ) : null}
    </Flex>
  );
}

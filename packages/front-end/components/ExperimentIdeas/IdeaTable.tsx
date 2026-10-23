import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import { useRouter } from "next/router";
import { PiChartLine, PiFlask, PiLightning } from "react-icons/pi";
import { ExperimentIdeaListItem } from "shared/validators";
import { ExperimentIdeaStage } from "shared/types/organization";
import { ago } from "shared/dates";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Owner from "@/components/Avatar/Owner";
import { useDefinitions } from "@/services/DefinitionsContext";
import DerivedStateBadges from "./DerivedStateBadges";
import VotePill from "./VotePill";
import styles from "./ExperimentIdeas.module.scss";

export default function IdeaTable({
  ideas,
  stages,
  onToggleUpvote,
}: {
  ideas: ExperimentIdeaListItem[];
  stages: ExperimentIdeaStage[];
  onToggleUpvote: (idea: ExperimentIdeaListItem) => void;
}) {
  const router = useRouter();
  const { getProjectById } = useDefinitions();
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  return (
    <Table variant="list" stickyHeader roundedCorners>
      <TableHeader>
        <TableRow>
          <TableColumnHeader>Idea</TableColumnHeader>
          <TableColumnHeader>Votes</TableColumnHeader>
          <TableColumnHeader>Stage</TableColumnHeader>
          <TableColumnHeader>Owner</TableColumnHeader>
          <TableColumnHeader>Project</TableColumnHeader>
          <TableColumnHeader>Tags</TableColumnHeader>
          <TableColumnHeader>Linked</TableColumnHeader>
          <TableColumnHeader>Updated</TableColumnHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ideas.map((idea) => {
          const stage = stageMap.get(idea.stage);
          const href = `/experiment-ideas/${idea.id}`;
          return (
            <TableRow
              key={idea.id}
              style={{ cursor: "pointer" }}
              onClick={() => router.push(href)}
            >
              <TableCell style={{ maxWidth: 420 }}>
                <Flex align="center" gap="2" wrap="wrap">
                  <Link href={href} weight="medium">
                    {idea.title}
                  </Link>
                  <DerivedStateBadges
                    states={idea.derivedStates}
                    archived={idea.archived}
                    linkedExperimentCount={idea.linkedExperimentCount}
                  />
                </Flex>
                {idea.description && (
                  <div className={clsx(styles.cardExcerpt, styles.clamp2)}>
                    {idea.description}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <VotePill
                  count={idea.upvoteCount}
                  voted={idea.upvotedByMe}
                  onToggle={() => onToggleUpvote(idea)}
                />
              </TableCell>
              <TableCell>
                <Badge
                  label={stage?.label || "Unknown stage"}
                  color={stage?.color || "gray"}
                  variant="soft"
                  size="sm"
                />
              </TableCell>
              <TableCell>
                <Owner ownerId={idea.owner} />
              </TableCell>
              <TableCell>
                <Text color={idea.project ? "text-high" : "text-mid"}>
                  {idea.project
                    ? getProjectById(idea.project)?.name || idea.project
                    : "All Projects"}
                </Text>
              </TableCell>
              <TableCell>
                <Flex gap="1" wrap="wrap">
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
              </TableCell>
              <TableCell>
                <Flex
                  gap="2"
                  align="center"
                  style={{ color: "var(--color-text-low)" }}
                >
                  {idea.analyticsDashboardId && (
                    <PiChartLine aria-label="Has a linked dashboard" />
                  )}
                  {idea.powerCheck && (
                    <PiLightning aria-label="Power checked" />
                  )}
                  {idea.linkedExperimentCount > 0 && (
                    <Flex align="center" gap="1">
                      <PiFlask aria-label="Linked experiments" />
                      {idea.linkedExperimentCount}
                    </Flex>
                  )}
                </Flex>
              </TableCell>
              <TableCell>
                <Text color="text-mid">{ago(idea.dateUpdated)}</Text>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

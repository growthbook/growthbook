import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import { PiChartLine, PiLightning } from "react-icons/pi";
import { ExperimentIdeaListItem } from "shared/validators";
import { ExperimentIdeaStage } from "shared/types/organization";
import { ago } from "shared/dates";
import Link from "next/link";
import UserAvatar from "@/components/Avatar/UserAvatar";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/ui/Tooltip";
import DerivedStateBadges from "./DerivedStateBadges";
import VotePill from "./VotePill";
import styles from "./ExperimentIdeas.module.scss";

export default function IdeaCard({
  idea,
  stage,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
  onToggleUpvote,
}: {
  idea: ExperimentIdeaListItem;
  stage?: ExperimentIdeaStage;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onToggleUpvote: () => void;
}) {
  const { getOwnerDisplay } = useUser();
  const ownerName = idea.owner ? getOwnerDisplay(idea.owner) : "";

  return (
    <Link
      href={`/experiment-ideas/${idea.id}`}
      className={clsx(
        styles.card,
        draggable && styles.cardDraggable,
        dragging && styles.cardDragging,
      )}
      style={{ borderLeftColor: `var(--${stage?.color || "gray"}-9)` }}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", idea.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className={clsx(styles.cardTitle, styles.clamp2)}>{idea.title}</div>
      {idea.description && (
        <div
          className={clsx(styles.cardExcerpt, styles.clamp2)}
          style={{ marginTop: 6 }}
        >
          {idea.description}
        </div>
      )}
      {(idea.derivedStates.length > 0 || idea.archived) && (
        <Flex mt="2">
          <DerivedStateBadges
            states={idea.derivedStates}
            archived={idea.archived}
            linkedExperimentCount={idea.linkedExperimentCount}
          />
        </Flex>
      )}
      <Flex align="center" gap="2" className={styles.cardFooter}>
        <Tooltip content={ownerName || "Unassigned"}>
          <span>
            <UserAvatar name={ownerName} size="sm" variant="soft" />
          </span>
        </Tooltip>
        <VotePill
          count={idea.upvoteCount}
          voted={idea.upvotedByMe}
          onToggle={onToggleUpvote}
        />
        <Flex align="center" gap="2" ml="auto">
          {idea.analyticsDashboardId && (
            <Tooltip content="Has a linked dashboard">
              <span>
                <PiChartLine aria-label="Has a linked dashboard" />
              </span>
            </Tooltip>
          )}
          {idea.powerCheck && (
            <Tooltip content="Power checked">
              <span>
                <PiLightning aria-label="Power checked" />
              </span>
            </Tooltip>
          )}
          <span>{ago(idea.dateCreated)}</span>
        </Flex>
      </Flex>
    </Link>
  );
}

import { FC } from "react";
import { PiTrash, PiChatCircleDots } from "react-icons/pi";
import { AIChatConversationInterface } from "shared/ai-chat";
import clsx from "clsx";
import styles from "./AIChatPanel.module.scss";

interface Props {
  conversations: AIChatConversationInterface[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function groupByDate(conversations: AIChatConversationInterface[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const thisWeek = new Date(today.getTime() - 7 * 86400000);

  const groups: { label: string; items: AIChatConversationInterface[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This Week", items: [] },
    { label: "Older", items: [] },
  ];

  for (const c of conversations) {
    const d = new Date(c.dateUpdated);
    if (d >= today) {
      groups[0].items.push(c);
    } else if (d >= yesterday) {
      groups[1].items.push(c);
    } else if (d >= thisWeek) {
      groups[2].items.push(c);
    } else {
      groups[3].items.push(c);
    }
  }

  return groups.filter((g) => g.items.length > 0);
}

const AIChatConversationList: FC<Props> = ({
  conversations,
  activeId,
  onSelect,
  onDelete,
}) => {
  if (conversations.length === 0) {
    return (
      <div className={styles.emptyConversations}>
        <PiChatCircleDots size={24} className="text-muted" />
        <span className="text-muted">No conversations yet</span>
      </div>
    );
  }

  const groups = groupByDate(conversations);

  return (
    <div className={styles.conversationList}>
      {groups.map((group) => (
        <div key={group.label}>
          <div className={styles.conversationGroupLabel}>{group.label}</div>
          {group.items.map((c) => (
            <div
              key={c.id}
              className={clsx(styles.conversationItem, {
                [styles.active]: c.id === activeId,
              })}
              onClick={() => onSelect(c.id)}
            >
              <span className={styles.conversationTitle}>{c.title}</span>
              <button
                className={styles.deleteButton}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                title="Delete conversation"
              >
                <PiTrash size={14} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default AIChatConversationList;

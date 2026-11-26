import { Box, Flex } from "@radix-ui/themes";
import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { BsStars } from "react-icons/bs";
import { PiChatCircle, PiFlag } from "react-icons/pi";
import { DashboardCommentThreadInterface } from "shared/enterprise";
import { date } from "shared/dates";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";

interface DashboardComments {
  threads: DashboardCommentThreadInterface[];
  add: (input: {
    threadId?: string;
    blockId?: string;
    annotationDate?: string;
    content: string;
  }) => Promise<void>;
  resolve: (threadId: string) => Promise<void>;
  onSendToAI?: (text: string) => void;
}

const DashboardCommentsContext = createContext<DashboardComments | null>(null);

// Blocks only show comments under this; experiment dashboards have none.
export function DashboardCommentsProvider({
  enabled = true,
  dashboardId,
  version,
  onSendToAI,
  children,
}: {
  // Off: blocks show no comment or annotation buttons.
  enabled?: boolean;
  dashboardId: string;
  // The version on screen: a comment is stamped with it, and later ones are hidden.
  version: number;
  onSendToAI?: (text: string) => void;
  children: ReactNode;
}) {
  const { apiCall } = useAuth();
  const { data, mutate } = useApi<{
    threads: DashboardCommentThreadInterface[];
  }>(`/dashboards/${dashboardId}/comments`, { shouldRun: () => enabled });
  // Stable between renders: charts redraw when their annotations change identity.
  const threads = useMemo(
    () => (data?.threads ?? []).filter((t) => t.version <= version),
    [data, version],
  );
  const call = async (path: string, method: string, body: unknown) => {
    await apiCall(`/dashboards/${dashboardId}/comments${path}`, {
      method,
      body: JSON.stringify(body),
    });
    await mutate();
  };
  if (!enabled) return <>{children}</>;
  return (
    <DashboardCommentsContext.Provider
      value={{
        threads,
        add: (input) => call("", "POST", { ...input, version }),
        resolve: (threadId) => call(`/${threadId}`, "PUT", { resolved: true }),
        onSendToAI,
      }}
    >
      {children}
    </DashboardCommentsContext.Provider>
  );
}

export function DashboardBlockComments({
  blockId,
  blockTitle,
}: {
  blockId: string;
  blockTitle: string;
}) {
  const comments = useContext(DashboardCommentsContext);
  const { getUserDisplay } = useUser();
  const [text, setText] = useState("");
  if (!comments) return null;

  const open = comments.threads.filter(
    (t) => t.blockId === blockId && !t.resolved && !t.annotationDate,
  );
  // ponytail: a new comment joins the block's open thread; add parallel threads if people ask.
  const thread = open[0];
  const count = open.reduce((n, t) => n + t.comments.length, 0);

  return (
    <Popover
      triggerAsChild
      side="bottom"
      align="end"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          color={count ? "violet" : "gray"}
          icon={<PiChatCircle />}
          aria-label={`Comments on ${blockTitle}`}
        >
          {count || ""}
        </Button>
      }
      content={
        <Flex direction="column" gap="3" width="320px">
          {open.map((t) => (
            <Flex key={t.id} direction="column" gap="2">
              {t.comments.map((c, i) => (
                <Flex key={i} direction="column">
                  <Flex align="baseline" gap="2">
                    <Text size="sm" weight="medium">
                      {getUserDisplay(c.userId)}
                    </Text>
                    <Text size="sm" color="text-low">
                      {date(c.date)}
                    </Text>
                  </Flex>
                  <Text size="sm">{c.content}</Text>
                </Flex>
              ))}
              <Flex gap="2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => comments.resolve(t.id)}
                >
                  Resolve
                </Button>
                {comments.onSendToAI ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<BsStars />}
                    onClick={() =>
                      comments.onSendToAI?.(
                        `Comment on "${blockTitle}": ${t.comments
                          .map((c) => c.content)
                          .join("\n")}`,
                      )
                    }
                  >
                    Send to AI
                  </Button>
                ) : null}
              </Flex>
            </Flex>
          ))}
          <Field
            textarea
            minRows={2}
            aria-label={thread ? "Reply" : "Comment"}
            placeholder={thread ? "Reply…" : "Comment on this block…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Box>
            <Button
              size="sm"
              disabled={!text.trim()}
              onClick={async () => {
                await comments.add(
                  thread
                    ? { threadId: thread.id, content: text }
                    : { blockId, content: text },
                );
                setText("");
              }}
            >
              {thread ? "Reply" : "Comment"}
            </Button>
          </Box>
        </Flex>
      }
    />
  );
}

export interface ChartAnnotation {
  id: string;
  date: string;
  text: string;
}

// The dated notes to draw on a block's chart; empty outside a comments provider.
export function useBlockAnnotations(blockId?: string): ChartAnnotation[] {
  const threads = useContext(DashboardCommentsContext)?.threads;
  return useMemo(
    () =>
      (threads ?? []).flatMap((t) =>
        t.blockId === blockId && t.annotationDate && !t.resolved
          ? [
              {
                id: t.id,
                date: t.annotationDate,
                text: t.comments[0]?.content ?? "",
              },
            ]
          : [],
      ),
    [threads, blockId],
  );
}

export function DashboardBlockAnnotations({
  blockId,
  blockTitle,
}: {
  blockId: string;
  blockTitle: string;
}) {
  const comments = useContext(DashboardCommentsContext);
  const annotations = useBlockAnnotations(blockId);
  const [day, setDay] = useState("");
  const [text, setText] = useState("");
  if (!comments) return null;

  return (
    <Popover
      triggerAsChild
      side="bottom"
      align="end"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          color={annotations.length ? "violet" : "gray"}
          icon={<PiFlag />}
          aria-label={`Annotations on ${blockTitle}`}
        >
          {annotations.length || ""}
        </Button>
      }
      content={
        <Flex direction="column" gap="3" width="320px">
          {annotations.map((a) => (
            <Flex key={a.id} align="start" gap="2">
              <Flex direction="column" flexGrow="1">
                <Text size="sm" weight="medium">
                  {date(a.date)}
                </Text>
                <Text size="sm">{a.text}</Text>
              </Flex>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => comments.resolve(a.id)}
              >
                Remove
              </Button>
            </Flex>
          ))}
          <Field
            type="date"
            label="Date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
          <Field
            label="Note"
            placeholder="What happened on this day"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Box>
            <Button
              size="sm"
              disabled={!day || !text.trim()}
              onClick={async () => {
                await comments.add({
                  blockId,
                  annotationDate: day,
                  content: text,
                });
                setDay("");
                setText("");
              }}
            >
              Add annotation
            </Button>
          </Box>
        </Flex>
      }
    />
  );
}

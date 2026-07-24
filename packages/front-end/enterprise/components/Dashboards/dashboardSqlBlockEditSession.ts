import { z } from "zod";
import {
  createDashboardBlockInterface,
  dashboardBlockInterface,
  dashboardGlobalControlsValidator,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  SqlExplorationBlockInterface,
} from "shared/enterprise";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const STORAGE_PREFIX = "dashboard-sql-block-edit:";
const CHANNEL_PREFIX = "dashboard-sql-block-edit:";

const sqlExplorationBlockSchema = z
  .union([dashboardBlockInterface, createDashboardBlockInterface])
  .refine((block) => block.type === "sql-exploration");

const dashboardSqlBlockEditSessionSchema = z.object({
  sessionId: z.string().min(1),
  expiresAt: z.number(),
  block: sqlExplorationBlockSchema,
  dashboardGlobalControls: dashboardGlobalControlsValidator.optional(),
});

const dashboardSqlBlockEditMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("update"),
    sessionId: z.string().min(1),
    block: sqlExplorationBlockSchema,
  }),
  z.object({
    type: z.literal("exit"),
    sessionId: z.string().min(1),
  }),
]);

export type DashboardSqlBlockEditSession = {
  sessionId: string;
  block: DashboardBlockInterfaceOrData<SqlExplorationBlockInterface>;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
};

export type DashboardSqlBlockEditMessage =
  | {
      type: "update";
      sessionId: string;
      block: DashboardBlockInterfaceOrData<SqlExplorationBlockInterface>;
    }
  | {
      type: "exit";
      sessionId: string;
    };

function getStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export function getDashboardSqlBlockEditChannelName(sessionId: string): string {
  return `${CHANNEL_PREFIX}${sessionId}`;
}

export function createDashboardSqlBlockEditSession(
  session: DashboardSqlBlockEditSession,
): void {
  window.localStorage.setItem(
    getStorageKey(session.sessionId),
    JSON.stringify({
      ...session,
      expiresAt: Date.now() + SESSION_TTL_MS,
    }),
  );
}

export function readDashboardSqlBlockEditSession(
  sessionId: string,
): DashboardSqlBlockEditSession | null {
  const storedSession = window.localStorage.getItem(getStorageKey(sessionId));
  if (!storedSession) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(storedSession);
  } catch {
    removeDashboardSqlBlockEditSession(sessionId);
    return null;
  }

  const result = dashboardSqlBlockEditSessionSchema.safeParse(parsed);
  if (
    !result.success ||
    result.data.expiresAt < Date.now() ||
    result.data.block.type !== "sql-exploration"
  ) {
    removeDashboardSqlBlockEditSession(sessionId);
    return null;
  }

  return {
    sessionId: result.data.sessionId,
    block: result.data
      .block as DashboardBlockInterfaceOrData<SqlExplorationBlockInterface>,
    dashboardGlobalControls: result.data.dashboardGlobalControls,
  };
}

export function removeDashboardSqlBlockEditSession(sessionId: string): void {
  window.localStorage.removeItem(getStorageKey(sessionId));
}

export function parseDashboardSqlBlockEditMessage(
  message: unknown,
  sessionId: string,
): DashboardSqlBlockEditMessage | null {
  const result = dashboardSqlBlockEditMessageSchema.safeParse(message);
  if (
    !result.success ||
    result.data.sessionId !== sessionId ||
    ("block" in result.data && result.data.block.type !== "sql-exploration")
  ) {
    return null;
  }
  return result.data as DashboardSqlBlockEditMessage;
}

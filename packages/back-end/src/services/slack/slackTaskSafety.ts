import { createHash } from "node:crypto";
import { getCollection } from "back-end/src/util/mongo.util";

type SlackTaskClaim = { _id: string; createdAt: Date };

export function slackTaskKey(parts: string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

// Infrastructure records use MongoDB's unique _id, not application resource permissions.
export async function claimSlackTask(key: string): Promise<boolean> {
  try {
    await getCollection<SlackTaskClaim>("slacktaskclaims").insertOne({
      _id: key,
      createdAt: new Date(),
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

export async function releaseSlackTask(key: string): Promise<void> {
  await getCollection<SlackTaskClaim>("slacktaskclaims").deleteOne({
    _id: key,
  });
}

export function isCurrentSlackApproval(
  pendingActionId: string | undefined,
  actionId: string,
): boolean {
  return !!pendingActionId && pendingActionId === actionId;
}

export async function getSlackTaskClaimAge(
  key: string,
): Promise<number | null> {
  const claim = await getCollection<SlackTaskClaim>("slacktaskclaims").findOne({
    _id: key,
  });
  return claim ? Date.now() - claim.createdAt.getTime() : null;
}

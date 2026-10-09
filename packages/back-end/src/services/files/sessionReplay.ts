import { S3Client } from "@aws-sdk/client-s3";
import {
  UPLOAD_METHOD,
  S3_SESSION_REPLAY_BUCKET,
  S3_SESSION_REPLAY_BUCKET_EU,
  S3_SESSION_REPLAY_ASSUME_ROLE,
} from "back-end/src/util/secrets";
import { buildS3Client, s3GetObjectBuffer, s3ListByPrefix } from "./s3";

// --- Session-replay helpers ---
// Reads from the session-replay bucket (S3 only) using the session-replay
// client. Used by the session-replay controller to (a) list the gzip-JSON
// chunks for a given session's storage prefix, and (b) hand out signed
// read URLs so the browser can fetch chunks directly from S3 — same pattern
// as AuthorizedImage.

// Which AWS region an org's managed warehouse (and therefore its
// session-replay data) is provisioned in. Mirrors `GrowthbookClickhouseSettings.region`.
export type SessionReplayRegion = "us-east-1" | "eu-west-1";

function getSessionReplayBucket(region: SessionReplayRegion): string {
  return region === "eu-west-1"
    ? S3_SESSION_REPLAY_BUCKET_EU
    : S3_SESSION_REPLAY_BUCKET;
}

const sessionReplayS3Clients = new Map<SessionReplayRegion, S3Client>();

/**
 * S3 client scoped to the session-replay bucket for the given region. May use
 * a different role (via `S3_SESSION_REPLAY_ASSUME_ROLE`) than the uploads
 * client so that read access to replay payloads can be granted independently
 * of write access to the general uploads bucket.
 */
function getSessionReplayS3Client(region: SessionReplayRegion): S3Client {
  let client = sessionReplayS3Clients.get(region);
  if (!client) {
    client = buildS3Client({
      assumeRoleArn: S3_SESSION_REPLAY_ASSUME_ROLE,
      roleSessionName: "growthbook-session-replay-reads",
      region,
    });
    sessionReplayS3Clients.set(region, client);
  }
  return client;
}

/**
 * Returns `true` when the session-replay bucket is configured (S3 mode and
 * `S3_SESSION_REPLAY_BUCKET` set). Use this in the controller to short-circuit
 * with a clean 4xx when the deployment hasn't enabled session-replay reads.
 */
export function isSessionReplayStorageConfigured(
  region: SessionReplayRegion,
): boolean {
  return UPLOAD_METHOD === "s3" && !!getSessionReplayBucket(region);
}

/**
 * Lists every object key under `storagePrefix` in the session-replay bucket
 * for the given region. Returns the raw S3 keys (in S3 ordering, which is
 * lexicographic — callers that need numeric chunk-index ordering should sort
 * after parsing).
 */
export async function listSessionReplayChunks(
  storagePrefix: string,
  region: SessionReplayRegion,
): Promise<string[]> {
  if (!isSessionReplayStorageConfigured(region)) {
    throw new Error(
      "Session-replay storage is not configured (set S3_SESSION_REPLAY_BUCKET / S3_SESSION_REPLAY_BUCKET_EU)",
    );
  }
  return s3ListByPrefix(
    getSessionReplayS3Client(region),
    getSessionReplayBucket(region),
    storagePrefix,
  );
}

/**
 * Fetches a single session-replay chunk (gzipped JSON) from the session-replay
 * bucket. Routed through the session-replay S3 client so the bucket+role for
 * replay storage stay independent of the general uploads bucket.
 */
export async function getSessionReplayObjectBuffer(
  key: string,
  region: SessionReplayRegion,
): Promise<Buffer> {
  if (!isSessionReplayStorageConfigured(region)) {
    throw new Error(
      "Session-replay storage is not configured (set S3_SESSION_REPLAY_BUCKET / S3_SESSION_REPLAY_BUCKET_EU)",
    );
  }
  return s3GetObjectBuffer(
    getSessionReplayS3Client(region),
    getSessionReplayBucket(region),
    key,
  );
}

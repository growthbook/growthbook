/** If the server reports streaming but nothing was written recently, treat as stale. */
export const REMOTE_STREAM_STALE_MS = 60_000;

/** Poll interval when following a stream from another tab / after navigation. */
export const REMOTE_STREAM_POLL_INTERVAL_MS = 3_000;

jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));

import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import {
  flushPayloadRefreshBuffer,
  withBufferedPayloadRefreshes,
} from "back-end/src/revisions/landingSequence";
import type { Context } from "back-end/src/models/BaseModel";
import { advancedGuardStamp } from "back-end/src/models/BaseModel";

/**
 * The single-entity half of bulk publish's side-effect batching: a landing's
 * refreshes are buffered and flushed once, whether the landing succeeds or
 * compensates — the flush rebuilds from live state, so one refresh at settle
 * time always broadcasts the truth.
 */

const queueRefresh = queueSDKPayloadRefresh as jest.Mock;

function makeContext(): Context {
  return { sdkPayloadRefreshBuffer: null } as unknown as Context;
}

/** What a model write hook does when it sees a buffer installed. */
function produceRefresh(context: Context, environment: string, project = "") {
  context.sdkPayloadRefreshBuffer?.keys.push({ environment, project });
}

beforeEach(() => queueRefresh.mockClear());

describe("withBufferedPayloadRefreshes", () => {
  it("flushes once, deduped, after a multi-step landing", async () => {
    const context = makeContext();
    await withBufferedPayloadRefreshes(context, "test-landing", async () => {
      produceRefresh(context, "production"); // root write
      produceRefresh(context, "production"); // cascade touches the same key
      produceRefresh(context, "dev"); // and one other
    });

    expect(queueRefresh).toHaveBeenCalledTimes(1);
    expect(queueRefresh.mock.calls[0][0].payloadKeys).toEqual([
      { environment: "production", project: "" },
      { environment: "dev", project: "" },
    ]);
    expect(context.sdkPayloadRefreshBuffer).toBeNull();
  });

  it("still flushes when the landing throws, so compensation state is broadcast", async () => {
    const context = makeContext();
    await expect(
      withBufferedPayloadRefreshes(context, "test-landing", async () => {
        produceRefresh(context, "production"); // partial apply
        produceRefresh(context, "production"); // compensation restore
        throw new Error("apply failed");
      }),
    ).rejects.toThrow("apply failed");

    // The refresh rebuilds from live state, so this one flush serves whatever
    // compensation left behind.
    expect(queueRefresh).toHaveBeenCalledTimes(1);
  });

  it("leaves an enclosing scope's buffer in charge", async () => {
    const context = makeContext();
    await withBufferedPayloadRefreshes(context, "outer", async () => {
      await withBufferedPayloadRefreshes(context, "inner", async () => {
        produceRefresh(context, "production");
      });
      // The inner scope must not have flushed the outer buffer.
      expect(queueRefresh).not.toHaveBeenCalled();
      expect(context.sdkPayloadRefreshBuffer?.keys).toHaveLength(1);
    });
    expect(queueRefresh).toHaveBeenCalledTimes(1);
  });

  it("issues no refresh for a landing that produced none", async () => {
    const context = makeContext();
    await withBufferedPayloadRefreshes(context, "test-landing", async () => {});
    expect(queueRefresh).not.toHaveBeenCalled();
  });
});

describe("flushPayloadRefreshBuffer", () => {
  it("closes the buffer so straggler producers fall through to live refreshes", () => {
    const context = makeContext();
    context.sdkPayloadRefreshBuffer = {
      keys: [{ environment: "production", project: "" }],
      treatEmptyProjectAsGlobal: false,
    };
    const detached = context.sdkPayloadRefreshBuffer;

    flushPayloadRefreshBuffer(context, "test");

    expect(detached.closed).toBe(true);
    expect(context.sdkPayloadRefreshBuffer).toBeNull();
  });
});

describe("advancedGuardStamp", () => {
  it("stamps strictly after the guarded token, even in the same millisecond", () => {
    const now = new Date();
    const stamped = advancedGuardStamp(now);
    expect(stamped.getTime()).toBeGreaterThan(now.getTime());
  });

  it("stamps strictly after a token from a skewed-forward clock", () => {
    const future = new Date(Date.now() + 60_000);
    expect(advancedGuardStamp(future).getTime()).toBeGreaterThan(
      future.getTime(),
    );
  });

  it("stamps wall-clock time when there is no token to advance from", () => {
    const before = Date.now();
    const stamped = advancedGuardStamp(undefined);
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
  });
});

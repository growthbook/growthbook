jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));

import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import {
  flushPayloadRefreshBuffer,
  withBufferedPayloadRefreshes,
} from "back-end/src/revisions/landingSequence";
import { emitOrDeferBulkPublishEvent } from "back-end/src/events/bulkPublishCorrelation";
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

describe("withBufferedPayloadRefreshes — entity events", () => {
  // Deferred through the REAL producer, not by pushing onto the buffer by hand: the
  // buffer's entry shape gained an owner tag and hand-built fixtures went on passing
  // a bare function, which only the runtime noticed.
  const defer = (
    context: Context,
    emit: () => Promise<unknown>,
    entityId = "ent_1",
  ) => emitOrDeferBulkPublishEvent(context, emit, entityId);

  function ctx(): Context {
    return {
      sdkPayloadRefreshBuffer: null,
      bulkPublishDeferredEvents: null,
    } as unknown as Context;
  }

  it("fires deferred entity events only after the landing returns", async () => {
    const context = ctx();
    const order: string[] = [];

    await withBufferedPayloadRefreshes(context, "test", async () => {
      await defer(context, async () => {
        order.push("event");
      });
      order.push("landing-done");
    });

    expect(order).toEqual(["landing-done", "event"]);
  });

  it("drops deferred entity events when the landing throws", async () => {
    const context = ctx();
    const emit = jest.fn();

    await expect(
      withBufferedPayloadRefreshes(context, "test", async () => {
        await defer(context, async () => emit());
        throw new Error("apply failed");
      }),
    ).rejects.toThrow("apply failed");

    // The change was compensated; consumers must never have heard about it.
    expect(emit).not.toHaveBeenCalled();
    // The buffer is left in place, CLOSED — not nulled. A straggler reads this field
    // fresh, so nulling it would hide the disposition and send it to a live emit.
    expect(context.bulkPublishDeferredEvents?.closed).toBe("drop");
  });

  it("leaves an enclosing bulk commit in charge of its own events", async () => {
    const context = ctx();
    const outer: NonNullable<Context["bulkPublishDeferredEvents"]> = {
      entries: [],
    };
    context.bulkPublishDeferredEvents = outer;
    context.sdkPayloadRefreshBuffer = {
      keys: [],
      treatEmptyProjectAsGlobal: false,
    };

    await withBufferedPayloadRefreshes(context, "test", async () => {
      await defer(context, async () => undefined);
    });

    // Pushed onto the bulk list, not flushed by the inner landing.
    expect(outer.entries).toHaveLength(1);
  });
});

/**
 * Late producers, and who owns a deferred event.
 *
 * `onFeatureUpdate` is invoked fire-and-forget and awaits mid-way, so a producer can
 * arrive after the release it belongs to has been decided. Read-and-push atomicity
 * doesn't help there — the buffer has to stay reachable with a disposition, or the
 * straggler falls through to a live emit and announces a rolled-back change.
 *
 * Mutating the ownership predicate previously left the whole back-end suite green.
 */
describe("deferred event dispositions", () => {
  function ctx(): Context {
    return {
      sdkPayloadRefreshBuffer: null,
      bulkPublishDeferredEvents: null,
      logger: { warn: jest.fn(), error: jest.fn() },
    } as unknown as Context;
  }

  // A straggler captures NO reference: `emitOrDeferBulkPublishEvent` reads the context
  // fresh when the producer resumes. So these call it plainly after the landing has
  // ended — the earlier versions re-installed the buffer by hand, which faked a
  // capture the real producer never performs and let both cases pass while the
  // disposition was unreachable.
  it("drops a straggler when the landing rolled back", async () => {
    const context = ctx();
    const emit = jest.fn();

    await expect(
      withBufferedPayloadRefreshes(context, "test", async () => {
        throw new Error("apply failed");
      }),
    ).rejects.toThrow("apply failed");

    await emitOrDeferBulkPublishEvent(context, async () => emit(), "ent_1");
    expect(emit).not.toHaveBeenCalled();
  });

  it("lets a straggler emit live when the landing stood", async () => {
    const context = ctx();
    const emit = jest.fn();

    await withBufferedPayloadRefreshes(context, "test", async () => undefined);

    await emitOrDeferBulkPublishEvent(context, async () => emit(), "ent_1");
    expect(emit).toHaveBeenCalledTimes(1);
  });

  // The tag names the DOCUMENT the event describes. A Config root and the descendants
  // its cascade rewrites belong to one release item but are restored independently, so
  // an item-level tag cannot say that the root went back while a descendant did not.
  it("tags a deferred event with the entity it describes", async () => {
    const context = ctx();
    context.bulkPublishDeferredEvents = { entries: [] };
    await emitOrDeferBulkPublishEvent(
      context,
      async () => undefined,
      "cfg_root",
    );
    await emitOrDeferBulkPublishEvent(
      context,
      async () => undefined,
      "cfg_child",
    );

    expect(
      context.bulkPublishDeferredEvents?.entries.map((e) => e.owner),
    ).toEqual(["cfg_root", "cfg_child"]);
  });
});

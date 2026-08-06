jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));

import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import {
  flushPayloadRefreshBuffer,
  withBufferedPayloadRefreshes,
} from "back-end/src/revisions/landingSequence";
import {
  captureEventBuffer,
  emitOrDeferBulkPublishEvent,
} from "back-end/src/events/bulkPublishCorrelation";
import type { DeferredEventBuffer } from "back-end/src/events/bulkPublishCorrelation";
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
  ) => emitOrDeferBulkPublishEvent(emit, entityId, captureEventBuffer(context));

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
    // The buffer belonged to the landing, so the context stops carrying it the moment
    // the landing ends. A suspended producer holds its own reference and needs nothing
    // here; a NEW write must see "no landing", not a finished one's verdict.
    expect(context.bulkPublishDeferredEvents).toBeNull();
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
  // ended — an earlier version re-installed the buffer by hand, which faked a capture
  // the real producer never performs and passed while the branch was unreachable.
  //
  // And it is judged by the SAME question the in-window flush asks: was this DOCUMENT
  // put back? A release-wide verdict cannot answer it — a rollback that leaves one
  // entity durably published must stay silent about the rest and speak about that one.
  it("drops a straggler whose document was restored", async () => {
    const context = ctx();
    const emit = jest.fn();
    let captured: DeferredEventBuffer | null = null;

    await expect(
      withBufferedPayloadRefreshes(context, "test", async () => {
        // Captured DURING the landing, as a real producer does before suspending.
        captured = captureEventBuffer(context);
        // What a compensating restore reports.
        context.bulkPublishRestoredEntities?.add("ent_rolled_back");
        throw new Error("apply failed");
      }),
    ).rejects.toThrow("apply failed");

    await emitOrDeferBulkPublishEvent(
      async () => emit(),
      "ent_rolled_back",
      captured,
    );
    expect(emit).not.toHaveBeenCalled();
  });

  // `captureEventBuffer`'s own contract, asserted directly.
  //
  // Both landing paths now clear the field when they end, so no production path leaves
  // a closed buffer where capture can see one — this guard is belt-and-braces for the
  // two invariants together. Tested here rather than through a landing precisely
  // because a landing cannot reach it: a defensive branch that only fixtures can drive
  // is worth less than none, and this pins what the helper promises instead.
  it.each([
    ["an open landing", { entries: [], restored: new Set<string>() }, true],
    [
      "a finished landing",
      { entries: [], restored: new Set(["ent_1"]), closed: true },
      false,
    ],
  ])("capture returns the buffer for %s", (_label, buffer, expected) => {
    const context = ctx();
    context.bulkPublishDeferredEvents = buffer as DeferredEventBuffer;
    expect(captureEventBuffer(context)).toBe(expected ? buffer : null);
  });

  it("capture returns null when no landing is open", () => {
    expect(captureEventBuffer(ctx())).toBeNull();
  });

  // Capture happening AFTER a landing must not adopt it: that is a new write, not a
  // straggler, and judging it by a finished landing's `restored` set silences an
  // ordinary update to an entity some earlier release happened to roll back.
  it("does not adopt a finished landing when capturing after it", async () => {
    const context = ctx();
    const emit = jest.fn();

    await expect(
      withBufferedPayloadRefreshes(context, "test", async () => {
        context.bulkPublishRestoredEntities?.add("ent_1");
        throw new Error("apply failed");
      }),
    ).rejects.toThrow("apply failed");

    expect(captureEventBuffer(context)).toBeNull();
    await emitOrDeferBulkPublishEvent(
      async () => emit(),
      "ent_1",
      captureEventBuffer(context),
    );
    expect(emit).toHaveBeenCalledTimes(1);
  });

  // The case a release-wide "drop" got wrong: an entity left durably published by a
  // failed rollback, whose straggler is the only announcement consumers would get.
  it("emits a straggler whose document was NOT restored", async () => {
    const context = ctx();
    const emit = jest.fn();

    await expect(
      withBufferedPayloadRefreshes(context, "test", async () => {
        context.bulkPublishRestoredEntities?.add("ent_rolled_back");
        throw new Error("apply failed");
      }),
    ).rejects.toThrow("apply failed");

    await emitOrDeferBulkPublishEvent(
      async () => emit(),
      "ent_stuck",
      captureEventBuffer(context),
    );
    expect(emit).toHaveBeenCalledTimes(1);
  });

  // The partial-state branch, per DOCUMENT. Compensation that fails partway leaves
  // some documents live and puts others back, and one landing emits for both sets —
  // so the root of a Config cascade that WAS restored would otherwise assert its
  // published value over live pre-image state.
  it("on partial state, emits only for documents that were not restored", async () => {
    const context = ctx();
    const stuck = jest.fn();
    const rolledBack = jest.fn();

    await expect(
      withBufferedPayloadRefreshes(context, "test", async () => {
        await emitOrDeferBulkPublishEvent(
          async () => stuck(),
          "cfg_child",
          captureEventBuffer(context),
        );
        await emitOrDeferBulkPublishEvent(
          async () => rolledBack(),
          "cfg_root",
          captureEventBuffer(context),
        );
        // The root went back; the descendant could not.
        context.bulkPublishRestoredEntities?.add("cfg_root");
        context.landingLeftPartialState = true;
        throw new Error("compensation left partial state");
      }),
    ).rejects.toThrow("compensation left partial state");

    expect(stuck).toHaveBeenCalledTimes(1);
    expect(rolledBack).not.toHaveBeenCalled();
  });

  it("lets a straggler emit live when the landing stood", async () => {
    const context = ctx();
    const emit = jest.fn();

    await withBufferedPayloadRefreshes(context, "test", async () => undefined);

    await emitOrDeferBulkPublishEvent(
      async () => emit(),
      "ent_1",
      captureEventBuffer(context),
    );
    expect(emit).toHaveBeenCalledTimes(1);
  });

  // A straggler belongs to the landing whose WRITE it describes, not to whichever
  // landing happens to be open when it resumes. Without capturing the buffer at write
  // time, a loop publishing several entities in turn — an experiment start, the ramp
  // poller — misattributes in both directions: an event dropped because an unrelated
  // later landing rolled back, or emitted because an unrelated later landing stood.
  it("judges a straggler by the landing it belongs to, not the one now open", async () => {
    const context = ctx();
    const emit = jest.fn();
    let captured: Context["bulkPublishDeferredEvents"] = null;

    // Landing #1 stands, and its producer suspends before emitting.
    await withBufferedPayloadRefreshes(context, "test", async () => {
      captured = captureEventBuffer(context);
    });

    // Landing #2 opens and rolls back, taking `ent_1` with it.
    await expect(
      withBufferedPayloadRefreshes(context, "test", async () => {
        context.bulkPublishRestoredEntities?.add("ent_1");
        throw new Error("second landing failed");
      }),
    ).rejects.toThrow("second landing failed");

    // #1's producer resumes now. Reading the context would find #2's buffer and its
    // verdict; the captured one says #1 stood.
    await emitOrDeferBulkPublishEvent(async () => emit(), "ent_1", captured);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  // The mirror: #1 rolled the document back, #2 stands, and the straggler must stay
  // silent rather than inherit #2's success.
  it("does not let a later landing's success revive a rolled-back event", async () => {
    const context = ctx();
    const emit = jest.fn();
    let captured: Context["bulkPublishDeferredEvents"] = null;

    await expect(
      withBufferedPayloadRefreshes(context, "test", async () => {
        captured = captureEventBuffer(context);
        context.bulkPublishRestoredEntities?.add("ent_1");
        throw new Error("first landing failed");
      }),
    ).rejects.toThrow("first landing failed");

    await withBufferedPayloadRefreshes(context, "test", async () => undefined);

    await emitOrDeferBulkPublishEvent(async () => emit(), "ent_1", captured);
    expect(emit).not.toHaveBeenCalled();
  });

  // A straggler that resumes WHILE the next landing is open must not join its buffer.
  it("does not push into a later landing's open buffer", async () => {
    const context = ctx();
    const emit = jest.fn();
    let captured: Context["bulkPublishDeferredEvents"] = null;

    await withBufferedPayloadRefreshes(context, "test", async () => {
      captured = captureEventBuffer(context);
    });

    await withBufferedPayloadRefreshes(context, "test", async () => {
      // Mid-flight in landing #2, exactly when the producer resumes.
      await emitOrDeferBulkPublishEvent(async () => emit(), "ent_1", captured);
      expect(context.bulkPublishDeferredEvents?.entries).toEqual([]);
    });

    // Emitted on #1's verdict, not queued onto #2.
    expect(emit).toHaveBeenCalledTimes(1);
  });

  // A write made OUTSIDE any landing captures `null`, and null must mean "emit live",
  // not "look at whatever is open now". An ordinary update whose producer suspends
  // while a release starts would otherwise be swallowed by that release's verdict —
  // the same misattribution, from the other side.
  it("emits a write that belonged to no landing at all", async () => {
    const context = ctx();
    const emit = jest.fn();

    // Captured with nothing open.
    const captured = captureEventBuffer(context);
    expect(captured).toBeNull();

    await expect(
      withBufferedPayloadRefreshes(context, "test", async () => {
        context.bulkPublishRestoredEntities?.add("ent_1");
        throw new Error("unrelated landing failed");
      }),
    ).rejects.toThrow("unrelated landing failed");

    await emitOrDeferBulkPublishEvent(async () => emit(), "ent_1", captured);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  // A closed buffer is a leftover for ITS landing's stragglers, not an enclosing
  // scope. Treating it as one let a later failure govern an earlier success on the
  // same context — reachable from any loop that publishes several entities in turn.
  it("does not let one landing's verdict govern the next", async () => {
    const context = ctx();
    const emit = jest.fn();

    await expect(
      withBufferedPayloadRefreshes(context, "test", async () => {
        context.bulkPublishRestoredEntities?.add("ent_1");
        throw new Error("first landing failed");
      }),
    ).rejects.toThrow("first landing failed");

    await withBufferedPayloadRefreshes(context, "test", async () => undefined);

    // Same document, second landing, which stood.
    await emitOrDeferBulkPublishEvent(
      async () => emit(),
      "ent_1",
      captureEventBuffer(context),
    );
    expect(emit).toHaveBeenCalledTimes(1);
  });

  // The tag names the DOCUMENT the event describes. A Config root and the descendants
  // its cascade rewrites belong to one release item but are restored independently, so
  // an item-level tag cannot say that the root went back while a descendant did not.
  it("tags a deferred event with the entity it describes", async () => {
    const context = ctx();
    context.bulkPublishDeferredEvents = { entries: [] };
    await emitOrDeferBulkPublishEvent(
      async () => undefined,
      "cfg_root",
      captureEventBuffer(context),
    );
    await emitOrDeferBulkPublishEvent(
      async () => undefined,
      "cfg_child",
      captureEventBuffer(context),
    );

    expect(
      context.bulkPublishDeferredEvents?.entries.map((e) => e.owner),
    ).toEqual(["cfg_root", "cfg_child"]);
  });
});

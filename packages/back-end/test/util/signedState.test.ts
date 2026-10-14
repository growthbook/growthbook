import { z } from "zod";
import { signState, verifySignedState } from "back-end/src/util/signedState";

const schema = z.strictObject({
  subject: z.string().min(1),
  createdAt: z.number().finite(),
});
const MAX_AGE_MS = 60_000;

describe("signed state", () => {
  it("round-trips a payload", () => {
    const state = signState({ subject: "s1", createdAt: Date.now() });
    expect(verifySignedState(state, schema, MAX_AGE_MS)).toMatchObject({
      status: "valid",
      data: { subject: "s1" },
    });
  });

  it("rejects a tampered payload and a tampered signature", () => {
    const state = signState({ subject: "s1", createdAt: Date.now() });
    const [payload, signature] = state.split(".");
    const flipped = payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A");
    expect(
      verifySignedState(`${flipped}.${signature}`, schema, MAX_AGE_MS),
    ).toEqual({ status: "invalid" });
    expect(
      verifySignedState(`${payload}.${signature}x`, schema, MAX_AGE_MS),
    ).toEqual({ status: "invalid" });
  });

  it("rejects malformed states and payloads outside the schema", () => {
    expect(verifySignedState("", schema, MAX_AGE_MS)).toEqual({
      status: "invalid",
    });
    expect(verifySignedState("a.b.c", schema, MAX_AGE_MS)).toEqual({
      status: "invalid",
    });
    const extra = signState({ subject: "s1", createdAt: Date.now(), more: 1 });
    expect(verifySignedState(extra, schema, MAX_AGE_MS)).toEqual({
      status: "invalid",
    });
  });

  it("expires stale and future states", () => {
    const stale = signState({
      subject: "s1",
      createdAt: Date.now() - MAX_AGE_MS - 1,
    });
    const future = signState({ subject: "s1", createdAt: Date.now() + 5_000 });
    expect(verifySignedState(stale, schema, MAX_AGE_MS)).toEqual({
      status: "expired",
    });
    expect(verifySignedState(future, schema, MAX_AGE_MS)).toEqual({
      status: "expired",
    });
  });
});

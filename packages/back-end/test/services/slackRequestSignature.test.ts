import { createHmac } from "node:crypto";
import { isSlackSignatureValid } from "back-end/src/services/slack/slackRequestSignature";

const secret = "signing-secret";
const rawBody = '{"type":"event_callback","event_id":"Ev1"}';
const nowSeconds = 1_700_000_000;
const timestamp = String(nowSeconds - 30);

const signWith = (s: string, ts: string, body: string) =>
  `v0=${createHmac("sha256", s).update(`v0:${ts}:${body}`).digest("hex")}`;

const valid = {
  secret,
  timestamp,
  signature: signWith(secret, timestamp, rawBody),
  rawBody,
  nowSeconds,
};

it("accepts a fresh signature over the exact raw body", () => {
  expect(isSlackSignatureValid(valid)).toBe(true);
});

it("rejects a signature made with another secret", () => {
  expect(
    isSlackSignatureValid({
      ...valid,
      signature: signWith("other", timestamp, rawBody),
    }),
  ).toBe(false);
});

it("rejects when the body differs from what was signed", () => {
  expect(
    isSlackSignatureValid({ ...valid, rawBody: rawBody.replace("Ev1", "Ev2") }),
  ).toBe(false);
});

it("rejects a timestamp older than five minutes", () => {
  const stale = String(nowSeconds - 5 * 60 - 1);
  expect(
    isSlackSignatureValid({
      ...valid,
      timestamp: stale,
      signature: signWith(secret, stale, rawBody),
    }),
  ).toBe(false);
});

it("rejects a non-numeric timestamp", () => {
  expect(
    isSlackSignatureValid({
      ...valid,
      timestamp: "soon",
      signature: signWith(secret, "soon", rawBody),
    }),
  ).toBe(false);
});

it.each([
  ["secret", { secret: "" }],
  ["timestamp", { timestamp: undefined }],
  ["signature", { signature: undefined }],
  ["rawBody", { rawBody: undefined }],
])("rejects when %s is missing", (_name, overrides) => {
  expect(isSlackSignatureValid({ ...valid, ...overrides })).toBe(false);
});

it("rejects a signature of a different length without throwing", () => {
  expect(isSlackSignatureValid({ ...valid, signature: "v0=abc" })).toBe(false);
});

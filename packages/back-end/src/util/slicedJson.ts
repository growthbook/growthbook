import crypto from "crypto";
import type { Response } from "express";
import { yieldEventLoop } from "back-end/src/util/yield";

/**
 * Sends `{ ...fields, [key]: items }` as a 200 JSON response like `res.json`,
 * but serializes and hashes one item at a time, yielding between them, so a
 * large list doesn't hold the event loop in one block. The ETag is set from
 * that hash, so a matching `If-None-Match` still gets a 304. Sends nothing
 * once `signal` aborts.
 */
export async function sendJsonWithSlicedList(
  res: Response,
  fields: Record<string, unknown>,
  key: string,
  items: unknown[],
  signal: AbortSignal,
): Promise<void> {
  const chunks: string[] = [];
  const hash = crypto.createHash("sha1");
  let length = 0;
  const add = (chunk: string) => {
    chunks.push(chunk);
    hash.update(chunk);
    length += Buffer.byteLength(chunk);
  };

  const head = JSON.stringify(fields).slice(0, -1);
  add(`${head}${head.length > 1 ? "," : ""}${JSON.stringify(key)}:[`);
  for (let i = 0; i < items.length; i++) {
    if (signal.aborted) return;
    await yieldEventLoop(i);
    add(`${i ? "," : ""}${JSON.stringify(items[i])}`);
  }
  add("]}");
  if (signal.aborted) return;

  // `res.send` keeps an ETag that's already set and answers a match with 304
  res.set("ETag", `W/"${length.toString(16)}-${hash.digest("base64")}"`);
  res.type("json").status(200).send(chunks.join(""));
}

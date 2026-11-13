import type { ModelMessage } from "ai";
import { z } from "zod";
import {
  answeredToolCalls,
  pendingToolCalls,
  type ClientToolResult,
} from "back-end/src/api/visual-editor-ai/toolLoopEnvelope";

// The extension renders the model's draft on the live page and screenshots
// it (previewScreenshot). The image bytes ride next to the signed transcript
// in `resume.images`, never inside it: the envelope is re-sent every round,
// so an image in it would be paid for on every later request. The model sees
// each screenshot once, in a user message right after the tool results; the
// transcript keeps only the JSON result.

export const PREVIEW_SCREENSHOT_TOOL = "previewScreenshot";

// Each shot is a paid vision input plus a step, and one or two are enough to
// check a draft.
export const SCREENSHOTS_PER_TURN_MAX = 3;
export const SCREENSHOTS_PER_ROUND_MAX = 2;

export const screenshotImageSchema = z.object({
  toolCallId: z.string().min(1).max(200),
  // The extension sends ~1024px JPEGs, far below this; the cap keeps the
  // resume body (original request + envelope + images) under the 10mb limit.
  data: z
    .string()
    .min(1)
    .max(1.5 * 1024 * 1024),
  mimeType: z.enum(["image/jpeg", "image/png"]),
});

export type ScreenshotImage = z.infer<typeof screenshotImageSchema>;

const SHOWN_NOTE =
  "The screenshot is the image labelled with this tool call id, in the message right after these tool results. It is shown only once — note what you saw.";

// A result the model has already been shown an image for.
function wasShown(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { shown?: unknown }).shown === true
  );
}

// Same draft regardless of the key order the model wrote it in.
function draftKey(input: unknown): string {
  return JSON.stringify(input, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : v,
  );
}

export function screenshotsShown(transcript: ModelMessage[]): number {
  let n = 0;
  for (const m of transcript) {
    if (m.role !== "tool") continue;
    for (const part of m.content) {
      if (
        part.type === "tool-result" &&
        part.toolName === PREVIEW_SCREENSHOT_TOOL &&
        part.output.type === "json" &&
        wasShown(part.output.value)
      ) {
        n++;
      }
    }
  }
  return n;
}

// Pair each image with its previewScreenshot result, enforce the per-turn
// budget, and build the message that shows the images. Returns the results to
// record in the transcript: an answered shot gains `shown: true`; a shot
// with no image, or one over budget, becomes an error the model can act on.
export function attachScreenshots(
  transcript: ModelMessage[],
  results: ClientToolResult[],
  images: ScreenshotImage[],
):
  | { ok: true; results: ClientToolResult[]; message: ModelMessage | null }
  | { ok: false; error: string } {
  const screenshotCalls = new Map(
    pendingToolCalls(transcript)
      .filter((c) => c.toolName === PREVIEW_SCREENSHOT_TOOL)
      .map((c) => [c.toolCallId, draftKey(c.input)]),
  );
  const seenDrafts = new Set(
    answeredToolCalls(transcript)
      .filter(
        (c) => c.toolName === PREVIEW_SCREENSHOT_TOOL && wasShown(c.output),
      )
      .map((c) => draftKey(c.input)),
  );
  const imageFor = new Map<string, ScreenshotImage>();
  for (const img of images) {
    if (!screenshotCalls.has(img.toolCallId)) {
      return {
        ok: false,
        error: `Screenshot ${img.toolCallId} doesn't answer a pending ${PREVIEW_SCREENSHOT_TOOL} call.`,
      };
    }
    if (imageFor.has(img.toolCallId)) {
      return {
        ok: false,
        error: `Duplicate screenshot for call ${img.toolCallId}.`,
      };
    }
    imageFor.set(img.toolCallId, img);
  }

  let shown = screenshotsShown(transcript);
  const attached: ScreenshotImage[] = [];
  const out = results.map((r): ClientToolResult => {
    if (r.toolName !== PREVIEW_SCREENSHOT_TOOL) return r;
    const img = imageFor.get(r.toolCallId);
    const value =
      r.result && typeof r.result === "object" && !Array.isArray(r.result)
        ? (r.result as Record<string, unknown>)
        : {};
    if (!img) {
      // The extension's own failure (element not found, tab hidden, …)
      // passes through; a claimed success without bytes does not.
      return value.ok === false
        ? r
        : {
            ...r,
            result: { ok: false, error: "No screenshot was captured." },
          };
    }
    const key = screenshotCalls.get(r.toolCallId) ?? "";
    if (seenDrafts.has(key)) {
      return {
        ...r,
        result: {
          ok: false,
          error:
            "You already saw a screenshot of this exact draft. Change the draft or finish from what you saw.",
        },
      };
    }
    if (shown >= SCREENSHOTS_PER_TURN_MAX) {
      return {
        ...r,
        result: {
          ok: false,
          error: `Screenshot budget for this request (${SCREENSHOTS_PER_TURN_MAX}) is used up. Finish from what you have.`,
        },
      };
    }
    shown++;
    seenDrafts.add(key);
    attached.push(img);
    return {
      ...r,
      result: { ...value, ok: true, shown: true, note: SHOWN_NOTE },
    };
  });

  return {
    ok: true,
    results: out,
    message:
      attached.length === 0
        ? null
        : {
            role: "user",
            content: attached.flatMap((img) => [
              {
                type: "text" as const,
                text: `Screenshot for ${PREVIEW_SCREENSHOT_TOOL} call ${img.toolCallId}:`,
              },
              {
                type: "image" as const,
                image: Buffer.from(img.data, "base64"),
                mediaType: img.mimeType,
              },
            ]),
          },
  };
}

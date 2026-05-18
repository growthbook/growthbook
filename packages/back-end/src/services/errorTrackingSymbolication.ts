import { SourceMapConsumer } from "source-map";
import { ErrorSourceMapModel } from "back-end/src/models/ErrorSourceMapModel";

export type RawStackFrame = {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
};

export type SymbolicatedStackLine = {
  number: number;
  content: string;
  highlight: boolean;
};

export type SymbolicatedStackFrame = {
  function?: string;
  minified?: {
    filename?: string;
    line?: number;
    column?: number;
  };
  original?: {
    filename?: string;
    line?: number;
    column?: number;
  };
  resolved: boolean;
  context?: {
    line: number;
    content: string;
    lines: SymbolicatedStackLine[];
  };
};

export type SymbolicatedStack = {
  frames: SymbolicatedStackFrame[];
  text: string;
  resolvedFrameCount: number;
};

const CHROME_STACK_RE =
  /^\s*at (?:(?:async\s+)?([^()]+?)\s+)?\(?(.+?):(\d+):(\d+)\)?$/;
const FIREFOX_STACK_RE = /^(.*?)@(.+?):(\d+):(\d+)$/;

export function normalizeStackUrl(url: string): string {
  let value = url.trim();
  value = value.replace(/^webpack-internal:\/\/\/+/, "");
  value = value.replace(/^\(app-pages-browser\)\/+/, "");

  try {
    const parsed = new URL(value, "http://localhost");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return value.replace(/^\.\/+/, "").split("?")[0] ?? value;
  }
}

export function stackUrlKeys(url: string): string[] {
  const keys = new Set<string>();
  const trimmed = url.trim();
  if (!trimmed) return [];

  keys.add(trimmed);
  keys.add(normalizeStackUrl(trimmed));

  try {
    const parsed = new URL(trimmed, "http://localhost");
    keys.add(parsed.href);
    keys.add(`${parsed.pathname}${parsed.search}`);
    const basename = parsed.pathname.split("/").pop();
    if (basename) keys.add(basename);
  } catch {
    const basename = trimmed.split("/").pop();
    if (basename) keys.add(basename);
  }

  return [...keys];
}

export function parseStackFramesFromProperties(
  properties: Record<string, unknown>,
): RawStackFrame[] {
  const fromProps = properties.stackFrames;
  if (Array.isArray(fromProps)) {
    return fromProps.map((frame) => {
      const raw = frame as Record<string, unknown>;
      return {
        filename: raw.filename ? String(raw.filename) : undefined,
        function: raw.function ? String(raw.function) : undefined,
        lineno: typeof raw.lineno === "number" ? raw.lineno : undefined,
        colno: typeof raw.colno === "number" ? raw.colno : undefined,
      };
    });
  }

  const stack = properties.stack;
  if (typeof stack !== "string" || !stack) return [];
  return parseStackFromString(stack);
}

export function parseStackFromString(stack: string): RawStackFrame[] {
  const frames: RawStackFrame[] = [];
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    let match = CHROME_STACK_RE.exec(line);
    if (!match) {
      match = FIREFOX_STACK_RE.exec(line) as RegExpExecArray | null;
    }
    if (!match) continue;

    frames.push({
      function: (match[1] || "").trim() || undefined,
      filename: match[2],
      lineno: parseInt(match[3] || "0", 10) || undefined,
      colno: parseInt(match[4] || "0", 10) || undefined,
    });
  }
  return frames;
}

export function pickSourceMapUrl(
  frameFilename: string,
  maps: { minifiedUrl: string }[],
): string | null {
  const frameKeys = stackUrlKeys(frameFilename);
  if (!frameKeys.length) return null;

  for (const map of maps) {
    const mapKeys = stackUrlKeys(map.minifiedUrl);
    if (frameKeys.some((frameKey) => mapKeys.includes(frameKey))) {
      return map.minifiedUrl;
    }
    if (
      mapKeys.some((mapKey) =>
        frameKeys.some(
          (frameKey) => frameKey.endsWith(mapKey) || mapKey.endsWith(frameKey),
        ),
      )
    ) {
      return map.minifiedUrl;
    }
  }

  return null;
}

function buildContextSnippet(
  content: string,
  line: number,
  radius = 2,
): SymbolicatedStackFrame["context"] {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, line - 1 - radius);
  const end = Math.min(lines.length, line + radius);
  const contextLines: SymbolicatedStackLine[] = [];

  for (let index = start; index < end; index++) {
    contextLines.push({
      number: index + 1,
      content: lines[index] ?? "",
      highlight: index + 1 === line,
    });
  }

  return {
    line,
    content: lines[line - 1] ?? "",
    lines: contextLines,
  };
}

export function formatSymbolicatedStack(
  frames: SymbolicatedStackFrame[],
  message?: string,
): string {
  const lines: string[] = [];
  if (message) lines.push(message);

  for (const frame of frames) {
    const fn = frame.function || "<anonymous>";
    if (frame.original?.filename) {
      const location = `${frame.original.filename}:${frame.original.line ?? "?"}:${frame.original.column ?? "?"}`;
      lines.push(`    at ${fn} (${location})`);
      continue;
    }
    if (frame.minified?.filename) {
      const location = `${frame.minified.filename}:${frame.minified.line ?? "?"}:${frame.minified.column ?? "?"}`;
      lines.push(`    at ${fn} (${location})`);
      continue;
    }
    lines.push(`    at ${fn}`);
  }

  return lines.join("\n");
}

function stackMessage(properties: Record<string, unknown>): string | undefined {
  const stack = properties.stack;
  if (typeof stack === "string") {
    const firstLine = stack.split("\n").find((line) => line.trim());
    if (firstLine && !firstLine.trim().startsWith("at ")) {
      return firstLine.trim();
    }
  }

  const title = properties.title;
  if (typeof title === "string" && title.trim()) {
    return title.trim();
  }

  return undefined;
}

function unresolvedFrames(frames: RawStackFrame[]): SymbolicatedStackFrame[] {
  return frames.map((frame) => ({
    function: frame.function,
    minified: {
      filename: frame.filename,
      line: frame.lineno,
      column: frame.colno,
    },
    resolved: false,
  }));
}

async function getConsumer(
  cache: Map<string, SourceMapConsumer>,
  sourceMapJson: string,
): Promise<SourceMapConsumer> {
  const existing = cache.get(sourceMapJson);
  if (existing) return existing;

  const consumer = await new SourceMapConsumer(JSON.parse(sourceMapJson));
  cache.set(sourceMapJson, consumer);
  return consumer;
}

export async function buildSymbolicatedStack({
  organizationId,
  clientKey,
  release,
  properties,
}: {
  organizationId: string;
  clientKey: string;
  release: string;
  properties: Record<string, unknown>;
}): Promise<SymbolicatedStack | null> {
  const frames = parseStackFramesFromProperties(properties);
  if (!frames.length) return null;

  const message = stackMessage(properties);
  const unresolved = unresolvedFrames(frames);
  const fallbackText =
    typeof properties.stack === "string" && properties.stack
      ? properties.stack
      : formatSymbolicatedStack(unresolved, message);

  if (!release) {
    return {
      frames: unresolved,
      text: fallbackText,
      resolvedFrameCount: 0,
    };
  }

  const maps = await ErrorSourceMapModel.find({
    organization: organizationId,
    clientKey,
    release,
  })
    .select({ minifiedUrl: 1, sourceMapJson: 1 })
    .limit(500)
    .lean();

  if (!maps.length) {
    return {
      frames: unresolved,
      text: fallbackText,
      resolvedFrameCount: 0,
    };
  }

  const mapByUrl = new Map(maps.map((map) => [map.minifiedUrl, map]));
  const consumerCache = new Map<string, SourceMapConsumer>();
  const resolvedFrames: SymbolicatedStackFrame[] = [];
  let resolvedFrameCount = 0;

  try {
    for (const frame of frames) {
      const base: SymbolicatedStackFrame = {
        function: frame.function,
        minified: {
          filename: frame.filename,
          line: frame.lineno,
          column: frame.colno,
        },
        resolved: false,
      };

      if (!frame.filename || !frame.lineno) {
        resolvedFrames.push(base);
        continue;
      }

      const mapUrl = pickSourceMapUrl(frame.filename, maps);
      const map = mapUrl ? mapByUrl.get(mapUrl) : undefined;
      if (!map?.sourceMapJson) {
        resolvedFrames.push(base);
        continue;
      }

      try {
        const consumer = await getConsumer(consumerCache, map.sourceMapJson);
        const position = consumer.originalPositionFor({
          line: frame.lineno,
          column: frame.colno ?? 0,
        });

        if (!position.source) {
          resolvedFrames.push(base);
          continue;
        }

        const resolved: SymbolicatedStackFrame = {
          ...base,
          function: position.name || frame.function,
          original: {
            filename: position.source,
            line: position.line ?? undefined,
            column: position.column ?? undefined,
          },
          resolved: true,
        };

        if (position.line && position.source) {
          try {
            const sourceContent = consumer.sourceContentFor(position.source);
            if (sourceContent) {
              resolved.context = buildContextSnippet(
                sourceContent,
                position.line,
              );
            }
          } catch {
            // Best-effort source context only.
          }
        }

        resolvedFrameCount += 1;
        resolvedFrames.push(resolved);
      } catch {
        resolvedFrames.push(base);
      }
    }
  } finally {
    for (const consumer of consumerCache.values()) {
      consumer.destroy();
    }
  }

  return {
    frames: resolvedFrames,
    text: formatSymbolicatedStack(resolvedFrames, message),
    resolvedFrameCount,
  };
}

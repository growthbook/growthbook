/**
 * Optional structured debug tracing for the contextual-bandit weight pipeline.
 *
 * The stats-ts library stays pure: it never reads environment variables and
 * never writes to the console. Instead a caller (e.g. the back-end) may pass a
 * `ContextualBanditDebugLogger` through `ContextualBanditWeightsInput.debug` to
 * receive structured, per-stage events, which it can route to its own logger.
 * When no logger is supplied every trace call is a cheap no-op, so leaving the
 * instrumentation in place costs nothing in production.
 */

/** Ordered stages emitted while computing contextual-bandit weights. */
export type ContextualBanditDebugStage =
  | "input"
  | "partition"
  | "tree:start"
  | "tree:candidate"
  | "tree:split"
  | "tree:stop"
  | "tree:done"
  | "leaf:weights"
  | "result";

/**
 * Sink for a single trace event. `message` is a short human-readable summary;
 * `data` carries the structured payload for that stage (safe to JSON-stringify).
 */
export type ContextualBanditDebugLogger = (
  stage: ContextualBanditDebugStage,
  message: string,
  data?: Record<string, unknown>,
) => void;

/**
 * Sink for a named debug artifact (e.g. a CSV dump of the k-means split search
 * or a per-iteration leaf assignment). `name` is a filename-safe identifier and
 * `contents` is the full text to persist. The stats library only *builds* these
 * strings — where (and whether) they are written is entirely up to the caller,
 * so the engine stays free of any filesystem/env coupling.
 */
export type ContextualBanditDebugArtifactSink = (
  name: string,
  contents: string,
) => void;

/**
 * Thin wrapper the pipeline uses so call sites never have to null-check the
 * caller-supplied sinks. When a sink is undefined the corresponding `emit`
 * short-circuits before building its (potentially expensive) payload, keeping
 * disabled tracing/artifact-capture free.
 */
export class ContextualBanditDebug {
  private readonly logger?: ContextualBanditDebugLogger;
  private readonly artifactSink?: ContextualBanditDebugArtifactSink;

  constructor(
    logger?: ContextualBanditDebugLogger,
    artifactSink?: ContextualBanditDebugArtifactSink,
  ) {
    this.logger = logger;
    this.artifactSink = artifactSink;
  }

  get enabled(): boolean {
    return this.logger !== undefined;
  }

  /**
   * True when a caller wants named CSV/text artifacts. Independent of
   * `enabled`, so heavyweight artifact capture and per-stage logging can be
   * toggled separately.
   */
  get artifactsEnabled(): boolean {
    return this.artifactSink !== undefined;
  }

  /**
   * Emit a trace event. `build` is only invoked when a logger is attached, so
   * payloads that are expensive to assemble are skipped when tracing is off.
   */
  emit(
    stage: ContextualBanditDebugStage,
    message: string,
    build?: () => Record<string, unknown>,
  ): void {
    if (!this.logger) return;
    this.logger(stage, message, build ? build() : undefined);
  }

  /**
   * Emit a named text artifact (e.g. a CSV dump). `build` is only invoked when
   * an artifact sink is attached, so the (often large) CSV string is never
   * assembled when artifact capture is off.
   */
  emitArtifact(name: string, build: () => string): void {
    if (!this.artifactSink) return;
    this.artifactSink(name, build());
  }
}

/** Round to a fixed number of significant digits for compact, stable trace output. */
export function roundForDebug(value: number, sigDigits = 6): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const magnitude = Math.ceil(Math.log10(Math.abs(value)));
  const power = sigDigits - magnitude;
  const factor = Math.pow(10, power);
  return Math.round(value * factor) / factor;
}

/** Round every element of a numeric array for trace output. */
export function roundArrayForDebug(values: number[], sigDigits = 6): number[] {
  return values.map((v) => roundForDebug(v, sigDigits));
}

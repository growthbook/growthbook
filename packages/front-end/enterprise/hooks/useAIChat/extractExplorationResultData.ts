const EXPLORATION_PATH_RE =
  /^\/api\/v1\/product-analytics\/(metric|fact-table|data-source|funnel)-exploration\/?$/;

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return recordFromUnknown(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeApiPath(rawPath: string): string {
  const path = rawPath.split("?")[0];
  if (path.startsWith("/api/")) return path;
  if (/^\/v\d+\//.test(path)) return `/api${path}`;
  if (path.startsWith("/")) return `/api/v1${path}`;
  return path;
}

function hasChartConfig(
  data: Record<string, unknown>,
  exploration: Record<string, unknown>,
): boolean {
  const config = data.config ?? exploration.config;
  return !!config && typeof config === "object" && !Array.isArray(config);
}

function extractRunExplorationResultData(
  output: unknown,
): Record<string, unknown> | undefined {
  const result = recordFromUnknown(output);
  if (!result || result.status !== "success") return undefined;

  const exploration = recordFromUnknown(result.exploration);
  if (!exploration || !hasChartConfig(result, exploration)) return undefined;

  const data: Record<string, unknown> = {
    exploration: result.exploration,
  };
  if (typeof result.snapshotId === "string") {
    data.snapshotId = result.snapshotId;
  }
  if (result.config !== undefined) data.config = result.config;
  return data;
}

function extractCallApiExplorationResultData(
  input: unknown,
  output: unknown,
): Record<string, unknown> | undefined {
  const toolInput = recordFromUnknown(input);
  if (
    !toolInput ||
    toolInput.method !== "POST" ||
    typeof toolInput.path !== "string" ||
    !EXPLORATION_PATH_RE.test(normalizeApiPath(toolInput.path))
  ) {
    return undefined;
  }

  const result = recordFromUnknown(output);
  if (
    !result ||
    typeof result.status !== "number" ||
    !Number.isInteger(result.status) ||
    result.status < 200 ||
    result.status >= 300
  ) {
    return undefined;
  }

  const body = recordFromUnknown(result.body);
  const exploration = body ? recordFromUnknown(body.exploration) : null;
  if (
    !body ||
    !exploration ||
    exploration.status !== "success" ||
    !hasChartConfig(body, exploration)
  ) {
    return undefined;
  }

  return body;
}

export function extractExplorationResultData(
  toolName: string,
  input: unknown,
  output: unknown,
): Record<string, unknown> | undefined {
  if (toolName === "runExploration") {
    return extractRunExplorationResultData(output);
  }
  if (toolName === "callApi") {
    return extractCallApiExplorationResultData(input, output);
  }
  return undefined;
}

import type { OrganizationInterface } from "shared/types/organization";
import {
  ApiErrorDetails,
  ApiNotice,
  ApiSafetyCheckCode,
  STRICT_ENVIRONMENT_CHECKS_LABEL,
} from "shared/validators";
import { ApiError } from "./errors";
import { logger } from "./logger";

class ApiSafetyCheckError<C extends ApiSafetyCheckCode> extends ApiError<C> {
  constructor(code: C, message: string, details: ApiErrorDetails<C>) {
    super(code, message, details);
    this.name = "ApiSafetyCheckError";
  }
}

export function strictEnvironmentChecksOn(
  org: Pick<OrganizationInterface, "settings">,
): boolean {
  return !!org.settings?.strictEnvironmentChecks;
}

export type SafetyCheckRequest = {
  context: { org: Pick<OrganizationInterface, "id" | "settings"> };
  method?: string;
  baseUrl?: string;
  path?: string;
};

// Keyed by request, not context: the in-process dispatcher reuses one context
// across calls.
const noticesByRequest = new WeakMap<object, ApiNotice[]>();

export const NOT_ENFORCED_SUFFIX = `This will be rejected when the organization turns on "${STRICT_ENVIRONMENT_CHECKS_LABEL}".`;

export function applySafetyCheck<C extends ApiSafetyCheckCode>(
  req: SafetyCheckRequest,
  code: C,
  {
    violated,
    message,
    notice,
    path,
    details,
  }: {
    violated: boolean;
    message: string;
    notice: string;
    path?: string;
    details: ApiErrorDetails<C>;
  },
): void {
  if (!violated) return;
  if (strictEnvironmentChecksOn(req.context.org)) {
    throw new ApiSafetyCheckError(code, message, details);
  }
  const notices = noticesByRequest.get(req) ?? [];
  notices.push({
    code,
    message: `${notice} ${NOT_ENFORCED_SUFFIX}`,
    ...(path !== undefined ? { path } : {}),
  });
  noticesByRequest.set(req, notices);
  logger.info(
    {
      code,
      organization: req.context.org.id,
      endpoint: `${req.method ?? ""} ${req.baseUrl ?? ""}${req.path ?? ""}`,
    },
    "API safety check reported as a notice",
  );
}

export function takeApiNotices(req: object): ApiNotice[] {
  const notices = noticesByRequest.get(req) ?? [];
  noticesByRequest.delete(req);
  return notices;
}

export function withRecordedNotices(req: object, body: unknown): unknown {
  const notices = takeApiNotices(req);
  if (
    !notices.length ||
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return body;
  }
  return { ...body, notices };
}

// "a", "a and b", "a, b and c".
export function formatList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

import { z } from "zod";
import type { FilterQuery } from "mongoose";
import type { OrganizationInterface } from "shared/types/organization";

export const adminOrgFiltersValidator = z.object({
  plan: z.enum(["starter", "pro", "enterprise"]).optional(),
  status: z
    .enum([
      "trialing",
      "past_due",
      "canceled",
      "suspended",
      "disabled",
      "has_banner",
    ])
    .optional(),
  minMembers: z.coerce.number().int().min(0).optional(),
  maxMembers: z.coerce.number().int().min(0).optional(),
  createdAfter: z.coerce.date().optional(),
  loginMethod: z.enum(["sso", "sso_required", "none"]).optional(),
});
export type AdminOrgFilters = z.infer<typeof adminOrgFiltersValidator>;

// Starter is everyone without a paid license, so it looks up the paid plans to exclude
export function getLicensePlansForFilter(
  plan: NonNullable<AdminOrgFilters["plan"]>,
): string[] {
  if (plan === "enterprise") return ["enterprise"];
  if (plan === "pro") return ["pro", "pro_sso"];
  return ["pro", "pro_sso", "enterprise"];
}

export function isSubscriptionStatusFilter(
  status: AdminOrgFilters["status"],
): status is "trialing" | "past_due" | "canceled" {
  return (
    status === "trialing" || status === "past_due" || status === "canceled"
  );
}

export type LicenseRefs = { orgIds: string[]; licenseKeys: string[] };
const NO_LICENSES: LicenseRefs = { orgIds: [], licenseKeys: [] };

// The org ID uses the index; the license key skips stale cached licenses an
// org no longer references, so filters agree with the row's summary.
function referencesLicense({ orgIds, licenseKeys }: LicenseRefs) {
  return { id: { $in: orgIds }, licenseKey: { $in: licenseKeys } };
}

// Plan, subscription status, and SSO live in other collections, so the caller
// resolves them first.
export function buildAdminOrgQuery(
  filters: AdminOrgFilters,
  resolved: {
    plan?: LicenseRefs;
    status?: LicenseRefs;
    ssoOrgIds?: string[];
  },
): FilterQuery<OrganizationInterface> {
  const and: FilterQuery<OrganizationInterface>[] = [];
  const plan = resolved.plan ?? NO_LICENSES;

  if (filters.plan === "enterprise") {
    and.push({ $or: [{ enterprise: true }, referencesLicense(plan)] });
  } else if (filters.plan === "pro") {
    and.push({ enterprise: { $ne: true }, ...referencesLicense(plan) });
  } else if (filters.plan === "starter") {
    and.push({
      enterprise: { $ne: true },
      licenseKey: { $nin: plan.licenseKeys },
    });
  }

  if (filters.status === "disabled") {
    and.push({ disabled: true });
  } else if (filters.status === "suspended") {
    and.push({ suspended: true, disabled: { $ne: true } });
  } else if (filters.status === "has_banner") {
    and.push({ "messages.0": { $exists: true } });
  } else if (filters.status) {
    // Disabled and suspended outrank the subscription in getAdminOrgSummary
    and.push({
      ...referencesLicense(resolved.status ?? NO_LICENSES),
      suspended: { $ne: true },
      disabled: { $ne: true },
    });
  }

  const memberCount = { $size: { $ifNull: ["$members", []] } };
  if (filters.minMembers !== undefined) {
    and.push({ $expr: { $gte: [memberCount, filters.minMembers] } });
  }
  if (filters.maxMembers !== undefined) {
    and.push({ $expr: { $lte: [memberCount, filters.maxMembers] } });
  }

  if (filters.createdAfter) {
    and.push({ dateCreated: { $gte: filters.createdAfter } });
  }

  if (filters.loginMethod === "sso_required") {
    and.push({ restrictLoginMethod: { $nin: [null, ""] } });
  } else if (filters.loginMethod === "sso") {
    and.push({ id: { $in: resolved.ssoOrgIds ?? [] } });
  } else if (filters.loginMethod === "none") {
    and.push({ id: { $nin: resolved.ssoOrgIds ?? [] } });
  }

  return and.length ? { $and: and } : {};
}

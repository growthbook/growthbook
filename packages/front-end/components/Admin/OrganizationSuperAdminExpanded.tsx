import { FC, ReactNode, useState } from "react";
import {
  DemographicData,
  ExpandedMember,
  OrganizationInterface,
  OrganizationMessage,
} from "shared/types/organization";
import stringify from "json-stringify-pretty-compact";
import Collapsible from "react-collapsible";
import { FaAngleRight, FaSpinner } from "react-icons/fa";
import { LicenseInterface } from "shared/enterprise";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import { OWNER_JOB_TITLES } from "shared/constants";
import { date } from "shared/dates";
import Code from "@/components/SyntaxHighlighting/Code";
import LoadingSpinner from "@/components/LoadingSpinner";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import { isCloud } from "@/services/env";
import Markdown from "@/components/Markdown/Markdown";
import Callout from "@/ui/Callout";
import type { Status } from "@/ui/HelperText";
import { useAuth } from "@/services/auth";
import EditOrganizationMessages from "@/components/Admin/EditOrganizationMessages";

function orgMessageLevelToCalloutStatus(
  level: OrganizationMessage["level"],
): Status {
  if (level === "danger") return "error";
  if (level === "warning") return "warning";
  return "info";
}

function formatUsageIntentLabel(d: DemographicData | undefined): string {
  const intents = d?.ownerUsageIntents;
  if (intents === undefined) return "unknown";
  if (intents.length === 0) return "none";
  const hasFF = intents.includes("featureFlags");
  const hasExp = intents.includes("experiments");
  if (hasFF && hasExp) return "both";
  if (hasFF) return "feature flags";
  if (hasExp) return "experiments";
  return "none";
}

function formatOwnerJobTitle(d: DemographicData | undefined): string {
  const t = d?.ownerJobTitle;
  if (!t) return "—";
  return OWNER_JOB_TITLES[t] ?? t;
}

function getLicenseBillingSource(
  org: OrganizationInterface,
  license: LicenseInterface | null,
): string {
  if (license?.vercelInstallationId || org.isVercelIntegration) {
    return "vercel";
  }
  if (license?.orbSubscription?.id) {
    return "orb";
  }
  if (license?.stripeSubscription?.id || org.subscription?.id) {
    return "stripe";
  }
  if (org.enterprise) {
    return "legacy enterprise flag";
  }
  if (org.licenseKey || license) {
    return "other";
  }
  return "";
}

function stripeSubscriptionUrl(subscriptionId: string): string {
  return `https://dashboard.stripe.com/subscriptions/${subscriptionId}`;
}

function stripeCustomerUrl(customerId: string): string {
  if (customerId.startsWith("cus_")) {
    return `https://dashboard.stripe.com/customers/${customerId}`;
  }
  return `https://app.withorb.com/customers/${customerId}`;
}

function orbSubscriptionUrl(subscriptionId: string): string {
  return `https://app.withorb.com/subscriptions/${subscriptionId}`;
}

type StripeLikeSub = {
  status: string;
  cancel_at_period_end?: boolean;
  trialEnd?: Date | null;
};

function displaySubscriptionStatus(
  sub: StripeLikeSub | null | undefined,
): string {
  if (!sub?.status) return "—";
  if (sub.status === "canceled") return "cancelled";
  if (sub.cancel_at_period_end) return "pending_cancellation";
  if (["active", "trialing", "past_due"].includes(sub.status)) return "active";
  return sub.status;
}

function OrgCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="bg-white border rounded p-3"
      style={{
        flex: "1 1 280px",
        minWidth: 260,
        maxWidth: 520,
        borderColor: "var(--border-color-200)",
        color: "var(--text-color-main)",
      }}
    >
      <div className="font-weight-bold mb-2 small text-uppercase text-muted">
        {title}
      </div>
      {children}
    </div>
  );
}

function OrgCardFullWidth({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className="bg-white border rounded p-3 w-100"
      style={{
        borderColor: "var(--border-color-200)",
        color: "var(--text-color-main)",
      }}
    >
      <div className="font-weight-bold mb-2 small text-uppercase text-muted">
        {title}
      </div>
      {children}
    </div>
  );
}

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="d-flex flex-wrap justify-content-between gap-2 small mb-1">
      <span className="text-muted">{label}</span>
      <span className="text-break text-right" style={{ maxWidth: "72%" }}>
        {children}
      </span>
    </div>
  );
}

function JsonCollapsible({ label, json }: { label: string; json: unknown }) {
  return (
    <Collapsible
      trigger={
        <button
          type="button"
          className="btn btn-link btn-sm p-0 d-flex align-items-center"
        >
          {label} <FaAngleRight className="chevron ml-1" />
        </button>
      }
      transitionTime={150}
    >
      <div className="mt-2" style={{ maxHeight: 360, overflow: "auto" }}>
        <Code language="json" code={stringify(json)} />
      </div>
    </Collapsible>
  );
}

export const OrganizationSuperAdminExpanded: FC<{
  organization: OrganizationInterface;
  ssoInfo: SSOConnectionInterface | undefined;
  orgMembers: Map<string, ExpandedMember> | null;
  license: LicenseInterface | null;
  licenseLoading: boolean;
  managedWarehouseId: string | null;
  canWrite: boolean;
  onOrgListRefresh: () => void;
  onOpenEditSSO: () => void;
  onOpenCreateManagedWarehouse: () => void;
}> = ({
  organization,
  ssoInfo,
  orgMembers,
  license,
  licenseLoading,
  managedWarehouseId,
  canWrite,
  onOrgListRefresh,
  onOpenEditSSO,
  onOpenCreateManagedWarehouse,
}) => {
  const { settings, members, messages, ...otherAttributes } = organization;
  const { apiCall } = useAuth();
  const [messagesModalOpen, setMessagesModalOpen] = useState(false);

  const orbSub = license?.orbSubscription;
  const stripeFromLicense = license?.stripeSubscription;
  const stripeFromOrg = organization.subscription;

  const stripeSubscriptionId = stripeFromLicense?.id ?? stripeFromOrg?.id;

  const subscriptionForStatus: StripeLikeSub | null = orbSub?.id
    ? orbSub
    : stripeFromLicense?.status
      ? stripeFromLicense
      : stripeFromOrg?.status
        ? (stripeFromOrg as StripeLikeSub)
        : null;

  const isTrial =
    !!license?.isTrial ||
    subscriptionForStatus?.status === "trialing" ||
    !!subscriptionForStatus?.trialEnd;

  const billingSource = getLicenseBillingSource(organization, license);

  const stripeCustomerDisplayId =
    organization.stripeCustomerId ??
    (orbSub?.customerId?.startsWith("cus_") ? orbSub.customerId : undefined);

  const selfServeEnabled = !organization.disableSelfServeBilling;

  return (
    <>
      {messagesModalOpen && (
        <EditOrganizationMessages
          organization={organization}
          onSaved={onOrgListRefresh}
          close={() => setMessagesModalOpen(false)}
        />
      )}

      <div
        className="d-flex flex-wrap"
        style={{ gap: 12, alignItems: "stretch", width: "100%" }}
      >
        <OrgCard title="Meta">
          <KV label="Name">{organization.name}</KV>
          <KV label="Id">
            <code className="small">{organization.id}</code>
          </KV>
          <KV label="Owner email">{organization.ownerEmail}</KV>
          <KV label="Usage intent">
            {formatUsageIntentLabel(organization.demographicData)}
          </KV>
          <KV label="Owner role">
            {formatOwnerJobTitle(organization.demographicData)}
          </KV>
          <div className="mt-2">
            <JsonCollapsible
              label="Full organization JSON"
              json={organization}
            />
          </div>
        </OrgCard>

        <OrgCard title="Auth settings">
          <KV label="Verified domain">{organization.verifiedDomain || "—"}</KV>
          <KV label="Auto approve members">
            {organization.autoApproveMembers ? "Yes" : "No"}
          </KV>
          <KV label="SSO enabled">
            <span>
              {ssoInfo
                ? `Yes (${ssoInfo.id}; ${ssoInfo.emailDomains?.join(", ") || "no domains"})`
                : "No"}
            </span>
            {isCloud() && canWrite && (
              <>
                {" "}
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 align-baseline"
                  onClick={onOpenEditSSO}
                >
                  Edit SSO
                </button>
              </>
            )}
          </KV>
          <KV label="Restrict login method">
            {organization.restrictLoginMethod || "—"}
          </KV>
        </OrgCard>

        <OrgCard title="Messages / alerts">
          {(messages?.length ?? 0) === 0 ? (
            <>
              <div className="text-muted small mb-2">
                No messages configured.
              </div>
              {isCloud() && canWrite && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => setMessagesModalOpen(true)}
                >
                  Add message
                </button>
              )}
              {isCloud() && !canWrite && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setMessagesModalOpen(true)}
                >
                  View messages
                </button>
              )}
            </>
          ) : (
            <>
              <div
                className="d-flex flex-column mb-2"
                style={{ gap: "0.5rem", maxHeight: 320, overflow: "auto" }}
              >
                {(messages || []).map((m: OrganizationMessage, i: number) => (
                  <Callout
                    key={`org-msg-${organization.id}-${i}-${m.level}`}
                    status={orgMessageLevelToCalloutStatus(m.level)}
                    size="sm"
                    contentsAs="div"
                  >
                    <Markdown>{m.message}</Markdown>
                  </Callout>
                ))}
              </div>
              {isCloud() && canWrite && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => setMessagesModalOpen(true)}
                >
                  Edit messages
                </button>
              )}
              {isCloud() && !canWrite && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setMessagesModalOpen(true)}
                >
                  View messages
                </button>
              )}
            </>
          )}
        </OrgCard>

        {isCloud() && (
          <OrgCard title="Managed warehouse">
            <KV label="Status">
              {managedWarehouseId ? (
                <span className="text-success">Enabled</span>
              ) : (
                <span className="text-muted">Disabled</span>
              )}
            </KV>
            <div className="mt-2">
              {!canWrite ? (
                <span className="text-muted small">
                  {managedWarehouseId
                    ? "Read-only — re-generate is disabled."
                    : "Read-only — create is disabled."}
                </span>
              ) : managedWarehouseId ? (
                <ConfirmButton
                  isDestructive
                  onClick={async () => {
                    await apiCall(
                      `/datasource/${managedWarehouseId}/recreate-managed-warehouse`,
                      {
                        method: "POST",
                        headers: { "X-Organization": organization.id },
                      },
                    );
                  }}
                  confirmationText={
                    <span>
                      This may take several minutes and queries during the
                      operation can fail.
                    </span>
                  }
                  modalHeader="Re-generate managed warehouse"
                >
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                  >
                    Re-generate managed warehouse
                  </button>
                </ConfirmButton>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={onOpenCreateManagedWarehouse}
                >
                  Create managed warehouse
                </button>
              )}
            </div>
          </OrgCard>
        )}

        <OrgCard title="License / subscription">
          <KV label="License key">
            {organization.licenseKey ? (
              <code className="small">{organization.licenseKey}</code>
            ) : (
              "—"
            )}
          </KV>
          <KV label="Plan">{license?.plan?.replace(/_/g, " ") ?? "—"}</KV>
          <KV label="Seats">{license?.seats ?? "—"}</KV>
          <KV label="Source">{billingSource || "—"}</KV>
          {stripeSubscriptionId ? (
            <KV label="Stripe subscription">
              <a
                href={stripeSubscriptionUrl(stripeSubscriptionId)}
                target="_blank"
                rel="noreferrer"
              >
                {stripeSubscriptionId}
              </a>
            </KV>
          ) : null}
          {orbSub?.id ? (
            <KV label="Orb subscription">
              <a
                href={orbSubscriptionUrl(orbSub.id)}
                target="_blank"
                rel="noreferrer"
              >
                {orbSub.id}
              </a>
            </KV>
          ) : null}
          {!stripeSubscriptionId && !orbSub?.id ? (
            <KV label="Subscription">—</KV>
          ) : null}
          <KV label="Stripe customer">
            {stripeCustomerDisplayId ? (
              <a
                href={stripeCustomerUrl(stripeCustomerDisplayId)}
                target="_blank"
                rel="noreferrer"
              >
                {stripeCustomerDisplayId}
              </a>
            ) : (
              "—"
            )}
          </KV>
          {orbSub?.customerId && !stripeCustomerDisplayId ? (
            <KV label="Orb customer">
              <a
                href={stripeCustomerUrl(orbSub.customerId)}
                target="_blank"
                rel="noreferrer"
              >
                {orbSub.customerId}
              </a>
            </KV>
          ) : null}
          {billingSource === "orb" && (
            <div className="mt-2">
              <div className="text-muted small mb-1">Orb invoice</div>
              <Callout status="info">
                Signed invoice portal URLs are created in Orb (or via API) and
                are not included on this license object, so they cannot be
                embedded here. See{" "}
                <a
                  href="https://docs.withorb.com/invoicing/invoice-portal"
                  target="_blank"
                  rel="noreferrer"
                >
                  Orb invoice portal
                </a>
                .
              </Callout>
            </div>
          )}
          <KV label="Is trial">{isTrial ? "true" : "false"}</KV>
          <KV label="Status">
            {licenseLoading ? (
              <FaSpinner />
            ) : (
              displaySubscriptionStatus(subscriptionForStatus)
            )}
          </KV>
          <KV label="Self-serve billing enabled">
            {selfServeEnabled ? "true" : "false"}
          </KV>
          {licenseLoading && (
            <div className="small text-muted mt-1">Loading license…</div>
          )}
          {!licenseLoading && license && (
            <div className="mt-2">
              <JsonCollapsible label="Full license JSON" json={license} />
            </div>
          )}
          {!licenseLoading && !license && (
            <div className="text-muted small mt-2">
              No license payload returned for this organization (no license key,
              or fetch failed).
            </div>
          )}
        </OrgCard>

        <OrgCard title="Settings & other">
          <div className="mb-3">
            <JsonCollapsible label="Settings JSON" json={settings ?? {}} />
          </div>
          <p className="small text-muted mb-2">
            Remaining organization fields (excluding settings, members, and
            messages).
          </p>
          <JsonCollapsible label="Other fields JSON" json={otherAttributes} />
        </OrgCard>
      </div>

      <div className="w-100 mt-3">
        <OrgCardFullWidth title="Members">
          <div
            className="d-flex flex-wrap small mb-2"
            style={{ gap: "0.75rem" }}
          >
            <span>
              <span className="font-weight-bold">Seats in use:</span>{" "}
              {members.length}
            </span>
            <span>
              <span className="font-weight-bold">Invited:</span>{" "}
              {organization.invites.length}
            </span>
          </div>
          <div
            className="table-responsive"
            style={{ maxHeight: 400, overflow: "auto" }}
          >
            {!orgMembers ? (
              <LoadingSpinner />
            ) : (
              <table className="table table-sm table-bordered mb-0 w-100">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Id</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const info = orgMembers.get(m.id);
                    return (
                      <tr key={m.id}>
                        <td className="small">{info?.name ?? "—"}</td>
                        <td className="small text-break">
                          {info?.email ?? "—"}
                        </td>
                        <td className="small">{m.role}</td>
                        <td className="small">
                          <code>{m.id}</code>
                        </td>
                        <td className="small text-nowrap">
                          {m.dateCreated ? date(m.dateCreated) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </OrgCardFullWidth>
      </div>
    </>
  );
};

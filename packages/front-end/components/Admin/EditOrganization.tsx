import { useState, FC, useCallback, useEffect } from "react";
import isEqual from "lodash/isEqual";
import { OrganizationInterface } from "shared/types/organization";
import {
  EventForwarderSinkType,
  EventForwarderStatus,
} from "shared/types/event-forwarder";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { Flex, Spinner } from "@radix-ui/themes";
import { hasSuperAdminPermission } from "shared/permissions";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

type EventForwarderRow = {
  datasourceId: string;
  name: string;
  sinkType: EventForwarderSinkType;
  status: EventForwarderStatus;
};

const SINK_TYPE_LABELS: Record<EventForwarderSinkType, string> = {
  bigquery: "BigQuery",
  snowflake: "Snowflake",
  databricks: "Databricks",
};

const EditOrganization: FC<{
  onEdit: () => void;
  close: () => void;
  id: string;
  currentOrg: OrganizationInterface;
}> = ({ onEdit, close, id, currentOrg }) => {
  const { superAdmin, userId } = useUser();
  // Only changed fields are sent, so disabling the rest is enough
  const canMetadata = hasSuperAdminPermission(superAdmin, "metadata");
  const canBilling = hasSuperAdminPermission(superAdmin, "billing");
  const canSso = hasSuperAdminPermission(superAdmin, "sso");
  // Event forwarder actions run inside the org, so they also need a way in
  const canProvision =
    hasSuperAdminPermission(superAdmin, "provision") &&
    (hasSuperAdminPermission(superAdmin, "impersonate") ||
      currentOrg.members.some((m) => m.id === userId));
  const [name, setName] = useState(currentOrg.name);
  const [owner, setOwner] = useState(currentOrg.ownerEmail);
  const [externalId, setExternalId] = useState(currentOrg.externalId || "");
  const [licenseKey, setLicenseKey] = useState(currentOrg.licenseKey || "");
  const [freeSeats, setFreeSeats] = useState(currentOrg.freeSeats ?? 3);
  const [legacyEnterprise, setLegacyEnterprise] = useState(
    currentOrg.enterprise || false,
  );
  const [verifiedDomain, setVerifiedDomain] = useState(
    currentOrg.verifiedDomain || "",
  );
  const [autoApproveMembers, setAutoApproveMembers] = useState(
    currentOrg.autoApproveMembers || false,
  );
  const [restrictLoginMethod, setRestrictLoginMethod] = useState(
    currentOrg.restrictLoginMethod || "",
  );
  const [disableSelfServeBilling, setDisableSelfServeBilling] = useState(
    currentOrg.disableSelfServeBilling || false,
  );
  const [eventForwarders, setEventForwarders] = useState<EventForwarderRow[]>(
    [],
  );
  const [eventForwardersLoading, setEventForwardersLoading] =
    useState(canProvision);
  const [eventForwardersError, setEventForwardersError] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [deletingEventForwarderId, setDeletingEventForwarderId] = useState<
    string | null
  >(null);

  const values = {
    name,
    externalId,
    licenseKey,
    ownerEmail: owner,
    verifiedDomain,
    autoApproveMembers,
    restrictLoginMethod,
    enterprise: legacyEnterprise,
    freeSeats,
    disableSelfServeBilling,
  };
  // Snapshot from the first render, to diff against on submit
  const [initialValues] = useState(values);

  const { apiCall } = useAuth();

  const refreshEventForwarders = useCallback(async () => {
    setEventForwardersLoading(true);
    setEventForwardersError("");
    try {
      const res = await apiCall<{
        datasources: DataSourceInterfaceWithParams[];
      }>("/organization/definitions", {
        headers: { "X-Organization": id },
      });
      setEventForwarders(
        res.datasources
          .filter((ds) => ds.eventForwarderConfig != null)
          .map((ds) => ({
            datasourceId: ds.id,
            name: ds.name,
            sinkType: ds.eventForwarderConfig!.sinkType,
            status: ds.eventForwarderConfig!.status,
          })),
      );
    } catch (e) {
      setEventForwardersError(
        e instanceof Error ? e.message : "Failed to load event forwarders",
      );
    } finally {
      setEventForwardersLoading(false);
    }
  }, [apiCall, id]);

  useEffect(() => {
    if (canProvision) refreshEventForwarders();
  }, [refreshEventForwarders, canProvision]);

  const handleSubmit = async () => {
    // Send only what this admin changed, so a stale value for a field they
    // didn't touch can't overwrite another admin's edit or fail a permission check
    const changes = Object.fromEntries(
      Object.entries(values).filter(
        ([k, v]) => !isEqual(v, initialValues[k as keyof typeof values]),
      ),
    );
    await apiCall<{
      status: number;
      message?: string;
    }>("/admin/organization", {
      method: "PUT",
      body: JSON.stringify({ orgId: id, ...changes }),
    });
    onEdit();
  };

  const handleDeleteEventForwarder = async (datasourceId: string) => {
    setActionLoadingId(datasourceId);
    setEventForwardersError("");
    try {
      await apiCall(`/datasource/${datasourceId}/event-forwarder`, {
        method: "DELETE",
        headers: { "X-Organization": id },
      });
      await refreshEventForwarders();
    } catch (e) {
      setEventForwardersError(
        e instanceof Error ? e.message : "Failed to delete event forwarder",
      );
    } finally {
      setActionLoadingId(null);
    }
  };

  const handlePauseResumeEventForwarder = async (row: EventForwarderRow) => {
    const action = row.status === "ready" ? "pause" : "resume";
    setActionLoadingId(row.datasourceId);
    setEventForwardersError("");
    try {
      await apiCall(
        `/datasource/${row.datasourceId}/event-forwarder/${action}`,
        {
          method: "POST",
          headers: { "X-Organization": id },
        },
      );
      await refreshEventForwarders();
    } catch (e) {
      setEventForwardersError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <ModalStandard
      trackingEventModalType=""
      submit={handleSubmit}
      open={true}
      header="Edit Organization"
      cta="Update"
      close={close}
    >
      <Flex direction="column" gap="4">
        <TextField
          label="Name"
          value={name}
          required
          minLength={3}
          disabled={!canMetadata}
          onChange={(e) => setName(e.target.value)}
        />
        {isCloud() ? (
          <TextField
            label="License key"
            value={licenseKey}
            disabled={!canBilling}
            onChange={(e) => setLicenseKey(e.target.value)}
          />
        ) : (
          <TextField
            label="External ID"
            value={externalId}
            disabled={!canMetadata}
            minLength={3}
            helpText="Identifies the organization within your company."
            onChange={(e) => setExternalId(e.target.value)}
          />
        )}
        <TextField
          label="Owner email"
          type="email"
          value={owner}
          required
          disabled={!canMetadata}
          onChange={(e) => setOwner(e.target.value)}
        />
        <TextField
          label="Verified domain"
          value={verifiedDomain}
          disabled={!canSso}
          helpText="New users with an email on this domain can auto-join this organization."
          onChange={(e) => setVerifiedDomain(e.target.value)}
        />
        <Checkbox
          id="autoApproveMembers"
          label="Auto-approve members with this email domain"
          value={autoApproveMembers}
          setValue={setAutoApproveMembers}
          disabled={!canSso}
        />
        {isCloud() ? (
          <>
            {!currentOrg.restrictLoginMethod?.startsWith("vercel:") && (
              <TextField
                label="Required SSO connection ID"
                value={restrictLoginMethod}
                placeholder="SSO connection ID"
                helpText="Members must sign in through this SSO connection, which can belong to another organization."
                disabled={!canSso}
                onChange={(e) => setRestrictLoginMethod(e.target.value)}
              />
            )}
            <TextField
              label="Free seats"
              type="number"
              min={0}
              value={freeSeats}
              disabled={!canBilling}
              helpText="Seats available on a free plan. The default is 3."
              onChange={(e) => setFreeSeats(parseInt(e.target.value))}
            />
            <Checkbox
              id="disableSelfServeBilling"
              label="Disable self-serve billing"
              description="Prevents members from managing their own subscription."
              value={disableSelfServeBilling}
              setValue={setDisableSelfServeBilling}
              disabled={!canBilling}
            />
            <Callout status="warning">
              <Flex direction="column" gap="2">
                <Text>
                  Legacy Enterprise doesn&apos;t expire or limit seats, and
                  isn&apos;t billed. Uncheck it and set a license key in Retool
                  instead.
                </Text>
                <Checkbox
                  id="legacyEnterpriseToggle"
                  label="Enable legacy Enterprise"
                  value={legacyEnterprise}
                  setValue={setLegacyEnterprise}
                  disabled={!canBilling}
                />
              </Flex>
            </Callout>
            {eventForwardersLoading ? (
              <Flex align="center" gap="2">
                <Spinner size="1" />
                <Text color="text-mid">Loading event forwarders...</Text>
              </Flex>
            ) : eventForwardersError && eventForwarders.length === 0 ? (
              <Callout status="error">{eventForwardersError}</Callout>
            ) : eventForwarders.length > 0 ? (
              <Flex direction="column" gap="2">
                <Text weight="semibold">Event forwarders</Text>
                {eventForwardersError ? (
                  <Callout status="error">{eventForwardersError}</Callout>
                ) : null}
                {eventForwarders.map((row) => {
                  const canToggle =
                    row.status === "ready" || row.status === "paused";
                  const isLoading = actionLoadingId === row.datasourceId;
                  return (
                    <Flex key={row.datasourceId} align="center" gap="2">
                      <Flex align="center" gap="2" flexGrow="1" minWidth="0">
                        <Text truncate title={row.name}>
                          {row.name}
                        </Text>
                        <Text color="text-mid" size="sm">
                          {SINK_TYPE_LABELS[row.sinkType]}
                        </Text>
                      </Flex>
                      {canToggle ? (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={isLoading}
                          onClick={() => handlePauseResumeEventForwarder(row)}
                        >
                          {row.status === "ready" ? "Pause" : "Resume"}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        color="red"
                        disabled={isLoading}
                        onClick={() =>
                          setDeletingEventForwarderId(row.datasourceId)
                        }
                      >
                        Delete
                      </Button>
                    </Flex>
                  );
                })}
              </Flex>
            ) : null}
            {deletingEventForwarderId ? (
              <ConfirmDialog
                title="Delete Event Forwarder Configuration?"
                content="This cannot be undone from the UI."
                yesText="Delete"
                onConfirm={async () => {
                  await handleDeleteEventForwarder(deletingEventForwarderId);
                  setDeletingEventForwarderId(null);
                }}
                onCancel={() => setDeletingEventForwarderId(null)}
              />
            ) : null}
          </>
        ) : null}
      </Flex>
    </ModalStandard>
  );
};

export default EditOrganization;

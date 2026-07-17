import { useState, FC, useCallback, useEffect } from "react";
import {
  OrganizationInterface,
  OrganizationMessage,
} from "shared/types/organization";
import {
  EventForwarderSinkType,
  EventForwarderStatus,
} from "shared/types/event-forwarder";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { isCloud } from "@/services/env";
import Checkbox from "@/ui/Checkbox";
import LoadingSpinner from "@/components/LoadingSpinner";
import ConfirmDialog from "@/ui/ConfirmDialog";

type MessageWithId = OrganizationMessage & { id: string };

type EventForwarderRow = {
  datasourceId: string;
  name: string;
  sinkType: EventForwarderSinkType;
  status: EventForwarderStatus;
};

const SINK_TYPE_LABELS: Record<EventForwarderSinkType, string> = {
  bigquery: "BigQuery",
  snowflake: "Snowflake",
};

const EditOrganization: FC<{
  onEdit: () => void;
  close?: () => void;
  id: string;
  disablable: boolean;
  currentOrg: OrganizationInterface;
}> = ({ onEdit, close, id, disablable = true, currentOrg }) => {
  const [name, setName] = useState(currentOrg.name);
  const [owner, setOwner] = useState(currentOrg.ownerEmail);
  const [externalId, setExternalId] = useState(currentOrg.externalId || "");
  const [licenseKey, setLicenseKey] = useState(currentOrg.licenseKey || "");
  const [freeSeats, setFreeSeats] = useState(currentOrg.freeSeats || 3);
  const [legacyEnterprise, setLegacyEnterprise] = useState(
    currentOrg.enterprise || false,
  );
  const [verifiedDomain, setVerifiedDomain] = useState(
    currentOrg.verifiedDomain || "",
  );
  const [autoApproveMembers, setAutoApproveMembers] = useState(
    currentOrg.autoApproveMembers || false,
  );
  const [disableSelfServeBilling, setDisableSelfServeBilling] = useState(
    currentOrg.disableSelfServeBilling || false,
  );
  const [suspended, setSuspended] = useState(currentOrg.suspended || false);
  const [messages, setMessages] = useState<MessageWithId[]>(
    (currentOrg.messages || []).map((m) => ({
      ...m,
      id: crypto.randomUUID(),
    })),
  );
  const [eventForwarders, setEventForwarders] = useState<EventForwarderRow[]>(
    [],
  );
  const [eventForwardersLoading, setEventForwardersLoading] = useState(true);
  const [eventForwardersError, setEventForwardersError] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [deletingEventForwarderId, setDeletingEventForwarderId] = useState<
    string | null
  >(null);

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
    refreshEventForwarders();
  }, [refreshEventForwarders]);

  const handleSubmit = async () => {
    await apiCall<{
      status: number;
      message?: string;
    }>("/admin/organization", {
      method: "PUT",
      body: JSON.stringify({
        orgId: id,
        name,
        externalId,
        licenseKey,
        ownerEmail: owner,
        verifiedDomain,
        autoApproveMembers,
        enterprise: legacyEnterprise,
        freeSeats,
        disableSelfServeBilling,
        suspended,
        messages: messages.map(({ id: _id, ...m }) => m),
      }),
    });
    onEdit();
  };

  const addMessage = () => {
    setMessages([
      ...messages,
      { id: crypto.randomUUID(), message: "", level: "info" },
    ]);
  };

  const updateMessage = (
    id: string,
    field: keyof OrganizationMessage,
    value: string,
  ) => {
    setMessages(
      messages.map((m) => (m.id === id ? { ...m, [field]: value } : m)),
    );
  };

  const removeMessage = (id: string) => {
    setMessages(messages.filter((m) => m.id !== id));
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
    <Modal
      useRadixButton={false}
      trackingEventModalType=""
      submit={handleSubmit}
      open={true}
      header={"Edit Organization"}
      cta={"Update"}
      close={close}
      inline={!close}
      secondaryCTA={
        disablable ? (
          <div className="flex-grow-1">
            {currentOrg.disabled ? (
              <button
                className="btn btn-info"
                onClick={async (e) => {
                  e.preventDefault();
                  await apiCall<{
                    status: number;
                    message?: string;
                  }>(`/admin/organization/enable`, {
                    method: "PUT",
                    body: JSON.stringify({ orgId: id }),
                  });
                  onEdit();
                  if (close) close();
                }}
              >
                Enable
              </button>
            ) : (
              <button
                className="btn btn-danger"
                onClick={async (e) => {
                  e.preventDefault();
                  if (
                    confirm(
                      "Are you sure you want to disable this organization? Users will not be able to use this organization",
                    )
                  ) {
                    await apiCall<{
                      status: number;
                      message?: string;
                    }>(`/admin/organization/disable`, {
                      method: "PUT",
                      body: JSON.stringify({ orgId: id }),
                    });
                    onEdit();
                    if (close) close();
                  }
                }}
              >
                Disable
              </button>
            )}
          </div>
        ) : null
      }
    >
      <div className="form-group">
        Company Name
        <input
          type="text"
          className="form-control"
          value={name}
          required
          minLength={3}
          onChange={(e) => setName(e.target.value)}
        />
        {isCloud() ? (
          <div className="mt-3">
            License Key
            <input
              type="text"
              className="form-control"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
            />
          </div>
        ) : (
          <div className="mt-3">
            External Id (optional)
            <input
              type="text"
              className="form-control"
              value={externalId}
              minLength={3}
              onChange={(e) => setExternalId(e.target.value)}
            />
            <span className="text-muted small">
              This field can be used to identify the organization within your
              company.
            </span>
          </div>
        )}
        <div className="mt-3">
          Owner Email
          <input
            type="email"
            className="form-control"
            value={owner}
            required
            onChange={(e) => setOwner(e.target.value)}
          />
        </div>
        <div className="mt-3">
          Verified Domain
          <input
            type="text"
            className="form-control"
            value={verifiedDomain}
            onChange={(e) => setVerifiedDomain(e.target.value)}
          />
          <span className="text-muted small">
            This is used so new users can auto join this org by matching email
            domain.
          </span>
        </div>
        <div className="mt-3">
          <Checkbox
            id="autoApproveMembers"
            label="Auto approve members with email domain"
            value={autoApproveMembers}
            setValue={setAutoApproveMembers}
          />
        </div>
        {isCloud() ? (
          <>
            <div className="mt-3">
              <Checkbox
                id="suspended"
                label="Suspend organization"
                value={suspended}
                setValue={setSuspended}
                disabled={!disablable}
                disabledMessage="You cannot suspend the organization you are currently logged into."
              />
              <div>
                <span className="text-muted small">
                  Blocks all users and API keys from accessing this
                  organization.
                </span>
              </div>
            </div>
            <div className="mt-3">
              Free Seats
              <input
                type="number"
                min={0}
                className="form-control"
                value={freeSeats}
                onChange={(e) => setFreeSeats(parseInt(e.target.value))}
              />
              <div>
                <span className="text-muted small">
                  Number of seats that can be added when on a free plan (3 is
                  the default)
                </span>
              </div>
            </div>
            <div className="mt-3">
              <Checkbox
                id="disableSelfServeBilling"
                label="Disable self-serve billing"
                value={disableSelfServeBilling}
                setValue={setDisableSelfServeBilling}
              />
              <div>
                <span className="text-muted small">
                  Prevents users in this org from managing their own
                  subscription.
                </span>
              </div>
            </div>
            <div className="p-2 border mt-3">
              <div>
                <b>Deprecated:</b>
                <div className="small">
                  This is an old way to enable enterprise features for an
                  organization, which does not expire, and does not restrict not
                  restrict seats. Please uncheck this and instead user Retool
                  and set a licenseKey instead.
                </div>
              </div>
              <div className="mt-3">
                <Checkbox
                  id="legacyEnterpriseToggle"
                  label="Enable Enterprise"
                  value={legacyEnterprise}
                  setValue={setLegacyEnterprise}
                />
                <div>
                  <span className="text-muted small">
                    Organizations with enterprise enabled this way are not
                    billed, and will not expire.
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <label className="mb-0 font-weight-bold">
                  Organization Messages
                </label>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={addMessage}
                >
                  + Add Message
                </button>
              </div>
              <div className="text-muted small mb-2">
                Banners displayed to all users in this org. Supports Markdown.
                Useful for maintenance notices or account alerts. Each message
                will appear on every page.
              </div>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className="d-flex gap-2 mb-2 align-items-center"
                >
                  <input
                    type="text"
                    className="form-control form-control-sm flex-grow-1"
                    placeholder="Message text (Markdown supported)"
                    value={msg.message}
                    onChange={(e) =>
                      updateMessage(msg.id, "message", e.target.value)
                    }
                  />
                  <select
                    className="form-control form-control-sm"
                    style={{ width: 110, flexShrink: 0 }}
                    value={msg.level}
                    onChange={(e) =>
                      updateMessage(
                        msg.id,
                        "level",
                        e.target.value as OrganizationMessage["level"],
                      )
                    }
                  >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="danger">Danger</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                    style={{ flexShrink: 0 }}
                    onClick={() => removeMessage(msg.id)}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            {!eventForwardersLoading && eventForwarders.length > 0 ? (
              <div className="mt-3">
                <label className="mb-1 font-weight-bold">
                  Event Forwarders
                </label>
                {eventForwardersError ? (
                  <div className="text-danger small mb-2">
                    {eventForwardersError}
                  </div>
                ) : null}
                {eventForwarders.map((row) => {
                  const canToggle =
                    row.status === "ready" || row.status === "paused";
                  const isLoading = actionLoadingId === row.datasourceId;
                  return (
                    <div
                      key={row.datasourceId}
                      className="d-flex gap-2 mb-2 align-items-center"
                    >
                      <Flex align="center" gap="2" flexGrow="1">
                        <span className="text-truncate" title={row.name}>
                          {row.name}
                        </span>
                        <span
                          className="text-muted small"
                          style={{ width: 80, flexShrink: 0 }}
                        >
                          {SINK_TYPE_LABELS[row.sinkType]}
                        </span>
                      </Flex>
                      <Flex align="center" gap="2">
                        {canToggle ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            style={{ flexShrink: 0, width: 72 }}
                            disabled={isLoading}
                            onClick={() => handlePauseResumeEventForwarder(row)}
                          >
                            {isLoading ? (
                              <LoadingSpinner
                                style={{ width: "12px", height: "12px" }}
                              />
                            ) : row.status === "ready" ? (
                              "Pause"
                            ) : (
                              "Resume"
                            )}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          style={{ flexShrink: 0 }}
                          disabled={isLoading}
                          onClick={() =>
                            setDeletingEventForwarderId(row.datasourceId)
                          }
                        >
                          Delete
                        </button>
                      </Flex>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {eventForwardersLoading ? (
              <div className="mt-3 d-flex align-items-center gap-2 text-muted small">
                <LoadingSpinner style={{ width: "14px", height: "14px" }} />
                Loading event forwarders...
              </div>
            ) : null}
            {deletingEventForwarderId ? (
              <ConfirmDialog
                title="Delete Event Forwarder configuration?"
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
      </div>
    </Modal>
  );
};

export default EditOrganization;

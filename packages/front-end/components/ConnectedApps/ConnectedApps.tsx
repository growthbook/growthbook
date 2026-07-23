import React, { FC, useCallback, useState } from "react";
import { ago, datetime } from "shared/dates";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import ConfirmDialog from "@/ui/ConfirmDialog";

interface ConnectedApp {
  clientId: string;
  clientName: string;
  clientUri?: string;
  scopes: string[];
  firstAuthorizedAt: string;
  lastAuthorizedAt: string;
}

type ConnectedAppsProps = {
  apps: ConnectedApp[];
  onRevoke: (clientId: string) => Promise<void>;
};

export const ConnectedApps: FC<ConnectedAppsProps> = ({ apps, onRevoke }) => {
  const [pendingRevoke, setPendingRevoke] = useState<ConnectedApp | null>(null);

  if (apps.length === 0) return null;

  return (
    <div className="mb-4">
      <h1>Connected Apps</h1>
      <p className="text-gray">
        Third-party applications you have authorized to access GrowthBook on
        your behalf in this organization. Revoking access signs the app out and
        invalidates its tokens immediately.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="table mb-3 appbox gbtable">
          <thead>
            <tr>
              <th>Application</th>
              <th>Scopes</th>
              <th>Authorized</th>
              <th style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => (
              <tr key={app.clientId}>
                <td>{app.clientName}</td>
                <td>
                  {app.scopes.length > 0 ? (
                    app.scopes.map((s) => (
                      <Badge key={s} mr="1" variant="soft" label={s} />
                    ))
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td>
                  <Tooltip content={datetime(app.lastAuthorizedAt)}>
                    <span>{ago(app.lastAuthorizedAt)}</span>
                  </Tooltip>
                </td>
                <td>
                  <Button
                    color="red"
                    variant="outline"
                    onClick={() => setPendingRevoke(app)}
                  >
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pendingRevoke && (
        <ConfirmDialog
          title={`Revoke access for ${pendingRevoke.clientName}?`}
          content="This app will be signed out and its access and refresh tokens will stop working immediately. It can request access again by going through authorization."
          yesText="Revoke"
          onConfirm={async () => {
            const target = pendingRevoke;
            await onRevoke(target.clientId);
            setPendingRevoke(null);
          }}
          onCancel={() => setPendingRevoke(null)}
        />
      )}
    </div>
  );
};

export const ConnectedAppsContainer = () => {
  const { apiCall } = useAuth();
  const { data, mutate } = useApi<{ connectedApps: ConnectedApp[] }>(
    "/oauth/connected-apps",
  );

  const onRevoke = useCallback(
    async (clientId: string) => {
      await apiCall(`/oauth/connected-apps/revoke`, {
        method: "POST",
        body: JSON.stringify({ clientId }),
      });
      mutate();
    },
    [apiCall, mutate],
  );

  return <ConnectedApps apps={data?.connectedApps ?? []} onRevoke={onRevoke} />;
};

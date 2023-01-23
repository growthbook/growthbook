import { FC, useState } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import { FaExclamationTriangle, FaKey } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import DeleteButton from "../DeleteButton/DeleteButton";
import ApiKeysModal from "../Settings/ApiKeysModal";
import Tooltip from "../Tooltip/Tooltip";
import MoreMenu from "../Dropdown/MoreMenu";
import ClickToReveal from "../Settings/ClickToReveal";
import ClickToCopy from "../Settings/ClickToCopy";
import { getApiBaseUrl } from "./CodeSnippetModal";

const SDKEndpoints: FC<{
  keys: ApiKeyInterface[];
  mutate: () => void;
}> = ({ keys, mutate }) => {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState<boolean>(false);

  const { getProjectById, projects, project } = useDefinitions();

  const environments = useEnvironments();

  const permissions = usePermissions();

  const publishableKeys = keys
    .filter((k) => !k.secret)
    .filter((k) => !project || !k.project || k.project === project);
  const canManageKeys = permissions.check("manageEnvironments", "", []);

  const envCounts = new Map();
  publishableKeys.forEach((k) => {
    if (k.environment) {
      envCounts.set(
        k.environment,
        envCounts.has(k.environment) ? envCounts.get(k.environment) + 1 : 1
      );
    }
  });

  return (
    <div>
      {open && canManageKeys && (
        <ApiKeysModal
          close={() => setOpen(false)}
          onCreate={mutate}
          secret={false}
        />
      )}
      <h1>SDK Endpoints</h1>
      <p>
        SDK Endpoints return a list of feature flags for an environment,
        formatted in a way our SDKs understand. The endpoints provide readonly
        access and can be safely exposed to users (e.g. in your HTML).
      </p>
      {publishableKeys.length > 0 && (
        <table className="table mb-3 appbox gbtable">
          <thead>
            <tr>
              {projects.length > 0 && <th>Project</th>}
              <th>Environment</th>
              <th>Description</th>
              <th>Endpoint</th>
              <th>Encrypted?</th>
              {canManageKeys && <th style={{ width: 30 }}></th>}
            </tr>
          </thead>
          <tbody>
            {publishableKeys.map((key) => {
              const env = key.environment ?? "production";
              const endpoint = getApiBaseUrl() + "/api/features/" + key.key;
              const envExists = environments?.some((e) => e.id === env);

              return (
                <tr key={key.key}>
                  {projects.length > 0 && (
                    <td>
                      {getProjectById(key.project)?.name || (
                        <em>All Projects</em>
                      )}
                    </td>
                  )}
                  <td>
                    <Tooltip
                      body={
                        envExists
                          ? ""
                          : "This environment no longer exists. This SDK endpoint will continue working, but will no longer be updated."
                      }
                    >
                      <strong className="mr-1">{env}</strong>
                      {!envExists && (
                        <FaExclamationTriangle className="text-danger" />
                      )}
                    </Tooltip>
                  </td>
                  <td>{key.description}</td>
                  <td>
                    <ClickToCopy>{endpoint}</ClickToCopy>
                  </td>
                  <td style={{ width: 295 }}>
                    {canManageKeys && key.encryptSDK ? (
                      <ClickToReveal
                        valueWhenHidden="secret_abcdefghijklmnop123"
                        getValue={async () => {
                          const res = await apiCall<{
                            key: ApiKeyInterface;
                          }>(`/keys/reveal`, {
                            method: "POST",
                            body: JSON.stringify({
                              id: key.id,
                            }),
                          });
                          if (!res.key?.encryptionKey) {
                            throw new Error("Could not load encryption key");
                          }
                          return res.key.encryptionKey;
                        }}
                      />
                    ) : (
                      <div>No</div>
                    )}
                  </td>
                  {canManageKeys && (
                    <td>
                      <MoreMenu>
                        <DeleteButton
                          onClick={async () => {
                            await apiCall(`/keys`, {
                              method: "DELETE",
                              body: JSON.stringify({
                                id: key.id || "",
                                key: key.key,
                              }),
                            });
                            mutate();
                          }}
                          className="dropdown-item"
                          displayName="SDK Endpoint"
                          text="Delete endpoint"
                        />
                      </MoreMenu>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {canManageKeys && (
        <button
          className="btn btn-primary"
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          <FaKey /> Create New SDK Endpoint
        </button>
      )}
    </div>
  );
};

export default SDKEndpoints;

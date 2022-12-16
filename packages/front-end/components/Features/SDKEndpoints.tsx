import { FC, useState } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import { FaExclamationTriangle, FaKey } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import DeleteButton from "../DeleteButton/DeleteButton";
import ApiKeysModal from "../Settings/ApiKeysModal";
import SelectField from "../Forms/SelectField";
import Tooltip from "../Tooltip/Tooltip";
import MoreMenu from "../Dropdown/MoreMenu";
import ClickToReveal from "../Settings/ClickToReveal";
import ClickToCopy from "../Settings/ClickToCopy";
import { getSDKEndpoint } from "./CodeSnippetModal";

const SDKEndpoints: FC<{
  keys: ApiKeyInterface[];
  mutate: () => void;
}> = ({ keys, mutate }) => {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState<boolean>(false);

  const { projects } = useDefinitions();

  const environments = useEnvironments();

  const [selectedProject, setSelectedProject] = useState("");

  const permissions = usePermissions();

  const publishableKeys = keys.filter((k) => !k.secret);
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
    <div className="mt-4">
      {open && canManageKeys && (
        <ApiKeysModal
          close={() => setOpen(false)}
          onCreate={mutate}
          secret={false}
        />
      )}
      <h1>SDK Endpoints</h1>
      <p>
        SDK Endpoints return a list of feature flags for an environment. The
        endpoints provide readonly access and can be safely exposed to users
        (e.g. in your HTML source code).
      </p>
      {publishableKeys.length > 0 && projects?.length > 0 && (
        <div className="row mb-2 align-items-center">
          <div className="col-auto">
            <SelectField
              value={selectedProject}
              onChange={(value) => setSelectedProject(value)}
              initialOption="All Projects"
              options={projects.map((p) => {
                return {
                  value: p.id,
                  label: p.name,
                };
              })}
            />
          </div>
        </div>
      )}
      {publishableKeys.length > 0 && (
        <table className="table mb-3 appbox gbtable">
          <thead>
            <tr>
              <th style={{ width: 150 }}>Environment</th>
              <th>Endpoint</th>
              <th>Encrypted?</th>
              {canManageKeys && <th style={{ width: 30 }}></th>}
            </tr>
          </thead>
          <tbody>
            {publishableKeys.map((key) => {
              const env = key.environment ?? "production";
              const endpoint = getSDKEndpoint(key.key, selectedProject);

              const envExists = environments?.some((e) => e.id === env);

              return (
                <tr key={key.key}>
                  <td>
                    <div className="d-flex flex-column">
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
                      <span style={{ fontSize: "87.5%", fontStyle: "italic" }}>
                        {key.description}
                      </span>
                    </div>
                  </td>
                  <td>
                    <ClickToCopy valueToCopy={endpoint}>
                      <span style={{ wordBreak: "break-all" }}>{endpoint}</span>
                    </ClickToCopy>
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
                      <MoreMenu id={key.key + "_actions"}>
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

import { FC, useState } from "react";
import { ApiKeyInterface, SecretApiKey } from "back-end/types/apikey";
import DeleteButton from "../DeleteButton";
import { useAuth } from "../../services/auth";
import { FaCopy, FaExclamationTriangle, FaKey } from "react-icons/fa";
import ApiKeysModal from "../Settings/ApiKeysModal";
import MoreMenu from "../Dropdown/MoreMenu";
import { getSDKEndpoint } from "./CodeSnippetModal";
import usePermissions from "../../hooks/usePermissions";
import { useDefinitions } from "../../services/DefinitionsContext";
import SelectField from "../Forms/SelectField";
import Tooltip from "../Tooltip";
import { useEnvironments } from "../../services/features";
import CopyToClipboard from "../CopyToClipboard";
import ClickToReveal from "../Settings/ClickToReveal";

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
  const canManageKeys = permissions.manageEnvironments;

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
              <th>Description</th>
              <th>Environment</th>
              <th>Endpoint</th>
              <th>Private Key</th>
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
                  <td>{key.description}</td>
                  <td>
                    <Tooltip
                      body={
                        envExists
                          ? ""
                          : "This environment no longer exists. This SDK endpoint will continue working, but will no longer be updated."
                      }
                    >
                      {env}{" "}
                      {!envExists && (
                        <FaExclamationTriangle className="text-danger" />
                      )}
                    </Tooltip>
                  </td>
                  <td>
                    <code>{endpoint}</code>{" "}
                    <FaCopy
                      className="cursor-pointer"
                      title="Copy to Clipboard"
                      onClick={(e) => {
                        e.preventDefault();
                        navigator.clipboard
                          .writeText(endpoint)
                          .then(() => {
                            console.log("Copied!");
                          })
                          .catch((e) => {
                            console.error(e);
                          });
                      }}
                    />
                  </td>
                  <td>
                    {canManageKeys && key.encryptSDK && (
                      <ClickToReveal
                        valueWhenHidden="Reveal key"
                        getValue={async () => {
                          const res = await apiCall<{ key: SecretApiKey }>(
                            `/keys/reveal`,
                            {
                              method: "POST",
                              body: JSON.stringify({
                                id: key.id,
                              }),
                            }
                          );
                          if (!res.key?.encryptionPrivateKey) {
                            throw new Error("Could not load private key");
                          }
                          return res.key.encryptionPrivateKey;
                        }}
                      >
                        {(value) => <CopyToClipboard text={value} />}
                      </ClickToReveal>
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

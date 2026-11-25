import { FC } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import { FaExclamationTriangle } from "react-icons/fa";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import { getApiBaseUrl } from "./CodeSnippetModal";

export function getPublishableKeys(
  keys: ApiKeyInterface[],
  project?: string,
): ApiKeyInterface[] {
  return keys
    .filter((k) => !k.secret)
    .filter((k) => !project || !k.project || k.project === project);
}

const SDKEndpoints: FC<{
  keys: ApiKeyInterface[];
  mutate: () => void;
}> = ({ keys = [], mutate }) => {
  const { t } = useLingui();
  const { apiCall } = useAuth();

  const { getProjectById, projects, project } = useDefinitions();

  const environments = useEnvironments();

  const permissionsUtil = usePermissionsUtil();

  const publishableKeys = getPublishableKeys(keys, project);

  const envCounts = new Map();
  publishableKeys.forEach((k) => {
    if (k.environment) {
      envCounts.set(
        k.environment,
        envCounts.has(k.environment) ? envCounts.get(k.environment) + 1 : 1,
      );
    }
  });

  return (
    <div>
      <h1>
        <Trans>Legacy SDK Endpoints</Trans>
      </h1>
      <p>
        <Trans>
          SDK Endpoints return a list of feature flags for an environment,
          formatted in a way our SDKs understand. The endpoints provide readonly
          access and can be safely exposed to users (e.g. in your HTML).
        </Trans>
      </p>
      {publishableKeys.length > 0 && (
        <table className="table mb-3 appbox gbtable">
          <thead>
            <tr>
              {projects.length > 0 && (
                <th>
                  <Trans>Project</Trans>
                </th>
              )}
              <th>
                <Trans>Environment</Trans>
              </th>
              <th>
                <Trans>Description</Trans>
              </th>
              <th>
                <Trans>Endpoint</Trans>
              </th>
              <th>
                <Trans>Encrypted?</Trans>
              </th>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {publishableKeys.map((key) => {
              const env = key.environment ?? "production";
              const endpoint = getApiBaseUrl() + "/api/features/" + key.key;
              const envExists = environments?.some((e) => e.id === env);
              const canManage = permissionsUtil.canCreateSDKConnection({
                projects: [key.project || ""],
                environment: key.environment || "",
              });

              const canDelete = permissionsUtil.canDeleteSDKConnection({
                projects: [key.project || ""],
                environment: key.environment || "",
              });

              return (
                <tr key={key.key}>
                  {projects.length > 0 && (
                    <td>
                      {getProjectById(key.project || "")?.name || (
                        <em>
                          <Trans>All Projects</Trans>
                        </em>
                      )}
                    </td>
                  )}
                  <td>
                    <Tooltip
                      body={
                        envExists
                          ? ""
                          : t`This environment no longer exists. This SDK endpoint will continue working, but will no longer be updated.`
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
                    {canManage && key.encryptSDK ? (
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
                            throw new Error(t`Could not load encryption key`);
                          }
                          return res.key.encryptionKey;
                        }}
                      />
                    ) : (
                      <div>
                        <Trans>No</Trans>
                      </div>
                    )}
                  </td>
                  <td>
                    <MoreMenu useRadix={false}>
                      {canDelete ? (
                        <DeleteButton
                          useRadix={false}
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
                          displayName={t`SDK Endpoint`}
                          text={t`Delete endpoint`}
                        />
                      ) : null}
                    </MoreMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default SDKEndpoints;

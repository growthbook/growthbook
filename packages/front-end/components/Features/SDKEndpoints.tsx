import { FC } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import { FaExclamationTriangle } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
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
      <h1>Legacy SDK Endpoints</h1>
      <p>
        SDK Endpoints return a list of feature flags for an environment,
        formatted in a way our SDKs understand. The endpoints provide readonly
        access and can be safely exposed to users (e.g. in your HTML).
      </p>
      {publishableKeys.length > 0 && (
        <Table className="mb-3 appbox">
          <TableHeader>
            <TableRow>
              {projects.length > 0 && (
                <TableColumnHeader>Project</TableColumnHeader>
              )}
              <TableColumnHeader>Environment</TableColumnHeader>
              <TableColumnHeader>Description</TableColumnHeader>
              <TableColumnHeader>Endpoint</TableColumnHeader>
              <TableColumnHeader>Encrypted?</TableColumnHeader>
              <TableColumnHeader style={{ width: 30 }}></TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
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
                <TableRow key={key.key}>
                  {projects.length > 0 && (
                    <TableCell>
                      {getProjectById(key.project || "")?.name || (
                        <em>All Projects</em>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
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
                  </TableCell>
                  <TableCell>{key.description}</TableCell>
                  <TableCell>
                    <ClickToCopy>{endpoint}</ClickToCopy>
                  </TableCell>
                  <TableCell style={{ width: 295 }}>
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
                            throw new Error("Could not load encryption key");
                          }
                          return res.key.encryptionKey;
                        }}
                      />
                    ) : (
                      <div>No</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <MoreMenu>
                      {canDelete ? (
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
                      ) : null}
                    </MoreMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
};

export default SDKEndpoints;

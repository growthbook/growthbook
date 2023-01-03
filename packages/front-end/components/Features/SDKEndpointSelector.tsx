import { ApiKeyInterface, PublishableApiKey } from "back-end/types/apikey";
import Link from "next/link";
import { useEffect } from "react";
import { FaAngleRight, FaExternalLinkAlt } from "react-icons/fa";
import useApi from "@/hooks/useApi";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import SelectField from "../Forms/SelectField";
import LoadingSpinner from "../LoadingSpinner";

export interface Props {
  apiKey: string;
  setApiKey: (apiKey: string) => void;
}

export default function SDKEndpointSelector({ apiKey, setApiKey }: Props) {
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");
  const environments = useEnvironments();
  const { apiCall } = useAuth();
  const { getProjectById, project } = useDefinitions();

  const keys = (data?.keys || [])
    .filter((k) => !k.secret)
    .filter((k) => !project || !k.project || k.project === project);
  const hasKeys = keys.length > 0;
  const hasData = !!data;
  const hasError = !!error;

  const permissions = usePermissions();

  useEffect(() => {
    // Default to the first key
    let key = keys[0];

    // If a project is selected, first try to pick a key that's just for that project
    if (project) {
      const projectKey = keys.find((k) => k.project === project);
      if (projectKey) {
        key = projectKey;
      }
    }

    setApiKey(key?.key || "");
    // eslint-disable-next-line
  }, [hasData, hasError, project, hasKeys]);

  const createApiKey = async (env: string, proj: string) => {
    const res = await apiCall<{ key: PublishableApiKey }>(
      `/keys?preferExisting=true`,
      {
        method: "POST",
        body: JSON.stringify({
          description: `${env} Features SDK`,
          environment: env,
          project: proj,
          secret: false,
        }),
      }
    );
    return res.key?.key || "";
  };

  const envsWithEndpoints = new Set<string>();
  keys.forEach((k) => {
    envsWithEndpoints.add(k.environment);
  });
  async function createMissingEndpoints() {
    for (let i = 0; i < environments.length; i++) {
      if (!envsWithEndpoints.has(environments[i].id)) {
        await createApiKey(environments[i].id, "");
      }
    }
  }

  // Create any missing SDK endpoints for environments
  useEffect(() => {
    if (!hasData || hasError) return;
    createMissingEndpoints()
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        mutate();
      });
    // eslint-disable-next-line
  }, [hasData, hasError]);

  if (error) return null;

  if (!data) {
    return (
      <div>
        <LoadingSpinner /> Loading SDK Endpoints...
      </div>
    );
  }

  if (!keys.length) return null;

  const keyMap = new Map(keys.map((k) => [k.key, k]));

  return (
    <div className="mb-2">
      <label>SDK Endpoint</label>
      <div className="row align-items-center">
        <div className="col">
          <SelectField
            value={apiKey}
            onChange={setApiKey}
            options={keys.map((k) => {
              return {
                value: k.key,
                label: `${k.environment} | ${k.description}`,
              };
            })}
            formatOptionLabel={({ value }) => {
              const key = keyMap.get(value);
              const env = key?.environment || "production";
              return (
                <div>
                  {getProjectById(key?.project)?.name || "All Projects"}{" "}
                  <FaAngleRight /> {env}
                  {key?.description && key.description !== env && (
                    <small className="text-muted d-block">
                      {key.description}
                    </small>
                  )}
                </div>
              );
            }}
          />
        </div>

        {permissions.check("manageEnvironments", "", []) && (
          <div>
            <Link href="/environments">
              <a>
                Manage environments and endpoints <FaExternalLinkAlt />
              </a>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

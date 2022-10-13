import { ApiKeyInterface, PublishableApiKey } from "back-end/types/apikey";
import { useEffect } from "react";
import useApi from "../../hooks/useApi";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useEnvironments } from "../../services/features";
import SelectField from "../Forms/SelectField";
import LoadingSpinner from "../LoadingSpinner";

export interface Props {
  apiKey: string;
  setApiKey: (apiKey: string) => void;
  project: string;
  setProject: (project: string) => void;
}

export default function SDKEndpointSelector({
  apiKey,
  setApiKey,
  project,
  setProject,
}: Props) {
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");
  const environments = useEnvironments();
  const { apiCall } = useAuth();
  const { projects } = useDefinitions();

  const keys = (data?.keys || []).filter((k) => !k.secret);
  const hasKeys = keys.length > 0;
  const hasData = !!data;
  const hasError = !!error;

  useEffect(() => {
    setApiKey(keys[0]?.key || "");
    // eslint-disable-next-line
  }, [hasData, hasError, hasKeys]);

  const createApiKey = async (env: string) => {
    const res = await apiCall<{ key: PublishableApiKey }>(
      `/keys?preferExisting=true`,
      {
        method: "POST",
        body: JSON.stringify({
          description: `${env} Features SDK`,
          environment: env,
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
        await createApiKey(environments[i].id);
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
      <div className="row align-items-center">
        <div className="col-auto">
          <SelectField
            label="SDK Endpoint"
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
              return (
                <div className="d-flex align-items-center">
                  <div className="mr-2">{key?.description}</div>
                  <div className="ml-auto">
                    <span className="badge badge-primary">
                      {key?.environment}
                    </span>
                  </div>
                </div>
              );
            }}
          />
        </div>
        {projects.length > 0 && (
          <div className="col-auto">
            <SelectField
              label="Project"
              value={project}
              onChange={setProject}
              initialOption="All Projects"
              options={projects.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}

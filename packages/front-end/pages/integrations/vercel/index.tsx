import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Environment } from "back-end/types/organization";
import { GbVercelEnvMap } from "back-end/types/vercel";
import { useAuth } from "@/services/auth";
import EnvironmentModal from "@/components/Settings/EnvironmentModal";
import SelectField from "@/components/Forms/SelectField";
import Modal from "@/components/Modal";
import useApi from "@/hooks/useApi";
import { useEnvironments } from "@/services/features";

export default function VercelIntegrationPage() {
  const router = useRouter();
  const { code, configurationId, teamId, next } = router.query;

  const { apiCall } = useAuth();
  const environments = useEnvironments();

  const { data } = useApi<{ hasToken: boolean }>("/vercel/has-token");
  const [integrationAlreadyExists, setIntegrationAlreadyExists] = useState(
    false
  );

  const [envModalOpen, setEnvModalOpen] = useState<Partial<Environment> | null>(
    null
  );
  const [gbVercelEnvMap, setGbVercelEnvMap] = useState<GbVercelEnvMap>([
    { vercel: "production", gb: "" },
    { vercel: "preview", gb: "" },
    { vercel: "development", gb: "" },
  ]);

  useEffect(() => {
    if (data?.hasToken !== undefined) {
      if (data.hasToken) return setIntegrationAlreadyExists(true);
      postToken();
    }
  }, [data]);

  async function postToken() {
    const options = {
      method: "POST",
      body: JSON.stringify({
        code,
        configurationId,
        teamId: teamId ? teamId : null,
      }),
    };
    apiCall("/vercel/token", options).catch(() => {
      //do nothing
    });
  }

  return (
    <>
      {integrationAlreadyExists ? (
        <Modal
          open
          close={() => window.close()}
          cta="Continue"
          submit={async () => {
            setIntegrationAlreadyExists(false);
            postToken();
          }}
          autoCloseOnSubmit={false}
        >
          <div className="alert alert-warning">
            <strong>Notice:</strong> A Vercel integration already exists for
            your organization. By clicking <strong>{`"Continue"`}</strong> you
            will overwrite the existing integration. Click{" "}
            <strong>{`"Cancel"`}</strong> to avoid your Vercel integration being
            overwritten.
          </div>
        </Modal>
      ) : (
        <>
          {envModalOpen ? (
            <EnvironmentModal
              existing={envModalOpen}
              close={() => setEnvModalOpen(null)}
              onSuccess={() => setEnvModalOpen(null)}
            />
          ) : (
            <Modal
              submit={async () => {
                await apiCall("/vercel/env-vars", {
                  method: "POST",
                  body: JSON.stringify({ gbVercelEnvMap }),
                });
                window.location.href = next as string;
              }}
              open
            >
              <div>
                <h4>Generate Environment Variables</h4>
                <div className="text-muted" style={{ fontSize: "0.8rem" }}>
                  Env vars GROWTHBOOK_KEY and GROWTHBOOK_WEBHOOK_SECRET will be
                  created in GrowthBook and Vercel in the following
                  environments.
                </div>
                {gbVercelEnvMap.map((elem, i) => (
                  <div key={`keyMap${i}`} className="d-flex mt-2">
                    <div>
                      <div>
                        <strong>Vercel environment:</strong>
                      </div>
                      <div>{elem.vercel}</div>
                    </div>
                    <div className="ml-5">
                      <SelectField
                        label="GrowthBook environment:"
                        labelClassName="font-weight-bold font"
                        options={environments.map((env) => ({
                          label: env.id,
                          value: env.id,
                        }))}
                        initialOption="None"
                        value={elem.gb}
                        onChange={(selected) => {
                          const newMap = [...gbVercelEnvMap];
                          newMap[i] = { ...newMap[i], gb: selected };
                          setGbVercelEnvMap(newMap);
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  setEnvModalOpen({});
                }}
                className="btn btn-link btn-sm col-sm-5 text-left"
              >
                Create new environment
              </button>
            </Modal>
          )}
        </>
      )}
    </>
  );
}

VercelIntegrationPage.liteLayout = true;

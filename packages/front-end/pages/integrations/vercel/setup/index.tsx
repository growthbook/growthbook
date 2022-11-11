import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../services/auth";
import { Environment } from "back-end/types/organization";
import { GbVercelEnvMap } from "back-end/types/vercel";
import EnvironmentModal from "../../../../components/Settings/EnvironmentModal";
import SelectField from "../../../../components/Forms/SelectField";
import useApi from "../../../../hooks/useApi";
import { useEnvironments } from "../../../../services/features";
import WelcomeFrame from "../../../../components/Auth/WelcomeFrame";
import { useForm } from "react-hook-form";

export default function VercelIntegrationPage() {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { code, configurationId, teamId, next } = router.query;

  const { apiCall } = useAuth();
  const environments = useEnvironments();

  const { data } = useApi<{ hasToken: boolean }>("/vercel/has-token");
  const [loading, setLoading] = useState(false);
  // const [integrationAlreadyExists, setIntegrationAlreadyExists] = useState(
  //   false
  // );
  const integrationAlreadyExists = true;

  const [envModalOpen, setEnvModalOpen] = useState<Partial<Environment> | null>(
    null
  );
  const initialEnvMap = new Map();
  environments.forEach((env) => {
    if (env.id === "production" || env.id === "prod") {
      initialEnvMap.set("production", env.id);
    }
    if (env.id === "preview" || env.id === "staging") {
      initialEnvMap.set("preview", env.id);
    }
    if (env.id === "development" || env.id === "dev") {
      initialEnvMap.set("development", env.id);
    }
  });
  const initialEnvs = [];
  initialEnvMap.forEach((value, key) => {
    initialEnvs.push({ vercel: key, gb: value });
  });
  //console.log(initialEnvs);
  const [gbVercelEnvMap, setGbVercelEnvMap] = useState<GbVercelEnvMap>(
    initialEnvs
  );

  useEffect(() => {
    if (data?.hasToken !== undefined) {
      //if (data.hasToken) return setIntegrationAlreadyExists(true);
      //postToken();
    }
  }, [data]);

  // async function postToken() {
  //   const options = {
  //     method: "POST",
  //     body: JSON.stringify({
  //       code,
  //       configurationId,
  //       teamId: teamId ? teamId : null,
  //     }),
  //   };
  //   apiCall("/vercel/token", options).catch(() => {
  //     //do nothing
  //   });
  // }

  const leftside = (
    <>
      <h1 className="title h2">Configure Integration</h1>
      <p></p>
    </>
  );
  const form = useForm({
    defaultValues: {
      customize: false,
    },
  });

  const submit = form.handleSubmit(async (value) => {
    await apiCall("/vercel/env-vars", {
      method: "POST",
      body: JSON.stringify({
        envs: gbVercelEnvMap,
        customize: value.customize,
      }),
    });
  });

  return (
    <>
      <WelcomeFrame leftside={leftside} loading={loading}>
        {envModalOpen && (
          <EnvironmentModal
            existing={envModalOpen}
            close={() => setEnvModalOpen(null)}
            onSuccess={() => setEnvModalOpen(null)}
          />
        )}
        {integrationAlreadyExists ? (
          <></>
        ) : (
          <>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (loading) return;
                setLoading(true);
                try {
                  await submit();
                  setLoading(false);
                } catch (e) {
                  //setError(e.message);
                  setLoading(false);
                }
              }}
            >
              <div>
                <h3 className="h2">Set up your environments</h3>
                <p className="text-muted">
                  Vercel has three environments, <strong>development</strong>,{" "}
                  <strong>preview</strong>, and <strong>production</strong>. By
                  default, we will create environments within GrowthBook to
                  match.{" "}
                </p>
              </div>
              <div className="row">
                <div className="col form-group">
                  <div className="form-check">
                    <label className="form-check-label">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        {...form.register("customize")}
                      />
                      Customize environment mapping
                    </label>
                  </div>
                </div>
              </div>
              {form.watch("customize") && (
                <div className="">
                  <div className=" form-group graybox">
                    <div className="row mb-3">
                      <div className="col-6">
                        <strong>Vercel Environment</strong>
                      </div>
                      <div className="col-6">
                        <strong>GrowthBook Environment</strong>
                      </div>
                    </div>
                    {gbVercelEnvMap.map((elem, i) => (
                      <div
                        key={`keyMap${i}`}
                        className="d-flex mt-2 row align-items-center"
                      >
                        <div className="col-6">{elem.vercel}</div>
                        <div className="col-6">
                          <SelectField
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
                    <div className="row mt-2">
                      <div className="col-6"></div>
                      <div className="col-6">
                        <a
                          onClick={(e) => {
                            e.preventDefault();
                            setEnvModalOpen({});
                          }}
                          className="btn btn-link btn-sm text-left"
                        >
                          Create new environment
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div>
                <button
                  className={`btn btn-primary btn-block btn-lg`}
                  type="submit"
                >
                  Create environments
                </button>
              </div>
            </form>
          </>
        )}
      </WelcomeFrame>
    </>
  );
}

VercelIntegrationPage.liteLayout = true;
VercelIntegrationPage.fullFrame = true;

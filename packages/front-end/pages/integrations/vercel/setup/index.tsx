import { useRouter } from "next/router";
import { useState } from "react";
import { useAuth } from "../../../../services/auth";
import { Environment, VercelConnection } from "back-end/types/organization";
import { GbVercelEnvMap } from "back-end/types/vercel";
import EnvironmentModal from "../../../../components/Settings/EnvironmentModal";
import SelectField from "../../../../components/Forms/SelectField";
import useApi from "../../../../hooks/useApi";
import { useEnvironments } from "../../../../services/features";
import WelcomeFrame from "../../../../components/Auth/WelcomeFrame";
import { useForm } from "react-hook-form";

export default function VercelIntegrationPage() {
  const router = useRouter();
  const { code, configurationId, teamId, next, orgid: urlOrgId } = router.query;
  const { apiCall, organizations, orgId, setOrgId } = useAuth();
  const environments = useEnvironments();
  //const settings = useOrgSettings();

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState(null);
  const [step, setStep] = useState(urlOrgId ? 1 : 0);

  const { data } = useApi<{
    vercel: VercelConnection[];
  }>(`/vercel/existing`);

  if (urlOrgId !== orgId && urlOrgId) {
    setOrgId(urlOrgId as string);
  }

  const [envModalOpen, setEnvModalOpen] = useState<Partial<Environment> | null>(
    null
  );
  const initialEnvMap = new Map();
  // Vercel has three environments: production, preview, and development
  initialEnvMap.set("production", "");
  initialEnvMap.set("preview", "");
  initialEnvMap.set("development", "");

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

  const orgMap = new Map();
  organizations.forEach((org) => {
    orgMap.set(org.id, org.name);
  });

  const leftside = (
    <>
      <h1 className="title h2">Configure Integration</h1>
      <p></p>
    </>
  );
  const form = useForm({
    defaultValues: {
      customize: false,
      orgId: orgId,
    },
  });

  if (organizations.length === 1 && !urlOrgId) {
    router.push(
      `/integrations/vercel/setup?code=${code}&configurationId=${configurationId}&teamId=${teamId}&next=${next}&orgid=${organizations[0].id}`
    );
  }

  const submitEnvironments = form.handleSubmit(async (value) => {
    try {
      await apiCall("/vercel/add-integration", {
        method: "POST",
        body: JSON.stringify({
          code,
          configurationId,
          teamId,
          envs: gbVercelEnvMap,
          customize: value.customize,
        }),
      });
      // redirect back to vercel on success (Is this right?)
      window.location.href = next as string;
    } catch (e) {
      console.log(e);
      setFormError(e.message);
      setLoading(false);
    }
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
        {!code || !configurationId ? (
          <>
            <div>
              <h3 className="h2">Problem with Vercel integration</h3>
              <p className="text-muted">
                Missing configuration id, cannot create integration.
              </p>
            </div>
          </>
        ) : (
          <>
            {step === 0 ? (
              <>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (loading) return;
                    setLoading(true);
                    try {
                      //setTargetOrgId(form.watch("orgId"));
                      router.push(
                        `/integrations/vercel/setup?code=${code}&configurationId=${configurationId}&teamId=${teamId}&next=${next}&orgid=${form.watch(
                          "orgId"
                        )}`
                      );
                      setStep(1);
                      setLoading(false);
                    } catch (e) {
                      //setError(e.message);
                      setLoading(false);
                    }
                  }}
                >
                  <div>
                    <h3 className="h2">
                      Connect to your GrowthBook organization
                    </h3>
                    <p className="text-muted">
                      Select the organization you want to connect to Vercel.
                    </p>
                  </div>
                  <div className="row">
                    <div className="col form-group">
                      <SelectField
                        options={organizations.map((org) => ({
                          label: org.name,
                          value: org.id,
                        }))}
                        value={form.watch("orgId")}
                        onChange={(selected) => {
                          form.setValue("orgId", selected);
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <button
                      className={`btn btn-primary btn-block btn-lg`}
                      type="submit"
                    >
                      Choose Organization
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (loading) return;
                    setLoading(true);
                    try {
                      await submitEnvironments();
                      setLoading(false);
                    } catch (e) {
                      //setError(e.message);
                      setLoading(false);
                    }
                  }}
                >
                  <div>
                    {organizations.length > 1 && (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setStep(0);
                          router.push(
                            `/integrations/vercel/setup?code=${code}&configurationId=${configurationId}&teamId=${teamId}&next=${next}`
                          );
                        }}
                      >
                        &lt; back
                      </a>
                    )}
                    <h3 className="h2">
                      Set up your environments for {orgMap.get(orgId)}
                    </h3>
                    {data?.vercel?.length > 0 && (
                      <div className="mb-2">
                        <h5>Existing integrations for this project</h5>
                        <div className="graybox">
                          <div className="row mb-3">
                            <div className="col-6">
                              <strong>Vercel Environment</strong>
                            </div>
                            <div className="col-6">
                              <strong>GrowthBook Environment</strong>
                            </div>
                          </div>
                          {data.vercel.map((vc, i) => (
                            <div key={`vc${i}`}>
                              {vc.environments.map((env, j) => (
                                <div
                                  key={`env${j}`}
                                  className="d-flex mt-2 row align-items-center"
                                >
                                  <div className="col-6">{env.vercel[0]}</div>
                                  <div className="col-6">{env.gb}</div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="text-muted">
                      Vercel has three environments,{" "}
                      <strong>development</strong>, <strong>preview</strong>,
                      and <strong>production</strong>. By default, we will
                      create environments within GrowthBook to match.{" "}
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
                                options={environments
                                  .map((env) => ({
                                    label: env.id,
                                    value: env.id,
                                  }))
                                  .concat([
                                    {
                                      label: "(None)",
                                      value: "-none-",
                                    },
                                  ])}
                                initialOption="(Auto create)"
                                value={elem.gb}
                                onChange={(selected) => {
                                  const newMap = [...gbVercelEnvMap];
                                  newMap[i] = { ...newMap[i], gb: selected };
                                  setGbVercelEnvMap(newMap);
                                  setFormError(null);
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
                  {formError && (
                    <div className="alert alert-danger">
                      Sorry, something went wrong: {formError}
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
          </>
        )}
      </WelcomeFrame>
    </>
  );
}

VercelIntegrationPage.fullFrame = true;

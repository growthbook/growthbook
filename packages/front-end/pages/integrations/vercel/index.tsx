import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useAuth } from "../../../services/auth";
import { Environment } from "back-end/types/organization";
import { useLayout } from "../../../services/layout";
import { GbVercelKeyMap } from "back-end/types/vercel";
import EnvironmentModal from "../../../components/Settings/EnvironmentModal";
import SelectField from "../../../components/Forms/SelectField";
import useOrgSettings from "../../../hooks/useOrgSettings";
import useUser from "../../../hooks/useUser";
import Modal from "../../../components/Modal";
import LoadingSpinner from "../../../components/LoadingSpinner";

export default function VercelIntegration() {
  const router = useRouter();
  const { code, configurationId, teamId, next } = router.query;

  const { apiCall } = useAuth();
  const { update } = useUser();
  const { environments } = useOrgSettings();
  const [, setIsLiteLayout] = useLayout();

  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [envModalOpen, setEnvModalOpen] = useState<Partial<Environment> | null>(
    null
  );
  const [gbVercelKeyMap, setGbVercelKeyMap] = useState<GbVercelKeyMap>([]);

  //Wait until after render. React cannot render 2 comps at once
  useEffect(() => {
    setIsLiteLayout(true);
  });

  useEffect(() => {
    const tmpEnvMappings = [];
    for (let i = 0; i < environments.length; i++) {
      tmpEnvMappings.push({
        gb: gbVercelKeyMap[i]?.gb ? gbVercelKeyMap[i].gb : environments[i].id,
        vercel: gbVercelKeyMap[i]?.vercel ? gbVercelKeyMap[i].vercel : null,
      });
    }
    setGbVercelKeyMap(tmpEnvMappings);
  }, [environments]);

  useEffect(() => {
    async function setVercelToken() {
      try {
        await apiCall("/vercel/token", {
          method: "POST",
          body: JSON.stringify({ code, configurationId, teamId }),
        });
      } catch (err) {
        console.error(err);
        setError(true);
      }
    }
    setVercelToken();
  }, []);

  async function handleSubmission() {
    try {
      setLoading(true);
      await apiCall("/vercel/env-vars", {
        method: "POST",
        body: JSON.stringify({ gbVercelKeyMap }),
      });
      setLoading(false);
      window.location.href = next as string;
    } catch (err) {
      console.error(err);
      setError(true);
      setLoading(false);
    }
  }

  return (
    <Modal open>
      {envModalOpen && (
        <EnvironmentModal
          existing={envModalOpen}
          close={() => setEnvModalOpen(null)}
          onSuccess={update}
        />
      )}
      <div>
        <h4>Generate Environment Variables</h4>
        <div className="text-muted" style={{ fontSize: "0.8rem" }}>
          Env vars GROWTHBOOK_KEY and GROWTHBOOK_WEBHOOK_SECRET will be created
          in GrowthBook and Vercel in the following environments.
        </div>
        {gbVercelKeyMap.map((elem, i) => (
          <div key={`keyMap${i}`} className="d-flex mt-3">
            <div>
              <div>
                <strong>GrowthBook environment:</strong>
              </div>
              <div>{elem.gb}</div>
            </div>
            <div className="ml-5">
              <SelectField
                label="Vercel environment:"
                labelClassName="font-weight-bold"
                options={[
                  { label: "production", value: "production" },
                  { label: "preview", value: "preview" },
                  { label: "development", value: "development" },
                ]}
                initialOption="None"
                value={elem.vercel}
                onChange={(selected) => {
                  const tmpGbVercelKeyMap = [...gbVercelKeyMap];
                  tmpGbVercelKeyMap[i].vercel = selected;
                  setGbVercelKeyMap([...tmpGbVercelKeyMap]);
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div>
        <div className="row px-2 justify-content-between">
          <button
            onClick={() => setEnvModalOpen({})}
            className="btn btn-primary btn-block btn-sm mt-3 col-sm-5"
          >
            Create new environment
          </button>
          <button
            onClick={() => handleSubmission()}
            disabled={loading}
            className="btn btn-primary btn-block btn-sm mt-3 col-sm-5"
          >
            {loading ? <LoadingSpinner /> : "Submit"}
          </button>
        </div>
        {error && (
          <div className="alert alert-warning mt-3">
            Something went wrong, please contact support@growthbook.io
          </div>
        )}
      </div>
    </Modal>
  );
}

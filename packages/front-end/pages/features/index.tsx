import useApi from "../../hooks/useApi";
import { FeatureInterface } from "back-end/types/feature";
import { useDefinitions } from "../../services/DefinitionsContext";
import LoadingOverlay from "../../components/LoadingOverlay";
import { ago, datetime } from "../../services/dates";
import Link from "next/link";
import { useState } from "react";
import { GBAddCircle } from "../../components/Icons";
import FeatureModal from "../../components/Features/FeatureModal";
import ValueDisplay from "../../components/Features/ValueDisplay";
import { useRouter } from "next/router";

export default function FeaturesPage() {
  const { project } = useDefinitions();

  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();
  const { data, error, mutate } = useApi<{
    features: FeatureInterface[];
  }>(`/feature?project=${project || ""}`);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  if (window) {
    return (
      <div className="container mt-5">
        <p className="text-center">
          Please choose the option which best describes your situation.
        </p>
        <div className="d-flex" style={{}}>
          <div>
            <div
              style={{
                height: 300,
                textAlign: "center",
                justifyContent: "center",
              }}
              className="bg-light border d-flex flex-column p-4 mx-3 rounded"
            >
              <h3 className="mb-3">
                I already run experiments and track them in a database or
                analytics tool.
              </h3>
              <p>
                GrowthBook can automate the analysis and let you easily document
                results.
              </p>
            </div>
          </div>
          <div>
            <div
              style={{
                height: 300,
                textAlign: "center",
                justifyContent: "center",
              }}
              className="bg-light border d-flex flex-column p-4 mx-3 rounded"
            >
              <h3 className="mb-3">
                I don&apos;t do any experimentation yet and need a full-featured
                platform.
              </h3>
              <p>
                GrowthBook has SDKs, APIs, and Webhooks to deeply integrate into
                your existing tech stack.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="contents container-fluid pagecontents">
      {modalOpen && (
        <FeatureModal
          close={() => setModalOpen(false)}
          onSuccess={async (feature) => {
            router.push(`/features/${feature.id}`);
            mutate({
              features: [...data.features, feature],
            });
          }}
        />
      )}
      <div className="row">
        <div className="col">
          <h1>Features</h1>
        </div>
        <div className="col-auto">
          <button
            className="btn btn-primary float-right"
            onClick={() => setModalOpen(true)}
          >
            <span className="h4 pr-2 m-0 d-inline-block align-top">
              <GBAddCircle />
            </span>
            Add Feature
          </button>
        </div>
      </div>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <th>Feature Key</th>
            <th>Default Value</th>
            <th>Has Overrides</th>
            <th>Last Updated</th>
          </tr>
        </thead>
        <tbody>
          {data.features.map((feature) => {
            return (
              <tr key={feature.id}>
                <td>
                  <Link href={`/features/${feature.id}`}>
                    <a>{feature.id}</a>
                  </Link>
                </td>
                <td>
                  <ValueDisplay
                    value={feature.defaultValue}
                    type={feature.valueType}
                  />
                </td>
                <td>{feature.rules?.length > 0 ? "yes" : "no"}</td>
                <td title={datetime(feature.dateUpdated)}>
                  {ago(feature.dateUpdated)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import useApi from "../../hooks/useApi";
import { FeatureInterface } from "back-end/types/feature";
import { useDefinitions } from "../../services/DefinitionsContext";
import LoadingOverlay from "../../components/LoadingOverlay";
import { useState } from "react";
import { GBAddCircle } from "../../components/Icons";
import FeatureModal from "../../components/Features/FeatureModal";
import { useRouter } from "next/router";
import track from "../../services/track";
import FeaturesGetStarted from "../../components/HomePage/FeaturesGetStarted";
import useOrgSettings from "../../hooks/useOrgSettings";
import FeatureRow from "../../components/Features/FeatureRow";
import { useSearch } from "../../services/search";
import { useMemo } from "react";
import Field from "../../components/Forms/Field";

export default function FeaturesPage() {
  const { project } = useDefinitions();

  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();
  const { data, error, mutate } = useApi<{
    features: FeatureInterface[];
  }>(`/feature?project=${project || ""}`);

  const settings = useOrgSettings();
  const [showSteps, setShowSteps] = useState(false);

  const stepsRequired =
    !settings?.attributeSchema?.length ||
    !settings?.sdkInstructionsViewed ||
    (data && !data?.features?.length);

  const { list, searchInputProps } = useSearch(data?.features || [], [
    "id",
    "description",
    "tags",
  ]);

  const sorted = useMemo(() => {
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }, [list]);

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

  return (
    <div className="contents container pagecontents">
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
      <div className="row mb-3">
        <div className="col">
          <h1>Features</h1>
        </div>
        {data?.features?.length > 0 && (
          <div className="col-auto">
            <button
              className="btn btn-primary float-right"
              onClick={() => {
                setModalOpen(true);
                track("Viewed Feature Modal", {
                  source: "feature-list",
                });
              }}
              type="button"
            >
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>
              Add Feature
            </button>
          </div>
        )}
      </div>
      <p>
        Features enable you to change your app&apos;s behavior from within the
        GrowthBook UI. For example, turn on/off a sales banner or change the
        title of your pricing page.{" "}
      </p>
      {stepsRequired || showSteps ? (
        <div className="mb-3">
          <h4>
            Setup Steps
            {!stepsRequired && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setShowSteps(false);
                }}
                style={{ fontSize: "0.8em" }}
                className="ml-3"
              >
                hide
              </a>
            )}
          </h4>
          <FeaturesGetStarted features={data.features || []} mutate={mutate} />
          {!stepsRequired && <h4 mt-3>All Features</h4>}
        </div>
      ) : (
        <div className="mb-3">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowSteps(true);
            }}
          >
            Show Setup Steps
          </a>
        </div>
      )}

      {data.features.length > 0 && (
        <div>
          <div className="row mb-2">
            <div className="col-auto">
              <Field placeholder="Filter list..." {...searchInputProps} />
            </div>
          </div>
          <table className="table gbtable table-hover">
            <thead>
              <tr>
                <th>Feature Key</th>
                <th>Dev</th>
                <th>Prod</th>
                <th>Value When Enabled</th>
                <th>Overrides Rules</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((feature) => {
                return (
                  <FeatureRow
                    feature={feature}
                    mutate={mutate}
                    key={feature.id}
                  />
                );
              })}
              {!sorted.length && (
                <tr>
                  <td colSpan={6}>No matching features</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

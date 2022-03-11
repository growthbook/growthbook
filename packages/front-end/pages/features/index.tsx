import LoadingOverlay from "../../components/LoadingOverlay";
import { ago, datetime } from "../../services/dates";
import Link from "next/link";
import { useState } from "react";
import { GBAddCircle } from "../../components/Icons";
import FeatureModal from "../../components/Features/FeatureModal";
import ValueDisplay from "../../components/Features/ValueDisplay";
import { useRouter } from "next/router";
import track from "../../services/track";
import FeaturesGetStarted from "../../components/HomePage/FeaturesGetStarted";
import useOrgSettings from "../../hooks/useOrgSettings";
import { useSearch } from "../../services/search";
import { useMemo } from "react";
import Field from "../../components/Forms/Field";
import ApiKeyUpgrade from "../../components/Features/ApiKeyUpgrade";
import EnvironmentToggle from "../../components/Features/EnvironmentToggle";
import RealTimeFeatureGraph from "../../components/Features/RealTimeFeatureGraph";
import { useFeature } from "@growthbook/growthbook-react";
import {
  useEnvironment,
  useFeaturesList,
  useRealtimeData,
} from "../../services/features";
import Tooltip from "../../components/Tooltip";
import Pagination from "../../components/Pagination";
import { useEffect } from "react";
import TabButtons from "../../components/Tabs/TabButtons";
import TabButton from "../../components/Tabs/TabButton";

const NUM_PER_PAGE = 20;

export default function FeaturesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(1);
  const [env, setEnv] = useEnvironment();

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  const { features, loading, error, mutate } = useFeaturesList();

  const showGraphs = useFeature("feature-list-realtime-graphs").on;
  const { usage, usageDomain } = useRealtimeData(
    features,
    !!router?.query?.mockdata,
    showGraphs
  );

  const settings = useOrgSettings();
  const [showSteps, setShowSteps] = useState(false);

  const stepsRequired =
    !settings?.sdkInstructionsViewed || (!loading && !features.length);

  const { list, searchInputProps } = useSearch(features || [], [
    "id",
    "description",
    "tags",
  ]);

  const sorted = useMemo(() => {
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }, [list]);

  // Reset to page 1 when a filter is applied
  useEffect(() => {
    setCurrentPage(1);
  }, [sorted.length]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (loading) {
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
              features: [...features, feature],
            });
          }}
        />
      )}
      <div className="row mb-3">
        <div className="col">
          <h1>Features</h1>
        </div>
        {features.length > 0 && (
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
          <FeaturesGetStarted features={features} />
          {!stepsRequired && <h4 className="mt-3">All Features</h4>}
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

      <ApiKeyUpgrade />

      {features.length > 0 && (
        <div>
          <div className="row align-items-center mb-3">
            <div className="col-auto mr-4">
              <TabButtons newStyle={true} className="mb-0">
                <TabButton
                  display="dev"
                  active={env === "dev"}
                  onClick={() => setEnv("dev")}
                  newStyle={true}
                />
                <TabButton
                  display="production"
                  active={env === "production"}
                  onClick={() => setEnv("production")}
                  last={true}
                  newStyle={true}
                />
              </TabButtons>
            </div>
            <div className="col-auto">
              <Field placeholder="Filter list..." {...searchInputProps} />
            </div>
          </div>
          <div className="row mb-2"></div>
          <table className="table gbtable table-hover">
            <thead>
              <tr>
                <th>Feature Key</th>
                <th>{env}</th>
                <th>Value When Enabled</th>
                <th>Overrides Rules</th>
                <th>Last Updated</th>
                {showGraphs && (
                  <th>
                    Recent Usage{" "}
                    <Tooltip text="Client-side feature evaluations for the past 30 minutes. Blue means the feature was 'on', Gray means it was 'off'." />
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.slice(start, end).map((feature) => {
                const envSettings = feature.environmentSettings?.[env];
                const envRules = envSettings?.rules;

                const firstRule = envRules?.[0];
                const totalRules = envRules?.length || 0;

                return (
                  <tr key={feature.id}>
                    <td>
                      <Link href={`/features/${feature.id}`}>
                        <a>{feature.id}</a>
                      </Link>
                    </td>
                    <td className="position-relative">
                      <EnvironmentToggle
                        feature={feature}
                        environment={env}
                        mutate={mutate}
                      />
                    </td>
                    <td>
                      <ValueDisplay
                        value={
                          envSettings?.defaultValue ?? feature.defaultValue
                        }
                        type={feature.valueType}
                        full={false}
                      />
                    </td>
                    <td>
                      {firstRule && (
                        <span className="text-dark">{firstRule.type}</span>
                      )}
                      {totalRules > 1 && (
                        <small className="text-muted ml-1">
                          +{totalRules - 1} more
                        </small>
                      )}
                    </td>
                    <td title={datetime(feature.dateUpdated)}>
                      {ago(feature.dateUpdated)}
                    </td>
                    {showGraphs && (
                      <td style={{ width: 170 }}>
                        <RealTimeFeatureGraph
                          data={usage?.[feature.id]?.realtime || []}
                          yDomain={usageDomain}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
              {!sorted.length && (
                <tr>
                  <td colSpan={showGraphs ? 7 : 6}>No matching features</td>
                </tr>
              )}
            </tbody>
          </table>
          {Math.ceil(sorted.length / NUM_PER_PAGE) > 1 && (
            <Pagination
              numItemsTotal={sorted.length}
              currentPage={currentPage}
              perPage={NUM_PER_PAGE}
              onPageChange={(d) => {
                setCurrentPage(d);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

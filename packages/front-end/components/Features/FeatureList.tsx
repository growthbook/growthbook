import Field from "../Forms/Field";
import Link from "next/link";
import EnvironmentToggle from "./EnvironmentToggle";
import ValueDisplay from "./ValueDisplay";
import { ago, datetime } from "../../services/dates";
import { useSearch } from "../../services/search";
import React, { useMemo, useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import Pagination from "../../components/Pagination";
import FeatureModal from "./FeatureModal";
import { useRouter } from "next/router";
import track from "../../services/track";
import { GBAddCircle } from "../Icons";
import RealTimeFeatureGraph from "./RealTimeFeatureGraph";
import { useFeature } from "@growthbook/growthbook-react";
import { useRealtimeData } from "../../services/features";
import Tooltip from "../Tooltip";

export default function FeatureList({
  showPagination = true,
  showAddFeature = true,
  numPerPage = 20,
  features,
  mutate,
}: {
  showPagination?: boolean;
  showAddFeature?: boolean;
  numPerPage?: number;
  features: FeatureInterface[];
  mutate: (data?: {
    features: FeatureInterface[];
  }) => Promise<{ features: FeatureInterface[] }>;
}) {
  const { list, searchInputProps } = useSearch(features, [
    "id",
    "description",
    "tags",
  ]);

  const router = useRouter();
  const showGraphs = useFeature("feature-list-realtime-graphs").on;
  const { usage, usageDomain } = useRealtimeData(
    features,
    !!router?.query?.mockdata,
    showGraphs
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [featuresPerPage] = useState(numPerPage);
  const sorted = useMemo(() => {
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }, [list]);

  if (!features.length) {
    return null;
  }

  return (
    <div>
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
      <div className="row mb-2">
        <div className="col-auto">
          <Field placeholder="Filter list..." {...searchInputProps} />
        </div>
        {showAddFeature && (
          <>
            <div style={{ flex: 1 }} />
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
          </>
        )}
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
            {showGraphs && (
              <th>
                Recent Usage{" "}
                <Tooltip text="Client-side feature evaluations for the past 30 minutes. Blue means the feature was 'on', Gray means it was 'off'." />
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((feature) => {
            const firstRule = feature.rules?.[0];
            const totalRules = feature.rules?.length || 0;

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
                    environment="dev"
                    mutate={mutate}
                  />
                </td>
                <td className="position-relative">
                  <EnvironmentToggle
                    feature={feature}
                    environment="production"
                    mutate={mutate}
                  />
                </td>
                <td>
                  <ValueDisplay
                    value={feature.defaultValue}
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
      {Math.ceil(sorted.length / featuresPerPage) > 1 && showPagination && (
        <Pagination
          numItemsTotal={sorted.length}
          currentPage={currentPage}
          perPage={featuresPerPage}
          onPageChange={(d) => {
            setCurrentPage(d);
          }}
        />
      )}
    </div>
  );
}

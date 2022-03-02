import Field from "../Forms/Field";
import Link from "next/link";
import EnvironmentToggle from "./EnvironmentToggle";
import ValueDisplay from "./ValueDisplay";
import { ago, datetime } from "../../services/dates";
import { useSearch } from "../../services/search";
import { useMemo } from "react";
import { FeatureInterface } from "back-end/types/feature";
import useApi from "../../hooks/useApi";
import { useDefinitions } from "../../services/DefinitionsContext";
import LoadingOverlay from "../LoadingOverlay";

export default function FeaturesList() {
  const { project } = useDefinitions();
  const { data, error, mutate } = useApi<{
    features: FeatureInterface[];
  }>(`/feature?project=${project || ""}`);
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

  if (data.features.length === 0) {
    return <></>;
  }

  return (
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
              </tr>
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
  );
}

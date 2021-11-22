import useApi from "../../hooks/useApi";
import { FeatureInterface } from "back-end/types/feature";
import { useDefinitions } from "../../services/DefinitionsContext";
import LoadingOverlay from "../../components/LoadingOverlay";
import { ago, datetime } from "../../services/dates";
import Link from "next/link";

export default function FeaturesPage() {
  const { project } = useDefinitions();

  const { data, error } = useApi<{
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

  return (
    <div className="contents container-fluid pagecontents">
      <h1>Features</h1>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <th>Feature Id</th>
            <th>Value</th>
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
                  <code>{feature.values[feature.defaultValue].value}</code>
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

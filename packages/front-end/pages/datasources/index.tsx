import { FC } from "react";
import DataSources from "../../components/Settings/DataSources";
import { getDocsLink } from "../../services/docsMapping";

const DataSourcesPage: FC = () => {
  return (
    <div className="container-fluid pagecontents">
      <div className="d-flex">
        <h1>Data Sources</h1>
        <a
          className="align-self-center ml-2 pb-1"
          href={getDocsLink("/datasources")}
          target="_blank"
          rel="noreferrer"
        >
          View Documentation
        </a>
      </div>
      <DataSources />
    </div>
  );
};
export default DataSourcesPage;

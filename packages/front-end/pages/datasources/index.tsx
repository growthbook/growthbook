import { FC } from "react";
import { DocLink } from "@/components/DocLink";
import DataSources from "@/components/Settings/DataSources";

const DataSourcesPage: FC = () => {
  return (
    <div className="container-fluid pagecontents">
      <div className="d-flex">
        <h1>Data Sources</h1>
        <DocLink
          docSection="datasources"
          className="align-self-center ml-2 pb-1"
        >
          View Documentation
        </DocLink>
      </div>
      <DataSources />
    </div>
  );
};
export default DataSourcesPage;

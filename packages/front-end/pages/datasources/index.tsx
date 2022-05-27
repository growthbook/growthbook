import { FC } from "react";
import DataSources from "../../components/Settings/DataSources";

const DataSourcesPage: FC = () => {
  return (
    <div className="container-fluid pagecontents">
      <h1>Data Sources</h1>
      <DataSources />
    </div>
  );
};
export default DataSourcesPage;

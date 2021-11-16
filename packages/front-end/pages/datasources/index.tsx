import Link from "next/link";
import { FC } from "react";
import { FaAngleLeft } from "react-icons/fa";
import DataSources from "../../components/Settings/DataSources";

const DataSourcesPage: FC = () => {
  return (
    <div className="container-fluid pagecontents">
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Data Sources</h1>
      <DataSources />
    </div>
  );
};
export default DataSourcesPage;

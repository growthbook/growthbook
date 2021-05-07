import Link from "next/link";
import { FC } from "react";
import { FaAngleLeft } from "react-icons/fa";
import ApiKeys from "../../components/Settings/ApiKeys";

const ApiKeysPage: FC = () => {
  return (
    <div className="container-fluid mt-3 pagecontents">
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>API Keys</h1>
      <ApiKeys />
    </div>
  );
};
export default ApiKeysPage;

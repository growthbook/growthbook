import Link from "next/link";
import { FC } from "react";
import { FaAngleLeft } from "react-icons/fa";
import Webhooks from "../../components/Settings/Webhooks";

const WebhooksPage: FC = () => {
  return (
    <div className="container-fluid pagecontents">
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Webhooks</h1>
      <Webhooks />
    </div>
  );
};
export default WebhooksPage;

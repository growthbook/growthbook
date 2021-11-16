import Link from "next/link";
import { FC } from "react";
import { FaAngleLeft } from "react-icons/fa";
import { SettingsApiResponse } from ".";
import LoadingOverlay from "../../components/LoadingOverlay";
import InviteList from "../../components/Settings/InviteList";
import MemberList from "../../components/Settings/MemberList";
import useApi from "../../hooks/useApi";

const TeamPage: FC = () => {
  const { data, error, mutate } = useApi<SettingsApiResponse>(`/organization`);

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
    <div className="container-fluid pagecontents">
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Team Members</h1>
      <MemberList members={data.organization.members} mutate={mutate} />
      {data.organization.invites.length > 0 ? (
        <InviteList invites={data.organization.invites} mutate={mutate} />
      ) : (
        ""
      )}
    </div>
  );
};
export default TeamPage;

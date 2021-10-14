import Link from "next/link";
import { FC } from "react";
import { FaAngleLeft } from "react-icons/fa";
import { SettingsApiResponse } from ".";
import LoadingOverlay from "../../components/LoadingOverlay";
import InviteList from "../../components/Settings/InviteList";
import MemberList from "../../components/Settings/MemberList";
import useApi from "../../hooks/useApi";
import { MemberRole, MemberStatus } from "../../services/auth";

export type Member = {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  verificationToken: string;
};

export type Invite = {
  key: string;
  email: string;
  role: string;
  dateCreated: string;
};

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

  const members: Member[] = data.organization.members;
  const invites: Invite[] = data.organization.invites;

  return (
    <div className="container-fluid mt-3 pagecontents">
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Team Members</h1>
      <MemberList members={members} mutate={mutate} />
      {invites.length > 0 && <InviteList invites={invites} mutate={mutate} />}
    </div>
  );
};
export default TeamPage;

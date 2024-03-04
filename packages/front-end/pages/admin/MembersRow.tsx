import { Member } from "@back-end/types/organization";
import { UserInterface } from "@back-end/types/user";

export default function MembersRow({
  member,
  user,
}: {
  member: Member;
  user: UserInterface;
}) {
  return (
    <div className="my-4">
      <div>Member ID: {member.id}</div>
      {user && <div>User name: {user.email} </div>}
    </div>
  );
}

import { useMemo } from "react";
import { useUser } from "../services/UserContext";

export type MemberData = {
  id: string;
  display: string;
  value: string;
  email: string;
};

export default function useMembers(): { memberUsernameOptions: MemberData[] } {
  const { users } = useUser();

  const memberUsernameOptions = useMemo(() => {
    const memberUsernameOptions: MemberData[] = [];

    users.forEach((user) => {
      memberUsernameOptions.push({
        id: user.id,
        display: user.name ? user.name : user.email,
        value: user.name ? user.name : user.email,
        email: user.email,
      });
    });
    return memberUsernameOptions;
  }, [users]);

  return { memberUsernameOptions };
}

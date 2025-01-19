import { useMemo } from "react";
import { useUser } from "@/services/UserContext";

export default function useMembers() {
  const { users } = useUser();

  const memberUsernameOptions = useMemo(() => {
    const memberUsernameOptions: { display: string; value: string }[] = [];
    users.forEach((user) => {
      memberUsernameOptions.push({
        display: user.name ? user.name : user.email,
        value: user.name ? user.name : user.email,
      });
    });
    return memberUsernameOptions;
  }, [users]);

  const memberUserNameAndIdOptions = useMemo(() => {
    const memberUsernameWithIdOptions: {
      display: string;
      value: string;
    }[] = [];
    users.forEach((user) => {
      memberUsernameWithIdOptions.push({
        display: user.name ? user.name : user.email,
        value: user.id,
      });
    });
    return memberUsernameWithIdOptions;
  }, [users]);

  return { memberUsernameOptions, memberUserNameAndIdOptions };
}

import { useMemo } from "react";
import useUser from "./useUser";

export default function useMembers() {
  const { users } = useUser();

  const memberUsernameOptions = useMemo(() => {
    const memberUsernameOptions = [];
    for (const user of users.values()) {
      memberUsernameOptions.push({
        display: user.name ? user.name : user.email,
        value: user.name ? user.name : user.email,
      });
    }
    return memberUsernameOptions;
  }, [users]);

  return { memberUsernameOptions };
}

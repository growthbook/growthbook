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

  return { memberUsernameOptions };
}

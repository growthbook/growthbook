import { useMemo } from "react";
import { useUser } from "../services/UserContext";

export default function useMembers() {
  const { users } = useUser();

  const memberUsernameOptions = useMemo(() => {
    const memberUsernameOptions = [];
    users.forEach((user) => {
      memberUsernameOptions.push({
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string' is not assignable to type 'never'.
        display: user.name ? user.name : user.email,
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string' is not assignable to type 'never'.
        value: user.name ? user.name : user.email,
      });
    });
    return memberUsernameOptions;
  }, [users]);

  return { memberUsernameOptions };
}

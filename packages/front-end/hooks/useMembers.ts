import { UserRef } from "back-end/types/user";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../services/auth";

export default function useMembers() {
  const [members, setMembers] = useState<UserRef[]>([]);
  const { apiCall } = useAuth();

  useEffect(() => {
    async function setUsernames() {
      const res = await apiCall<{ status: number; users: UserRef[] }>(
        "/members",
        {
          method: "GET",
        }
      );
      setMembers(res.users);
    }
    setUsernames();
  }, []);

  const memberUsernameOptions = useMemo(
    () =>
      members.map((member) => {
        return { display: member.name, value: member.name };
      }),
    [members]
  );

  return { members, memberUsernameOptions };
}

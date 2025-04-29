import { useEffect } from "react";
import { useRouter } from "next/router";
import { getApiHost } from "@/services/env";

const VercelPage = () => {
  const router = useRouter();
  useEffect(() => {
    const { code, state, resource_id: resourceId } = router.query;

    if (!code || !state || !resourceId) return;

    const fn = async () => {
      try {
        await fetch(
          `${getApiHost()}/auth/sso/vercel?code=${code}&state=${state}&resourceId=${resourceId}`,
          {
            method: "POST",
            credentials: "include",
          }
        );
      } catch (err) {
        console.log("Ignored:", err);
      } finally {
        router.push("/");
      }
    };

    fn();
  }, [router]);

  return null;
};

VercelPage.noOrganization = true;
VercelPage.preAuth = true;

export default VercelPage;

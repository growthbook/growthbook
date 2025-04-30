import { useEffect } from "react";
import { useRouter } from "next/router";
import { getApiHost } from "@/services/env";

const VercelPage = () => {
  const router = useRouter();

  useEffect(() => {
    const { code, state, resource_id: resourceId } = router.query;

    if (!code || !state) return;

    const fn = async () => {
      try {
        const ret = await fetch(
          `${getApiHost()}/auth/sso/vercel?code=${code}&state=${state}&resourceId=${resourceId}`,
          {
            method: "POST",
            credentials: "include",
            body: JSON.stringify({ code, state, resourceId }),
            headers: {
              "Content-Type": "application/json",
            },
          }
        );

        if (!ret.ok) throw new Error(`Request failed: ${await ret.text()}`);

        const { organizationId } = await ret.json();

        router.push(`/?org=${organizationId}`);
      } catch (err) {
        console.log("Ignored:", err);
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

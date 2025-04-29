import { useEffect } from "react";
import { useRouter } from "next/router";

const apiHost =
  (process.env.API_HOST ?? "").replace(/\/$/, "") || "http://localhost:3100";

const VercelPage = () => {
  const router = useRouter();
  useEffect(() => {
    const { code, state, resource_id: resourceId } = router.query;

    if (!code || !state || !resourceId) return;

    const fn = async () => {
      try {
        await fetch(`${apiHost}/auth/sso/vercel`, {
          method: "POST",
          body: JSON.stringify({
            code,
            state,
            resourceId,
          }),
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
        });
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

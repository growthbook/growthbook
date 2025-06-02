import { useEffect } from "react";
import { useRouter } from "next/router";
import { getApiHost } from "@/services/env";
import { useProject } from "@/services/DefinitionsContext";

const VercelPage = () => {
  const router = useRouter();
  const [, setProject] = useProject();

  useEffect(() => {
    const { code, state, resource_id: resourceId } = router.query;

    if (!code || !state) return;

    const fn = async () => {
      try {
        const ret = await fetch(`${getApiHost()}/auth/sso/vercel`, {
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ code, state, resourceId }),
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!ret.ok) throw new Error(`Request failed: ${await ret.text()}`);

        const { organizationId, projectId } = await ret.json();

        setProject(projectId);
        router.push(`/?org=${organizationId}`);
      } catch (err) {
        console.log("Ignored:", err);
        router.push("/");
      }
    };

    fn();
  }, [setProject, router]);

  return null;
};

VercelPage.noOrganization = true;
VercelPage.preAuth = true;

export default VercelPage;

import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getApiHost } from "@/services/env";
import { useProject } from "@/services/DefinitionsContext";
import { OAuthError } from "@/components/OAuthError";

type QueryParams = {
  code?: string;
  state?: string;
  resource_id?: string;
  experimentation_item_id?: string;
};

const VercelPage = () => {
  const router = useRouter();
  const [, setProject] = useProject();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const {
      code,
      state,
      resource_id: resourceId,
      experimentation_item_id: experimentationItemId,
    } = router.query as QueryParams;

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

        const urlRegex = /^(features|experiment):/;

        const baseUrl =
          "/" +
          (experimentationItemId?.match(urlRegex)
            ? experimentationItemId.replace(urlRegex, "/$1/")
            : "");

        if (projectId) setProject(projectId);
        router.push(`${baseUrl}?org=${organizationId}`);
      } catch (err) {
        setError(String(err));
      }
    };

    fn();
  }, [setProject, router]);

  return error ? <OAuthError error={error} /> : null;
};

VercelPage.noOrganization = true;
VercelPage.preAuth = true;

export default VercelPage;

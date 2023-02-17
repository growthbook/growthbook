import { useFeature } from "@growthbook/growthbook-react";
import { useEffect } from "react";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";

export default function InAppHelp() {
  const config = useFeature("papercups-config").value;
  const { name, email, userId } = useUser();
  useEffect(() => {
    if (!isCloud() || !config) return;
    if (window["Papercups"]) return;
    window["Papercups"] = {
      config: {
        ...config,
        customer: {
          name,
          email,
          external_id: userId,
        },
      },
    };
    const s = document.createElement("script");
    s.async = true;
    s.src = config.baseUrl + "/widget.js";
    document.head.appendChild(s);
  }, [config]);

  return null;
}

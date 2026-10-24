import { useFeature } from "@growthbook/growthbook-react";
import { useEffect } from "react";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";

// Pylon draws its own chat bubble; Help itself is in HelpMenu.
export default function InAppHelp() {
  const config = useFeature("pylon-config").value;
  const {
    name,
    email,
    pylonHmacHash,
    hasCommercialFeature,
    commercialFeatures,
  } = useUser();

  useEffect(() => {
    if (window["pylon"] || !config) return;

    if (hasCommercialFeature("livechat") && isCloud()) {
      const scriptElement = document.createElement("script");
      scriptElement.innerHTML = config.script_content;

      document.body.appendChild(scriptElement);
      window["pylon"] = {
        chat_settings: {
          app_id: config.app_id,
          email_hash: pylonHmacHash,
          email,
          name,
        },
      };
    }
  }, [config, commercialFeatures]);

  return null;
}

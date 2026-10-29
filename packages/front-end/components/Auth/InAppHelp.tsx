import { useFeature } from "@growthbook/growthbook-react";
import { useEffect } from "react";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";

// Pylon's launcher is a third-party iframe, so its footprint can't be measured.
const PYLON_CLEARANCE_PX = 76;

/** Loads Pylon, which draws its own chat bubble; the Help menu is HelpMenu. */
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

  // Publish the launcher's footprint so bottom-right overlays can clear it.
  useEffect(() => {
    const publish = (px: number) =>
      document.documentElement.style.setProperty(
        "--help-launcher-clearance",
        `${px}px`,
      );
    publish(window["pylon"] ? PYLON_CLEARANCE_PX : 0);
    return () => publish(0);
  });

  return null;
}

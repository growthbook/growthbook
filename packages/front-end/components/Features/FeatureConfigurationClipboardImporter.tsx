import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { GrowthBookFeatureClipboardFeature } from "shared/validators";
import FeatureModal from "@/components/Features/FeatureModal";
import { parseFeatureConfigurationClipboardPayload } from "@/services/feature-configuration-clipboard";

function getClipboardText(event: ClipboardEvent): string {
  return event.clipboardData?.getData("text/plain") || "";
}

export default function FeatureConfigurationClipboardImporter() {
  const router = useRouter();
  const [featureToImport, setFeatureToImport] =
    useState<GrowthBookFeatureClipboardFeature | null>(null);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const payload = parseFeatureConfigurationClipboardPayload(
        getClipboardText(event),
      );
      if (!payload) return;

      event.preventDefault();
      setFeatureToImport(payload.feature);
    };

    document.addEventListener("paste", handlePaste, true);
    return () => document.removeEventListener("paste", handlePaste, true);
  }, []);

  if (!featureToImport) return null;

  return (
    <FeatureModal
      cta="Import"
      close={() => setFeatureToImport(null)}
      onSuccess={async (feature, options) => {
        setFeatureToImport(null);
        await router.push({
          pathname: `/features/${feature.id}`,
          query: options?.draftVersion ? { v: options.draftVersion } : {},
        });
      }}
      featureToImport={featureToImport}
    />
  );
}

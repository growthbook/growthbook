import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { GrowthBookClipboardPayload } from "shared/validators";
import FeatureModal from "@/components/Features/FeatureModal";
import FeatureConfigurationReferenceMappingModal, {
  payloadHasReferences,
} from "@/components/Features/FeatureConfigurationReferenceMappingModal";
import { parseFeatureConfigurationClipboardPayload } from "@/services/feature-configuration-clipboard";

function getClipboardText(event: ClipboardEvent): string {
  return event.clipboardData?.getData("text/plain") || "";
}

// Matches the envelope's `"source": "growthbook"` marker tolerating any JSON
// whitespace between the key and value (covers minified and pretty-printed
// forms). Far cheaper than JSON.parse on large non-import pastes.
const GROWTHBOOK_ENVELOPE_MARKER = /"source"\s*:\s*"growthbook"/;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) {
    // <input type="button|submit|checkbox|...> isn't a paste sink; only treat
    // text-like inputs as editable.
    const nonTextTypes = new Set([
      "button",
      "submit",
      "reset",
      "checkbox",
      "radio",
      "range",
      "color",
      "file",
      "image",
    ]);
    return !nonTextTypes.has(target.type);
  }
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return false;
  return target.isContentEditable;
}

// The import flow is a state machine:
//   "mapping"  — show the reference-mapping modal (rules reference at least
//                one cross-org object that the user must resolve)
//   "creating" — references are resolved (or there were none); show the
//                FeatureModal that actually creates the feature
type ImportStep = "mapping" | "creating";

export default function FeatureConfigurationClipboardImporter() {
  const router = useRouter();
  const [payload, setPayload] = useState<GrowthBookClipboardPayload | null>(
    null,
  );
  const [step, setStep] = useState<ImportStep>("creating");
  // Bumped on every fresh paste. Used as the FeatureModal `key` so that a
  // second paste while the modal is already open remounts the form — useForm
  // only honors `defaultValues` at mount, so without a remount the second
  // payload's id/rules/project would be ignored and the modal would submit
  // the first payload's values.
  const [pasteSequence, setPasteSequence] = useState(0);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      // Never intercept pastes destined for an editable element — the user is
      // trying to type, not import a feature.
      if (isEditableTarget(event.target)) return;

      const text = getClipboardText(event);
      if (!text || !GROWTHBOOK_ENVELOPE_MARKER.test(text)) return;

      const parsed = parseFeatureConfigurationClipboardPayload(text);
      if (!parsed) return;

      event.preventDefault();
      setPayload(parsed);
      setStep(payloadHasReferences(parsed) ? "mapping" : "creating");
      setPasteSequence((n) => n + 1);
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  if (!payload) return null;

  if (step === "mapping") {
    return (
      <FeatureConfigurationReferenceMappingModal
        payload={payload}
        close={() => setPayload(null)}
        onConfirm={(mapped) => {
          setPayload(mapped);
          setStep("creating");
        }}
      />
    );
  }

  return (
    <FeatureModal
      key={pasteSequence}
      cta="Import"
      close={() => setPayload(null)}
      onSuccess={async (feature, options) => {
        setPayload(null);
        await router.push({
          pathname: `/features/${feature.id}`,
          query: options?.draftVersion ? { v: options.draftVersion } : {},
        });
      }}
      featureToImport={payload.feature}
      safeRolloutImportSettings={payload.safeRolloutSettings}
    />
  );
}

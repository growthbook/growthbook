import FormData from "form-data";
import { AIProvider, getProviderFromSTTModel } from "shared/ai";
import type { ReqContext } from "back-end/types/request";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { missingAIKeyMessage } from "back-end/src/services/aiCredentials";
import { recordSTTUsage } from "back-end/src/enterprise/services/ai";
import { fetch } from "back-end/src/util/http.util";

// OpenAI and Mistral share OpenAI's /v1/audio/transcriptions contract; xAI
// serves its own /v1/stt. All three answer with `{ text }`.
const STT_ENDPOINTS: Partial<Record<AIProvider, string>> = {
  openai: "https://api.openai.com/v1/audio/transcriptions",
  mistral: "https://api.mistral.ai/v1/audio/transcriptions",
  xai: "https://api.x.ai/v1/stt",
};

/**
 * Transcribe a recorded clip with the org's resolved dictation model.
 * `mimeType` is the browser's container choice (Safari mp4, Chrome webm).
 *
 * Posted as multipart directly rather than through the AI SDK's transcribe():
 * that helper ignores a caller-supplied media type and sniffs the bytes, and
 * its signature table has no webm entry and matches mp4's `ftyp` at offset 0
 * (real files carry it at offset 4). Both fall through to a hardcoded
 * audio/wav, so every container a browser can record is uploaded as
 * `audio.wav` and rejected by the provider.
 *
 * Callers must gate on secondsUntilAICanBeUsedAgainForSTT first; this records
 * the usage that gate reads.
 */
export async function transcribeAudio(
  context: ReqContext,
  audio: Buffer,
  mimeType: string,
): Promise<string> {
  const settings = await getAISettingsForOrg(context, true);
  const { sttModel } = settings;
  if (!sttModel) {
    throw new Error("No transcription model is available.");
  }

  const provider = getProviderFromSTTModel(sttModel);
  const apiKey =
    provider === "xai"
      ? settings.xaiAPIKey
      : provider === "mistral"
        ? settings.mistralAPIKey
        : settings.openAIAPIKey;
  if (!apiKey) {
    throw new Error(missingAIKeyMessage(provider));
  }

  const url = STT_ENDPOINTS[provider];
  if (!url) {
    throw new Error(`${sttModel} cannot be used for transcription.`);
  }

  await recordSTTUsage(context, audio.length, provider);

  const form = new FormData();
  // Providers key off the extension, so it has to match the actual container.
  form.append("file", audio, {
    filename: `dictation.${extensionFor(mimeType)}`,
    contentType: mimeType,
  });
  // xAI's /v1/stt serves one model and documents no `model` field.
  if (provider !== "xai") form.append("model", sttModel);

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Transcription failed (HTTP ${res.status})`);
  }
  return ((await res.json()) as { text?: string }).text ?? "";
}

// "audio/webm;codecs=opus" -> "webm". Keep in sync with the recorder's
// preference list in useDictation.ts, which only offers containers every
// endpoint above accepts.
function extensionFor(mimeType: string): string {
  return mimeType.split(";")[0].split("/")[1] || "webm";
}

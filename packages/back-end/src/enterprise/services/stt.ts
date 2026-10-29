import FormData from "form-data";
import {
  AI_PROVIDER_META,
  STTProvider,
  getProviderFromSTTModel,
} from "shared/ai";
import type { ReqContext } from "back-end/types/request";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { missingAIKeyMessage } from "back-end/src/services/aiCredentials";
import { recordSTTUsage } from "back-end/src/enterprise/services/ai";
import { fetch } from "back-end/src/util/http.util";
import { getAIEndpointFetch } from "back-end/src/services/aiEndpoint";

const STT_PATHS: Record<STTProvider, string> = {
  openai: "/audio/transcriptions",
  mistral: "/audio/transcriptions",
  xai: "/stt",
};

// Multipart directly, not the AI SDK's transcribe(): it mis-sniffs webm/mp4 as audio/wav, which providers reject.
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

  const form = new FormData();
  form.append("file", audio, {
    filename: `dictation.${mimeType.split(";")[0].split("/")[1] || "webm"}`,
    contentType: mimeType,
  });
  // xAI's /v1/stt serves one model and documents no `model` field.
  if (provider !== "xai") form.append("model", sttModel);

  const baseUrl = settings.baseUrls[provider];
  const url = `${baseUrl || AI_PROVIDER_META[provider].defaultBaseUrl}${STT_PATHS[provider]}`;
  const init = {
    method: "POST",
    headers: { ...form.getHeaders(), Authorization: `Bearer ${apiKey}` },
    body: form.getBuffer(),
  };
  const guardedFetch = getAIEndpointFetch(baseUrl);
  const res = guardedFetch
    ? await guardedFetch(url, init)
    : await fetch(url, init);
  if (!res.ok) {
    throw new Error(`Transcription failed (HTTP ${res.status})`);
  }
  const text = ((await res.json()) as { text?: string }).text ?? "";

  // Success only, so failed uploads can't burn the org's daily cap.
  await recordSTTUsage(context, audio.length, provider);
  return text;
}

import { experimental_transcribe as transcribe } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import FormData from "form-data";
import { getProviderFromSTTModel } from "shared/ai";
import type { ReqContext } from "back-end/types/request";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { missingAIKeyMessage } from "back-end/src/services/aiCredentials";
import { fetch } from "back-end/src/util/http.util";

// xAI serves STT from /v1/stt with its own multipart contract rather than an
// OpenAI-compatible /v1/audio/transcriptions.
async function transcribeWithXai(
  apiKey: string,
  audio: Buffer,
  mimeType: string,
): Promise<string> {
  const form = new FormData();
  // The extension is cosmetic (xAI sniffs the bytes) but the part needs a name.
  form.append("file", audio, {
    filename: `dictation.${mimeType.split(";")[0].split("/")[1] || "webm"}`,
    contentType: mimeType,
  });

  const res = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Transcription failed (xAI returned HTTP ${res.status})`);
  }
  return ((await res.json()) as { text?: string }).text ?? "";
}

/**
 * Transcribe a recorded clip with the org's resolved dictation model.
 * `mimeType` is the browser's container choice (Safari mp4, Chrome webm).
 *
 * ponytail: no usage accounting — the org AI cap counts tokens, and audio
 * minutes aren't tokens. Add a minutes counter if dictation cost shows up.
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

  if (provider === "xai") return transcribeWithXai(apiKey, audio, mimeType);

  // Mistral's endpoint is a drop-in for OpenAI's, so only the base URL differs.
  const openai = createOpenAI({
    apiKey,
    ...(provider === "mistral" ? { baseURL: "https://api.mistral.ai/v1" } : {}),
  });
  const { text } = await transcribe({
    model: openai.transcription(sttModel),
    audio,
  });
  return text;
}

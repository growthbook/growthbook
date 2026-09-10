import { experimental_transcribe as transcribe } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import FormData from "form-data";
import { getProviderFromSTTModel } from "shared/ai";
import type { ReqContext } from "back-end/types/request";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { missingAIKeyMessage } from "back-end/src/services/aiCredentials";
import { fetch } from "back-end/src/util/http.util";

// Mistral's transcription endpoint is a drop-in for OpenAI's, so both run
// through the AI SDK's transcribe() with only the base URL swapped.
const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

// xAI is the exception: its STT model is served from /v1/stt with its own
// multipart contract, not an OpenAI-compatible /v1/audio/transcriptions.
const XAI_STT_URL = "https://api.x.ai/v1/stt";

// The extension is cosmetic to xAI (it sniffs the bytes) but the field has to
// carry a filename or the multipart part is rejected.
function filenameForMimeType(mimeType: string): string {
  const subtype = mimeType.split(";")[0].split("/")[1] || "webm";
  return `dictation.${subtype}`;
}

async function transcribeWithXai(
  apiKey: string,
  audio: Buffer,
  mimeType: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", audio, {
    filename: filenameForMimeType(mimeType),
    contentType: mimeType,
  });

  const res = await fetch(XAI_STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Transcription failed (xAI returned HTTP ${res.status})`);
  }
  const json = (await res.json()) as { text?: string };
  return json.text ?? "";
}

/**
 * Transcribe a recorded audio clip using the org's resolved dictation model.
 *
 * `mimeType` comes from the request's Content-Type — the browser picks the
 * container, so it varies by platform (Safari mp4, Chrome webm).
 *
 * ponytail: no usage accounting — the org AI cap counts tokens and audio
 * minutes aren't tokens. Add a minutes counter to AITokenUsageModel if
 * dictation cost shows up.
 */
export async function transcribeAudio(
  context: ReqContext,
  audio: Buffer,
  mimeType: string,
): Promise<string> {
  const settings = await getAISettingsForOrg(context, true);
  const { sttModel } = settings;

  if (!sttModel) {
    throw new Error(
      "No transcription model is available. Add an OpenAI, xAI, or Mistral API key under Settings → AI & Prompts.",
    );
  }

  const provider = getProviderFromSTTModel(sttModel);
  const apiKey = {
    openai: settings.openAIAPIKey,
    xai: settings.xaiAPIKey,
    mistral: settings.mistralAPIKey,
  }[provider as "openai" | "xai" | "mistral"];

  if (!apiKey) {
    throw new Error(missingAIKeyMessage(provider));
  }

  if (provider === "xai") {
    return transcribeWithXai(apiKey, audio, mimeType);
  }

  const openai = createOpenAI({
    apiKey,
    ...(provider === "mistral" ? { baseURL: MISTRAL_BASE_URL } : {}),
  });
  // No mediaType argument: the provider detects the container from the bytes.
  const { text } = await transcribe({
    model: openai.transcription(sttModel),
    audio,
  });
  return text;
}

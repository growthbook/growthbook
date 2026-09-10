import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";

// Containers in preference order. xAI's STT doesn't list WebM among its
// accepted formats (though it does list MKV, which WebM is a subset of), so
// prefer the containers every provider names before falling back to it.
// Safari produces mp4, Chrome produces webm.
const PREFERRED_MIME_TYPES = [
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
];

// A forgotten open mic is a memory and a billing problem, so cap the clip.
const MAX_RECORDING_MS = 5 * 60 * 1000;

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return (
    PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ??
    null
  );
}

export interface Dictation {
  /** False when the org has no transcription model or the browser can't record. */
  available: boolean;
  recording: boolean;
  transcribing: boolean;
  error: string | null;
  toggle: () => void;
}

/**
 * Record a clip from the microphone and hand the transcript to `onTranscript`.
 *
 * `sttModel` is resolved server-side and arrives on the org payload, so this
 * doesn't re-derive availability from the provider key list — the settings
 * dropdown only filters by key on Cloud, and a second guess here could
 * disagree with what the transcribe route actually does.
 */
export function useDictation(onTranscript: (text: string) => void): Dictation {
  const { apiCall } = useAuth();
  const { sttModel } = useUser();
  const { aiEnabled } = useAISettings();

  // Set after mount: MediaRecorder doesn't exist during SSR, and deciding
  // during render would make the server and first client render disagree.
  const [canRecord, setCanRecord] = useState(false);
  useEffect(() => setCanRecord(!!pickMimeType()), []);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const timeoutRef = useRef<number | null>(null);
  // Read in the recorder's async callbacks, which outlive a render.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stopTracks = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Releasing the mic on unmount matters — the browser shows a recording
  // indicator for as long as the track is live.
  useEffect(() => stopTracks, [stopTracks]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const mimeType = pickMimeType();
    if (!mimeType) {
      setError("This browser can't record audio.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, dismissed, or no input device — all the same to the user.
      setError("Microphone access was blocked.");
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      stopTracks();
      const audio = new Blob(chunks, { type: mimeType });
      if (!audio.size) return;

      setTranscribing(true);
      try {
        const res = await apiCall<{ text: string }>("/ai/transcribe", {
          method: "POST",
          body: audio,
          headers: { "Content-Type": mimeType },
        });
        const text = res?.text?.trim();
        if (text) onTranscriptRef.current(text);
        else setError("Nothing was transcribed. Try again.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Transcription failed.");
      } finally {
        setTranscribing(false);
      }
    };

    recorder.start();
    setRecording(true);
    timeoutRef.current = window.setTimeout(stop, MAX_RECORDING_MS);
  }, [apiCall, stop, stopTracks]);

  return {
    available: !!sttModel && aiEnabled && canRecord,
    recording,
    transcribing,
    error,
    toggle: () => (recording ? stop() : start()),
  };
}

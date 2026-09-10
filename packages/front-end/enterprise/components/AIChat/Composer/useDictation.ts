import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";

// Containers in preference order. xAI's STT doesn't list WebM among its
// accepted formats, so try what every provider names before falling back to
// it. Safari records mp4, Chrome records webm.
const MIME_TYPES = [
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
];

// A forgotten open mic is a memory and a billing problem.
const MAX_RECORDING_MS = 5 * 60 * 1000;

const pickMimeType = () =>
  typeof MediaRecorder === "undefined"
    ? null
    : (MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null);

export interface Dictation {
  available: boolean;
  recording: boolean;
  transcribing: boolean;
  error: string | null;
  toggle: () => void;
}

/** Record a clip and hand the transcript to `onTranscript`. */
export function useDictation(onTranscript: (text: string) => void): Dictation {
  const { apiCall } = useAuth();
  // Resolved server-side, and already null when AI is off or no provider with
  // a key serves transcription — so there is nothing to re-derive here.
  const { sttModel } = useUser();

  // Set after mount: MediaRecorder doesn't exist during SSR, and deciding
  // during render would make the server and first client render disagree.
  const [canRecord, setCanRecord] = useState(false);
  useEffect(() => setCanRecord(!!pickMimeType()), []);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const timeoutRef = useRef<number | null>(null);
  // Read inside the recorder's callbacks, which outlive a render.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const release = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  // The browser shows a recording indicator for as long as a track is live.
  useEffect(() => release, [release]);

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
      // Denied, dismissed, or no input device — same outcome to the user.
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
      release();
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
  }, [apiCall, release, stop]);

  return {
    available: !!sttModel && canRecord,
    recording,
    transcribing,
    error,
    toggle: () => (recording ? stop() : start()),
  };
}

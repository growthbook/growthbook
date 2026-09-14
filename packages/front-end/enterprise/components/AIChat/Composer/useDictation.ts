import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";

// Narrowed to what every transcription endpoint accepts. OpenAI's list is the
// binding one, and it rejects ogg — offering ogg/opus failed on Firefox.
const MIME_TYPES = ["audio/mp4", "audio/webm;codecs=opus"];

// A forgotten open mic is a memory and a billing problem.
const MAX_RECORDING_MS = 5 * 60 * 1000;

const pickMimeType = () =>
  typeof MediaRecorder === "undefined"
    ? null
    : (MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null);

// Recorder support differs between the server and the browser, and the
// composer is in the SSR tree on every page (AgentLauncher is a plain import
// in _app). useSyncExternalStore is React's own answer to that: it renders the
// server snapshot during hydration and the client one after, so the two can't
// disagree. Support never changes within a session, so the store never emits.
const NEVER_CHANGES = () => () => {};
const useCanRecord = () =>
  useSyncExternalStore(
    NEVER_CHANGES,
    () => !!pickMimeType(),
    () => false,
  );

export interface Dictation {
  available: boolean;
  recording: boolean;
  transcribing: boolean;
  error: string | null;
  toggle: () => void;
  /** Called on editor input so a failed attempt doesn't linger over a retry. */
  clearError: () => void;
}

/** Record a clip and hand the transcript to `onTranscript`. */
export function useDictation(onTranscript: (text: string) => void): Dictation {
  const { apiCall } = useAuth();
  // Already null when AI is off or no provider with a key serves transcription.
  const { sttModel } = useUser();
  const canRecord = useCanRecord();

  const [status, setStatus] = useState<"idle" | "recording" | "transcribing">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const timeoutRef = useRef<number | null>(null);
  // Non-null while a permission prompt is open. Doubles as the re-entrancy
  // guard (a double-click would otherwise orphan the first stream) and the
  // cancel signal, since release() aborts it.
  const startAbortRef = useRef<AbortController | null>(null);

  const release = useCallback(() => {
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  // The browser shows a recording indicator for as long as a track is live.
  useEffect(() => release, [release]);

  const clearError = useCallback(() => setError(null), []);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (startAbortRef.current || recorderRef.current) return;
    setError(null);
    const mimeType = pickMimeType();
    if (!mimeType) {
      setError("This browser can't record audio.");
      return;
    }

    const abort = new AbortController();
    startAbortRef.current = abort;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, dismissed, or no input device — same outcome to the user.
      setError("Microphone access was blocked.");
      return;
    } finally {
      // Identity-checked: release() may already have cleared it for a newer start.
      if (startAbortRef.current === abort) startAbortRef.current = null;
    }

    // The prompt can outlive the component; don't start a mic nobody owns.
    if (abort.signal.aborted) {
      stream.getTracks().forEach((t) => t.stop());
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

      setStatus("transcribing");
      try {
        const res = await apiCall<{ text: string }>("/ai/transcribe", {
          method: "POST",
          body: audio,
          headers: { "Content-Type": mimeType },
        });
        const text = res?.text?.trim();
        if (text) onTranscript(text);
        else setError("Nothing was transcribed. Try again.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Transcription failed.");
      } finally {
        setStatus("idle");
      }
    };

    recorder.start();
    setStatus("recording");
    timeoutRef.current = window.setTimeout(stop, MAX_RECORDING_MS);
  }, [apiCall, onTranscript, release, stop]);

  return {
    available: !!sttModel && canRecord,
    recording: status === "recording",
    transcribing: status === "transcribing",
    error,
    toggle: () => (status === "recording" ? stop() : start()),
    clearError,
  };
}

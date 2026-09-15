import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";

// OpenAI's accepted list is the binding one, and it rejects ogg.
const MIME_TYPES = ["audio/mp4", "audio/webm;codecs=opus"];

const MAX_RECORDING_MS = 5 * 60 * 1000;

const pickMimeType = () =>
  typeof MediaRecorder === "undefined"
    ? null
    : (MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null);

// Server/client support differs, so go through useSyncExternalStore to keep hydration honest.
const NEVER_CHANGES = () => () => {};
const useCanRecord = () =>
  useSyncExternalStore(
    NEVER_CHANGES,
    () => !!pickMimeType(),
    () => false,
  );

const NOISE_FLOOR = 0.015;
const RELEASE = 0.85; // Fast attack, slow release, so gaps between syllables decay instead of strobing.

/** Writes the live input level onto `node` as `--mic-level` (0-1) every frame, bypassing React. */
function startLevelMeter(stream: MediaStream, node: HTMLElement | null) {
  const Ctx =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return () => {};

  let last = "";
  const setLevel = (v: string) => {
    // Every write is a style recalc.
    if (v === last) return;
    last = v;
    node?.style.setProperty("--mic-level", v);
  };

  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  // ~21ms window: long enough not to jitter on a single glottal pulse.
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);

  let frame = 0;
  let live = true;
  let level = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const v of samples) sum += (v - 128) ** 2;
    const rms = Math.sqrt(sum / samples.length) / 128;
    // Square-rooted: speech sits around 0.05-0.25, so a linear map barely moves the control.
    const next = Math.min(
      1,
      Math.sqrt((Math.max(0, rms - NOISE_FLOOR) / (1 - NOISE_FLOOR)) * 4),
    );
    level = next > level ? next : level * RELEASE + next * (1 - RELEASE);
    setLevel(level.toFixed(2));
    if (live) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    live = false;
    cancelAnimationFrame(frame);
    void ctx.close().catch(() => {});
    setLevel("0");
  };
}

export interface Dictation {
  available: boolean;
  recording: boolean;
  transcribing: boolean;
  error: string | null;
  toggle: () => void;
  /** Called on editor input so a failed attempt doesn't linger over a retry. */
  clearError: () => void;
  /** Attach to the mic button; the level meter writes `--mic-level` onto it. */
  micRef: RefObject<HTMLButtonElement>;
}

/** Record a clip and hand the transcript to `onTranscript`. */
export function useDictation(onTranscript: (text: string) => void): Dictation {
  const { apiCall } = useAuth();
  const { sttModel } = useUser();
  const canRecord = useCanRecord();

  const [status, setStatus] = useState<"idle" | "recording" | "transcribing">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // Everything a live recording owns and must give back.
  const sessionRef = useRef<{
    recorder: MediaRecorder;
    stopMeter: () => void;
    timeout: number;
  } | null>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  // Non-null while a permission prompt is open; doubles as re-entrancy guard and cancel signal.
  const startAbortRef = useRef<AbortController | null>(null);

  const release = useCallback(() => {
    startAbortRef.current?.abort();
    startAbortRef.current = null;

    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;
    session.stopMeter();
    session.recorder.stream.getTracks().forEach((t) => t.stop());
    window.clearTimeout(session.timeout);
  }, []);

  // The browser shows a recording indicator for as long as a track is live.
  useEffect(() => release, [release]);

  const clearError = useCallback(() => setError(null), []);

  const stop = useCallback(() => {
    sessionRef.current?.recorder.stop();
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (startAbortRef.current || sessionRef.current) return;
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
    // Registered before the meter, so a meter that throws still leaves a releasable session.
    const session = {
      recorder,
      stopMeter: () => {},
      timeout: window.setTimeout(stop, MAX_RECORDING_MS),
    };
    sessionRef.current = session;
    session.stopMeter = startLevelMeter(stream, micRef.current);
  }, [apiCall, onTranscript, release, stop]);

  return {
    micRef,
    available: !!sttModel && canRecord,
    recording: status === "recording",
    transcribing: status === "transcribing",
    error,
    toggle: () => (status === "recording" ? stop() : start()),
    clearError,
  };
}

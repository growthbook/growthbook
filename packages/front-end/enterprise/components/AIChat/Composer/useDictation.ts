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

// Narrowed to what every transcription endpoint accepts. OpenAI's list is the
// binding one, and it rejects ogg — offering ogg/opus failed on Firefox.
const MIME_TYPES = ["audio/mp4", "audio/webm;codecs=opus"];

// A forgotten open mic is a memory and a billing problem.
const MAX_RECORDING_MS = 5 * 60 * 1000;

const pickMimeType = () =>
  typeof MediaRecorder === "undefined"
    ? null
    : (MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null);

// Recorder support differs between server and browser, and the composer is in
// every page's SSR tree. useSyncExternalStore renders a false server snapshot
// and the real client one, so hydration can't disagree. Support can't change
// within a session, so the store never emits.
const NEVER_CHANGES = () => () => {};
const useCanRecord = () =>
  useSyncExternalStore(
    NEVER_CHANGES,
    () => !!pickMimeType(),
    () => false,
  );

/**
 * Write the live input level onto `node` as `--mic-level` (0-1) until the
 * returned teardown runs. Straight to the DOM because it updates every frame,
 * and re-rendering the composer at that rate to animate one button is absurd.
 * A flat level is how a muted mic tells you it's muted. CSS drops the effect
 * under prefers-reduced-motion; the loop is too cheap to also check here.
 */

// Room tone still reads as signal, so subtract it — otherwise the control
// never settles at rest even in a silent room.
const NOISE_FLOOR = 0.015;
// Fast attack, slow release, as any level meter does it: a syllable registers
// at once, but the gaps between syllables decay instead of strobing to zero.
const RELEASE = 0.85;

function startLevelMeter(stream: MediaStream, node: HTMLElement | null) {
  const Ctx =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return () => {};

  let last = "";
  const setLevel = (v: string) => {
    // Every write is a style recalc, and silence would otherwise write the
    // same value 60x a second.
    if (v === last) return;
    last = v;
    node?.style.setProperty("--mic-level", v);
  };

  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  // Window length, not a frequency concern — getByteTimeDomainData ignores
  // smoothingTimeConstant, so this is the only averaging the browser gives us.
  // 1024 samples is ~21ms, long enough not to jitter on a single glottal pulse.
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
    // Square-rooted because raw RMS spends most of its time near the floor —
    // speech sits around 0.05-0.25, so a linear map barely moves the control.
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
    // Browsers cap live AudioContexts; one per recording would pile up.
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
  // Already null when AI is off or no provider with a key serves transcription.
  const { sttModel } = useUser();
  const canRecord = useCanRecord();

  const [status, setStatus] = useState<"idle" | "recording" | "transcribing">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // Everything a live recording owns and must give back. One ref because the
  // three are created together and torn down together; they were never
  // independent.
  const sessionRef = useRef<{
    recorder: MediaRecorder;
    stopMeter: () => void;
    timeout: number;
  } | null>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  // Non-null while a permission prompt is open. Doubles as the re-entrancy
  // guard (a double-click would otherwise orphan the first stream) and the
  // cancel signal, since release() aborts it.
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
    // Nothing can interleave between the await above and here, so publishing
    // the session in one go still closes the re-entrancy window.
    sessionRef.current = {
      recorder,
      stopMeter: startLevelMeter(stream, micRef.current),
      timeout: window.setTimeout(stop, MAX_RECORDING_MS),
    };
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

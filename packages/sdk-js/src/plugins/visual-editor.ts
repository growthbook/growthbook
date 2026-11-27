import mutate, { DeclarativeMutation } from "dom-mutator";
import type {
  ApplyDomChangesCallback,
  AutoExperimentVariation,
  Plugin,
} from "../types/growthbook";
import { addAutoExperimentHandler } from "./utils/auto-experiments";

export type VisualEditorPluginOptions = {
  /**
   * Custom JavaScript runs with full access to the page. Without this, an
   * experiment where any variation has custom JavaScript doesn't run.
   */
  allowCustomJs?: boolean;
  jsInjectionNonce?: string;
  applyDomChangesCallback?: ApplyDomChangesCallback;
};

function applyDOMChanges(changes: AutoExperimentVariation, nonce?: string) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const undo: (() => void)[] = [];
  if (changes.css) {
    const s = document.createElement("style");
    s.innerHTML = changes.css;
    document.head.appendChild(s);
    undo.push(() => s.remove());
  }
  if (changes.js) {
    const script = document.createElement("script");
    script.innerHTML = changes.js;
    if (nonce) {
      script.nonce = nonce;
    }
    document.head.appendChild(script);
    undo.push(() => script.remove());
  }
  if (changes.domMutations) {
    changes.domMutations.forEach((mutation) => {
      undo.push(mutate.declarative(mutation as DeclarativeMutation).revert);
    });
  }
  return () => {
    undo.forEach((fn) => fn());
  };
}

export function visualEditorPlugin({
  allowCustomJs,
  jsInjectionNonce,
  applyDomChangesCallback,
}: VisualEditorPluginOptions = {}): Plugin {
  return (gb) =>
    addAutoExperimentHandler(gb, "visual", () => ({
      isBlocked: (experiment) =>
        !allowCustomJs && experiment.variations.some((v) => v.js),
      apply: (experiment, value) =>
        applyDomChangesCallback
          ? applyDomChangesCallback(value)
          : applyDOMChanges(value, jsInjectionNonce),
    }));
}

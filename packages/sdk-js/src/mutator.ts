import mutate, { DeclarativeMutation } from "dom-mutator";
import { DOMMutator } from "./types/growthbook";

function injectStyles(css: string) {
  const s = document.createElement("style");
  s.innerHTML = css;
  document.head.appendChild(s);
  return () => s.remove();
}

export const mutator: DOMMutator = {
  apply: (changes) => {
    const revert: (() => void)[] = [];
    if (changes.css) {
      revert.push(injectStyles(changes.css));
    } else if (changes.domMutations) {
      changes.domMutations.forEach((mutation) => {
        revert.push(mutate.declarative(mutation as DeclarativeMutation).revert);
      });
    }

    return () => {
      revert.forEach((fn) => fn());
    };
  },
};

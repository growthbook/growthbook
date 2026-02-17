import JSConfetti from "js-confetti";
import { useLocalStorage } from "./useLocalStorage";

type Randomness = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** Celebration effect types for presentations (winner reveal). All use js-confetti. */
export type CelebrationType =
  | "confetti" // classic colored circles
  | "emoji" // party emojis (🎉 🏆 ✨ etc.)
  | "sparkles" // star/sparkle emojis
  | "colors" // custom color burst
  | "cash"; // money/cash emojis

export function runCelebration(
  type: CelebrationType,
  /** When provided, effect is drawn on this canvas (e.g. to contain to preview) */
  canvas?: HTMLCanvasElement | null,
): void {
  const jsConfetti = new JSConfetti(canvas ? { canvas } : undefined);

  switch (type) {
    case "confetti":
      jsConfetti.addConfetti({
        confettiRadius: 4,
        confettiNumber: 500,
      });
      break;
    case "emoji":
      jsConfetti.addConfetti({
        emojis: ["🎉", "🏆", "✨", "🎊", "⭐", "🌟"],
        emojiSize: 70,
        confettiNumber: 40,
      });
      break;
    case "sparkles":
      jsConfetti.addConfetti({
        emojis: ["✨", "⭐", "🌟", "✶", "✦"],
        emojiSize: 60,
        confettiNumber: 50,
      });
      break;
    case "colors":
      jsConfetti.addConfetti({
        confettiColors: [
          "#22c55e",
          "#16a34a",
          "#15803d",
          "#facc15",
          "#eab308",
          "#ca8a04",
        ],
        confettiRadius: 5,
        confettiNumber: 400,
      });
      break;
    case "cash":
      jsConfetti.addConfetti({
        emojis: ["💵", "💰", "💸", "💲", "💴"],
        emojiSize: 65,
        confettiNumber: 45,
      });
      break;
  }
}

export function startCelebration(
  randomness: Randomness,
  /** When provided, confetti is drawn on this canvas (e.g. to contain it to a preview area) */
  canvas?: HTMLCanvasElement | null,
) {
  const jsConfetti = new JSConfetti(canvas ? { canvas } : undefined);

  const randomNumber = Math.floor(Math.random() * (randomness - 1)) + 1;

  if (randomNumber === 1) {
    jsConfetti.addConfetti({
      confettiRadius: 4,
      confettiNumber: 500,
    });
  }
}

export function useCelebrationLocalStorage() {
  return useLocalStorage<boolean>(`enable_growthbook_celebrations`, true);
}

// randomness determines the likelihood a celebration will occur. 1 forces the celebration to fire, 5 means it'll fire 50% of the time. 10 means it'll fire 10% of the time.
export function useCelebration(randomness: Randomness = 5) {
  const [enableCelebrations] = useCelebrationLocalStorage();

  if (!enableCelebrations) {
    return () => {
      /* do nothing */
    };
  }

  return () => startCelebration(randomness);
}

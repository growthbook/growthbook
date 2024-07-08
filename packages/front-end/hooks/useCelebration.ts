import JSConfetti from "js-confetti";
import { useLocalStorage } from "./useLocalStorage";

type Randomness = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export function startCelebration(randomness: Randomness) {
  const jsConfetti = new JSConfetti();

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

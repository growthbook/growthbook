import JSConfetti from "js-confetti";

// randomness indicates how likely it is that a celebration will occur. 1 forces the celebration to fire, 5 means it'll fire 50% of the time. 10 means it'll fire 10% of the time.
export function startCelebration(
  enableCelebration: boolean,
  randomness?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
) {
  if (!enableCelebration) return;

  const jsConfetti = new JSConfetti();

  // Returns a non-zeo number between 1 and "randomness". If randomness is not provided, it defaults to 5.
  const randomNumber = Math.floor(Math.random() * (randomness || 5 - 1)) + 1;

  if (randomNumber === 1) {
    jsConfetti.addConfetti({
      confettiRadius: 4,
      confettiNumber: 500,
    });
  }
}

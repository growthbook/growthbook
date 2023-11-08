import JSConfetti from "js-confetti";

// likelihood indicates how likely it is that a celebration will occur. 1 is a 100% liklihood. 10 is a 10% likelihood.
export function startCelebration(
  enableCelebration: boolean,
  likelihood?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
) {
  if (!enableCelebration) return;

  const jsConfetti = new JSConfetti();

  // Returns a non-zeo number between 1 and the likelihood. If likelihood is not provided, it defaults to 5.
  const randomNumber = Math.floor(Math.random() * (likelihood || 5 - 1)) + 1;

  if (randomNumber === 1) {
    jsConfetti.addConfetti({
      confettiRadius: 4,
      confettiNumber: 500,
    });
  }
}

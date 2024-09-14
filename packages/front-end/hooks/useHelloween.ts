import { useLocalStorage } from "./useLocalStorage";

export function startHelloweenMode() {
  new SpiderController({
    minBugs: 1,
    maxBugs: 4,
    mouseOver: "die",
    imageSprite: "/images/helloween/spider-sprite.png",
  });
}

export function useHelloweenLocalStorage() {
  return useLocalStorage<boolean>(`enable_growthbook_celebrations`, false);
}

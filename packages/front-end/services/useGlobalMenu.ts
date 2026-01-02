import { useEffect } from "react";

export default function useGlobalMenu(
  selector: string,
  close: () => void,
): void {
  useEffect(() => {
    const callback = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Invalid target or part of the menu itself
      if (!target || !target.closest || target.closest(selector)) {
        return;
      }

      // Outside click should close the menu
      close();
    };

    document.addEventListener("click", callback);
    return () => document.removeEventListener("click", callback);
  }, []);
}

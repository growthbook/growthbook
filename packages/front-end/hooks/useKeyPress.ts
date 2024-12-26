import { useCallback, useEffect } from "react";

export const useKeyPress = (callback: () => void, key: string) => {
  const onKeyPress = useCallback(
    (e) => {
      if (e.key === key) {
        e.preventDefault();
        callback();
      }
    },
    [key, callback]
  );
  useEffect(() => {
    document.addEventListener("keydown", onKeyPress);
    return () => {
      document.removeEventListener("keydown", onKeyPress);
    };
  }, [onKeyPress]);
};

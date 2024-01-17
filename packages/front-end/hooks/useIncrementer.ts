import { useCallback, useState } from "react";

export default function useIncrementer(): [number, () => void] {
  const [count, setCount] = useState(0);
  const increment = useCallback(() => setCount((c) => c + 1), []);

  return [count, increment];
}

import { useCallback, useState } from "react";

export function useIncrementer(): [number, () => void] {
  const [count, setCount] = useState(0);
  const increment = useCallback(() => setCount((c) => c + 1), []);

  return [count, increment];
}

export function useArrayIncrementer(): [number[], (i: number) => void] {
  const [counts, setCounts] = useState<number[]>([]);
  const increment = useCallback(
    (i: number) =>
      setCounts((c) => [...c.slice(0, i), (c[i] || 0) + 1, ...c.slice(i + 1)]),
    [],
  );

  return [counts, increment];
}

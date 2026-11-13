import {
  useState,
  useEffect,
  useCallback,
  Dispatch,
  SetStateAction,
} from "react";

const getValueFromLocalStorage = (key: string, defaultValue) => {
  let value = defaultValue;
  try {
    const item = globalThis?.localStorage?.getItem(key) || null;
    if (item !== null) {
      value = JSON.parse(item) ?? value;
    }
  } catch (e) {
    console.error(e);
  }
  return value;
};

export const useLocalStorage = <T>(
  key: string,
  defaultValue: T,
  // Starts from this instead of the stored value, when given.
  initialValue: T | null = null,
): [T, Dispatch<SetStateAction<T>>] => {
  const [stored, setStored] = useState(() => ({
    key,
    value: (initialValue ?? getValueFromLocalStorage(key, defaultValue)) as T,
  }));
  // A new key reads its own stored value, rather than taking over the last
  // key's (and writing it there).
  let current = stored;
  if (stored.key !== key) {
    current = { key, value: getValueFromLocalStorage(key, defaultValue) };
    setStored(current);
  }

  const setValue: Dispatch<SetStateAction<T>> = useCallback((action) => {
    setStored((prev) => ({
      key: prev.key,
      value:
        typeof action === "function"
          ? (action as (previous: T) => T)(prev.value)
          : action,
    }));
  }, []);

  useEffect(() => {
    try {
      globalThis?.localStorage?.setItem(
        current.key,
        JSON.stringify(current.value),
      );
    } catch (e) {
      console.error(e);
    }
  }, [current.key, current.value]);

  return [current.value, setValue];
};

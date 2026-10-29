import { useState, useEffect, Dispatch, SetStateAction } from "react";

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
  const [value, setValue] = useState(() => {
    return initialValue ?? getValueFromLocalStorage(key, defaultValue);
  });

  useEffect(() => {
    try {
      globalThis?.localStorage?.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(e);
    }
  }, [key, value]);

  return [value, setValue];
};

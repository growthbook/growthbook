import { useState, useEffect, Dispatch, SetStateAction } from "react";

const getValueFromLocalStorage = (key: string, defaultValue) => {
  let value = defaultValue;
  try {
    const item = localStorage.getItem(key);
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
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] => {
  const [value, setValue] = useState(() => {
    return getValueFromLocalStorage(key, defaultValue);
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(e);
    }
  }, [key, value]);

  return [value, setValue];
};

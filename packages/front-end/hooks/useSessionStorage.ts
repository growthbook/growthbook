import { useState, useEffect, Dispatch, SetStateAction } from "react";

const getValueFromSessionStorage = (key: string, defaultValue) => {
  let value = defaultValue;
  try {
    const item = sessionStorage.getItem(key);
    if (item !== null) {
      value = JSON.parse(item) ?? value;
    }
  } catch (e) {
    console.error(e);
  }
  return value;
};

export const useSessionStorage = <T>(
  key: string,
  defaultValue: T,
): [T, Dispatch<SetStateAction<T>>] => {
  const [value, setValue] = useState(() => {
    return getValueFromSessionStorage(key, defaultValue);
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(e);
    }
  }, [key, value]);

  return [value, setValue];
};

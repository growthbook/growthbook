import { useState, useEffect } from "react";
import { Dispatch, SetStateAction } from "react";

type StorageType = "localStorage" | "sessionStorage";

const getValueFromStorage = <T>(
  storageType: StorageType,
  key: string,
  defaultValue: T
) => {
  let value = defaultValue;
  try {
    const item = window[storageType].getItem(key);
    if (item !== null) {
      value = JSON.parse(item) ?? value;
    }
  } catch (e) {
    console.error(e);
  }
  return value;
};

export const useBrowserStorage = <T>(
  storageType: StorageType,
  key: string,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] => {
  const [value, setValue] = useState(() => {
    return getValueFromStorage(storageType, key, defaultValue);
  });

  useEffect(() => {
    try {
      window[storageType].setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(e);
    }
  }, [key, value]);

  return [value, setValue];
};

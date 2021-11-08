import { useState, useEffect } from "react";
import { Dispatch, SetStateAction } from "react";

type StorageType = "localStorage" | "sessionStorage";
type Payload<T> = {
  value: T;
  expiry: number;
};

const getValueFromStorage = <T>(
  storageType: StorageType,
  key: string,
  defaultValue: T,
  ttl: number = 0
) => {
  let value = defaultValue;
  try {
    const item = window[storageType].getItem(key);
    if (item !== null) {
      const payload = <Payload<T>>JSON.parse(item);
      if (ttl > 0 && new Date().getTime() > payload.expiry) {
        window[storageType].removeItem(key);
      } else {
        value = <T>payload.value;
      }
    }
  } catch (e) {
    console.error(e);
  }
  return value;
};

const setValueFromStorage = <T>(
  storageType: StorageType,
  key: string,
  value: T,
  ttl: number = 0
) => {
  const payload: Payload<T> = {
    value,
    expiry: new Date().getTime() + ttl,
  };
  try {
    window[storageType].setItem(key, JSON.stringify(payload));
  } catch (e) {
    console.error(e);
  }
};

const useBrowserStorage = <T>(
  storageType: StorageType,
  key: string,
  defaultValue: T,
  ttl: number = 0
): [T, Dispatch<SetStateAction<T>>] => {
  const [value, setValue] = useState(() => {
    return <T>getValueFromStorage(storageType, key, defaultValue, ttl);
  });

  useEffect(() => {
    setValueFromStorage<T>(storageType, key, value, ttl);
  }, [key, value]);

  return [value, setValue];
};

export const useLocalStorage = <T>(
  key: string,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] => {
  return useBrowserStorage<T>("localStorage", key, defaultValue);
};

export const useSessionStorage = <T>(
  key: string,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] => {
  return useBrowserStorage<T>("sessionStorage", key, defaultValue);
};

export const useLocalStorageWithTTL = <T>(
  key: string,
  defaultValue: T,
  ttl: number
): [T, Dispatch<SetStateAction<T>>] => {
  return useBrowserStorage<T>("localStorage", key, defaultValue, ttl);
};

export const useSessionStorageWithTTL = <T>(
  key: string,
  defaultValue: T,
  ttl: number
): [T, Dispatch<SetStateAction<T>>] => {
  return useBrowserStorage<T>("sessionStorage", key, defaultValue, ttl);
};

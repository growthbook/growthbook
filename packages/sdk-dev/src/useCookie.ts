import { useState, useEffect } from "react";
import { Dispatch, SetStateAction } from "react";

const getCookie = <T>(key: string, defaultValue: T) => {
  let value = defaultValue;
  try {
    const item = getItem(key);
    if (item !== null) {
      value = JSON.parse(item) ?? value;
    }
  } catch (e) {
    console.error(e);
  }
  return value;
};

const getItem = (key: string): string | null => {
  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    const [k, v] = cookie.split("=");
    if (k === key) {
      return v;
    }
  }
  return null;
};

const setItem = (key: string, value: string, days: number) => {
  const date = new Date();
  date.setTime(date.getTime() + days * 60 * 60 * 24 * 1000);
  document.cookie = `${key}=${value}; expires=${date.toUTCString()}; path=/`;
};

export const useCookie = <T>(
  key: string,
  days: number,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] => {
  const [value, setValue] = useState(() => {
    return getCookie(key, defaultValue);
  });

  useEffect(() => {
    try {
      setItem(key, JSON.stringify(value), days);
    } catch (e) {
      console.error(e);
    }
  }, [key, value]);

  return [value, setValue];
};

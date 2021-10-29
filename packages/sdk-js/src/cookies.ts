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

const getCookies = (prefix: string): { [key: string]: string } => {
  prefix += "_";
  const items: { [key: string]: string } = {};
  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    const [k, v] = cookie.split("=");
    if (k.indexOf(prefix) === 0 && k.length > prefix.length) {
      items[k.slice(prefix.length)] = JSON.parse(v);
    }
  }
  return items;
};

const setCookie = (key: string, value: string, days: number) => {
  const date = new Date();
  date.setTime(date.getTime() + days * 60 * 60 * 24 * 1000);
  document.cookie = `${key}=${value}; expires=${date.toUTCString()}; path=/`;
};

export { setCookie, getCookie, getCookies };

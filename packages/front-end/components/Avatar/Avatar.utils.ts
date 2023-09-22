import md5 from "md5";

export const gravatarForEmail = (
  email: string = "",
  size: number = 100
): string => {
  const hash = md5(email?.trim()?.toLowerCase() || "");
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=${size}`;
};

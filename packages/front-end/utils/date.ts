// Copy a Date's UTC date and time into local fields and back, so a picker that only shows local time can show UTC.
export function utcAsLocal(date: Date): Date {
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
}

export function localAsUtc(picked: Date): Date {
  return new Date(
    Date.UTC(
      picked.getFullYear(),
      picked.getMonth(),
      picked.getDate(),
      picked.getHours(),
      picked.getMinutes(),
      picked.getSeconds(),
      picked.getMilliseconds(),
    ),
  );
}

export const formatDateForURL = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-indexed
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

// Helper function to parse date strings from URL as local time instead of UTC
export const parseDateFromURL = (dateString: string): Date => {
  const [year, month, day] = dateString.split("-").map(Number);
  // Create date in local timezone (month is 0-indexed in Date constructor)
  return new Date(year, month - 1, day);
};

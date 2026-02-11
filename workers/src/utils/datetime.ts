const jstDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const pad = (v: number): string => String(v).padStart(2, "0");

export const getJstDateString = (date: Date): string => jstDateFormatter.format(date);

export const getJstMinuteString = (date: Date): string => {
  const jst = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  return `${getJstDateString(date)} ${pad(jst.getHours())}:${pad(jst.getMinutes())}`;
};

export const getJstDayRange = (date: Date): { start: string; end: string } => {
  const d = getJstDateString(date);
  return {
    start: `${d}T00:00:00+09:00`,
    end: `${d}T23:59:59+09:00`,
  };
};

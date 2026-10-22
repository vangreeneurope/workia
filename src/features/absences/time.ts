/** "09:30" -> 570; "24:00" se admite como fin de día (1440). null si no es válida. */
export function parseClockToMinute(value: string): number | null {
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute <= 1440 ? minute : null;
}

export function minuteToClock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

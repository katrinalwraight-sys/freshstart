import * as Calendar from "expo-calendar/legacy";
import { Platform } from "react-native";

export const calendarSupported = Platform.OS !== "web";

export const getCalendarPermission = () => Calendar.getCalendarPermissionsAsync();
export const requestCalendarPermission = () => Calendar.requestCalendarPermissionsAsync();

const hm = (d: Date) => `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;

// Read-only: returns busy blocks per date from every calendar on the phone (Apple, Google, etc.).
export async function busyTimes(dates: string[]): Promise<Record<string, string[]>> {
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  if (!cals.length) return {};
  const events = await Calendar.getEventsAsync(
    cals.map((c) => c.id),
    new Date(dates[0] + "T00:00:00"),
    new Date(dates[dates.length - 1] + "T23:59:59"),
  );
  const out: Record<string, string[]> = {};
  dates.forEach((d) => (out[d] = []));
  events.forEach((e) => {
    const s = new Date(e.startDate);
    const key = `${s.getFullYear()}-${`${s.getMonth() + 1}`.padStart(2, "0")}-${`${s.getDate()}`.padStart(2, "0")}`;
    if (!out[key]) return;
    out[key].push(e.allDay ? `All day: ${e.title}` : `${hm(s)}-${hm(new Date(e.endDate))} ${e.title}`);
  });
  return out;
}

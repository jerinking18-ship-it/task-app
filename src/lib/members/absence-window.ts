import { accountClock } from "@/lib/tasks/model";
import { date } from "@/lib/tasks/validation";

const MEETING_DAYS: Record<string, number> = {
  "Sunday Service": 0, "Healing Meeting": 3, "Revival Meeting": 5,
};

// Attendance changes close at exactly 9 PM; absence expiry remains independent.
export function absenceChangeWindow(category: string, now: Date, meetingDate: string | null = null) {
  const unavailable = { open: false, startsAt: null, closesAt: null, message: "Attendance changes are unavailable." };
  if (!Number.isFinite(now.getTime())) return unavailable;
  const today = accountClock(now, "Asia/Kolkata").date;
  let day: string;
  if (category === "Special Meeting") {
    if (!date(meetingDate)) return { ...unavailable, message: "Choose a valid meeting date." };
    day = meetingDate!;
  } else {
    if (!Object.prototype.hasOwnProperty.call(MEETING_DAYS, category)) return unavailable;
    const value = new Date(`${today}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() - (value.getUTCDay() - MEETING_DAYS[category] + 7) % 7);
    day = value.toISOString().slice(0, 10);
  }
  const startsAt = Date.parse(`${day}T00:00:00+05:30`);
  const closesAt = Date.parse(`${day}T21:00:00+05:30`);
  const open = now.getTime() >= startsAt && now.getTime() < closesAt;
  return { open, startsAt, closesAt, message: open ? "" : now.getTime() < startsAt
    ? "Attendance changes open at 12:00 AM on the selected meeting date, India time."
    : "Attendance changes closed at 9:00 PM India time." };
}

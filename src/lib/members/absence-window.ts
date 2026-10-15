import { accountClock, type SundayService } from "@/lib/tasks/model";
import { date } from "@/lib/tasks/validation";

const MEETING_DAYS: Record<string, number> = {
  "Sunday Service": 0, "Healing Meeting": 3, "Revival Meeting": 5,
};

// Only attendance actions use these hours; meeting expiry and fines stay independent.
export function absenceChangeWindow(category: string, now: Date, meetingDate: string | null = null, sundayService: SundayService | null = null) {
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
  const morning=category==="Sunday Service"&&sundayService==="morning";
  const evening=category==="Sunday Service"&&sundayService==="evening";
  const startsAt = Date.parse(`${day}T${evening?"13":"00"}:00:00+05:30`);
  const closesAt = Date.parse(`${day}T${morning?"11":"21"}:00:00+05:30`);
  const open = now.getTime() >= startsAt && now.getTime() < closesAt;
  return { open, startsAt, closesAt, message: open ? "" : now.getTime() < startsAt
    ? `Attendance changes open at ${evening?"1:00 PM":"12:00 AM"} on the selected meeting date, India time.`
    : `Attendance changes closed at ${morning?"11:00 AM":"9:00 PM"} India time.` };
}

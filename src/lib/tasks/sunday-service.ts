import {accountClock,type SundayService,type Task} from "./model";
export function currentSundayService(now:Date):SundayService|null {
  const clock=accountClock(now,"Asia/Kolkata"),day=new Date(`${clock.date}T12:00:00Z`).getUTCDay();
  return day===0?(clock.time<"16:00:00"?"morning":"evening"):day===1?"evening":null;
}
export function sundayServiceOrder(now:Date):SundayService[] {
  return currentSundayService(now)==="evening"?["evening","morning"]:["morning","evening"];
}
export function taskSundayService(task:Task):SundayService|null {
  return task.category==="Sunday Service"?(task.sundayService??"evening"):null;
}

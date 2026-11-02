import {accountClock,type SundayService,type Task} from "./model";
import {currentSundayService} from "./sunday-service";

export const SUNDAY_SERVICES:SundayService[]=["morning","evening"];
export function sundaySelectionPeriod(now:Date):string {
 if(!Number.isFinite(now.getTime()))return "";
 const day=new Date(`${accountClock(now,"Asia/Kolkata").date}T12:00:00Z`);
 day.setUTCDate(day.getUTCDate()-day.getUTCDay());
 return day.toISOString().slice(0,10);
}
export function selectedSundayService(now:Date,services:SundayService[],manual:SundayService|null):SundayService {
 if(manual&&services.includes(manual))return manual;
 const automatic=currentSundayService(now);
 return automatic&&services.includes(automatic)?automatic:services[0]??"morning";
}
export function sundayServiceTasks(tasks:Task[],service:SundayService):Task[] {
 return tasks.filter(task=>task.category!=="Sunday Service"||(task.sundayService??"evening")===service);
}

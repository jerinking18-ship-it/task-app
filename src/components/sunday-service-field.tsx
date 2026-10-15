import type {SundayService} from "@/lib/tasks/model";
import {SundayServiceIcon} from "./sunday-service-label";
import styles from "./task-app.module.css";
export default function SundayServiceField({value,onChange,label="Subcategory"}:{value:SundayService;onChange:(value:SundayService)=>void;label?:string}) {
  return <label className={styles.property}><span><SundayServiceIcon value={value}/>{label}</span><select aria-label={label} value={value} onChange={event=>onChange(event.target.value as SundayService)}><option value="morning">Morning Service</option><option value="evening">Evening Service</option></select></label>;
}

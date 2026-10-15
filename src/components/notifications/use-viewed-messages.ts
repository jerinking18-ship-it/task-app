"use client";
import{useEffect,useRef}from'react';
// Foreground, focused, mostly visible for one second. Never mark an entire
// inbox read just because its page opened, or while a dialog obscures it.
export function useViewedMessages(root:React.RefObject<HTMLElement|null>,unreadIds:string[],enabled:boolean,onRead:(ids:string[])=>Promise<void>,onFailure:(message:string)=>void,generation:string|number){
 const latest=useRef({onRead,onFailure});latest.current={onRead,onFailure};
 const key=unreadIds.join(',');
 useEffect(()=>{
  if(!enabled||!root.current||!key)return;
  const allowed=new Set(key.split(',')),visible=new Map<Element,number>(),attempted=new Set<string>();let writing=false,alive=true;
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting&&entry.intersectionRatio>=.6)visible.set(entry.target,Date.now());else visible.delete(entry.target);}},{threshold:[0,.6,1]});
  for(const el of root.current.querySelectorAll('[data-notification-ids]'))observer.observe(el);
  const timer=window.setInterval(()=>{
   if(document.visibilityState!=='visible'||!document.hasFocus()){for(const el of visible.keys())visible.set(el,Date.now());return;}
   if(writing)return;
   const ids=new Set<string>();for(const [el,since]of visible){if(Date.now()-since<1000)continue;for(const id of(el.getAttribute('data-notification-ids')??'').split(','))if(allowed.has(id)&&!attempted.has(id))ids.add(id);}
   const batch=[...ids].slice(0,100);if(!batch.length)return;for(const id of batch)attempted.add(id);writing=true;
   void latest.current.onRead(batch).catch(reason=>{if(alive)latest.current.onFailure(reason instanceof Error?reason.message:'Read status could not be saved. Refresh to try again.');}).finally(()=>{writing=false;});
  },250);
  return()=>{alive=false;observer.disconnect();window.clearInterval(timer);};
 },[enabled,key,generation,root]);
}

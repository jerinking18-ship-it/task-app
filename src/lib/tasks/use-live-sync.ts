"use client";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { decodeMemberResponse, type MemberState } from "@/lib/members/model";
import { PRESENCE_HEARTBEAT_MS, SYNC_FALLBACK_MS } from "@/lib/members/presence";
type Scope="tasks"|"members";
type Options={enabled:boolean;accountId?:string;blocked:boolean;onTasks:()=>void;onMembers:()=>void;onPresence:(state:MemberState)=>void;onExpired:()=>void};
export function useLiveSync(options:Options) {
  const latest=useRef(options);latest.current=options;
  const controls=useRef({deactivate:()=>{},flush:()=>{}});
  useEffect(()=>{
    if(!options.enabled)return;
    let alive=true,sequence=0,timer:ReturnType<typeof setTimeout>|undefined,activeRequest=false,lastSent:boolean|undefined;
    let presence:MemberState|null=null;const queued=new Set<Scope>();const tabId=crypto.randomUUID();
    const visible=()=>document.visibilityState==="visible"&&navigator.onLine;
    const using=()=>visible()&&document.hasFocus();
    function flush(){
      timer=undefined;if(!alive||!visible())return;
      if(presence){latest.current.onPresence(presence);presence=null;}
      if(latest.current.blocked)return;
      if(queued.delete("tasks"))latest.current.onTasks();
      if(queued.delete("members"))latest.current.onMembers();
    }
    function schedule(scope:Scope){queued.add(scope);if(!timer)timer=setTimeout(flush,250);}
    async function heartbeat(active:boolean,force=false){
      if(!alive||(!force&&activeRequest)||(!navigator.onLine&&active))return;
      const stamp=++sequence;lastSent=active;if(active)activeRequest=true;
      try {
        const response=await fetch("/api/presence",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tabId,active,sequence:stamp}),keepalive:!active,signal:AbortSignal.timeout(10000)});
        if(response.status===401){if(alive)latest.current.onExpired();return;}
        if(!response.ok)return;
        const next=decodeMemberResponse(await response.json());
        if(alive){presence=next;if(!timer)timer=setTimeout(flush,0);}
      }catch{/* The lease expires if this device loses its connection. */}
      finally{if(active)activeRequest=false;}
    }
    function returned(){
      const active=using();if(active!==lastSent)void heartbeat(active,true);
      if(visible()){schedule("tasks");schedule("members");}
    }
    function leaving(){void heartbeat(false,true);}
    const heartbeatTimer=setInterval(()=>{if(using())void heartbeat(true);},PRESENCE_HEARTBEAT_MS);
    const fallbackTimer=setInterval(()=>{if(visible()){schedule("tasks");schedule("members");}},SYNC_FALLBACK_MS);
    document.addEventListener("visibilitychange",returned);window.addEventListener("focus",returned);window.addEventListener("blur",returned);
    window.addEventListener("online",returned);window.addEventListener("offline",returned);window.addEventListener("pagehide",leaving);
    controls.current={deactivate:leaving,flush:()=>{if(!timer)timer=setTimeout(flush,0);}};
    void heartbeat(using(),true);
    let client:ReturnType<typeof createClient>|undefined;let channel:ReturnType<ReturnType<typeof createClient>["channel"]>|undefined;
    if(options.accountId){
      try {
        client=createClient();const connected=client;
        void connected.realtime.setAuth().then(()=>{
          if(!alive)return;
          channel=connected.channel(`task-account:${options.accountId}`,{config:{private:true}})
            .on("broadcast",{event:"changed"},({payload})=>{if(payload?.scope==="tasks"||payload?.scope==="members")schedule(payload.scope);})
            .subscribe(status=>{if(status==="SUBSCRIBED"){schedule("tasks");schedule("members");}});
        }).catch(()=>{/* The automatic fallback remains available. */});
      }catch{/* Missing configuration must not break the existing task UI. */}
    }
    return ()=>{
      leaving();alive=false;clearInterval(heartbeatTimer);clearInterval(fallbackTimer);if(timer)clearTimeout(timer);
      document.removeEventListener("visibilitychange",returned);window.removeEventListener("focus",returned);window.removeEventListener("blur",returned);
      window.removeEventListener("online",returned);window.removeEventListener("offline",returned);window.removeEventListener("pagehide",leaving);
      if(client&&channel)void client.removeChannel(channel);controls.current={deactivate:()=>{},flush:()=>{}};
    };
  },[options.enabled,options.accountId]);
  useEffect(()=>{if(!options.blocked)controls.current.flush();},[options.blocked]);
  return {deactivate:()=>controls.current.deactivate()};
}

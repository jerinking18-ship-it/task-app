"use client";
import CapitalizedInput from "../capitalized-input";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { decodeMemberResponse, memberName, type MemberState } from "@/lib/members/model";
import { requestWorkspace } from "@/lib/workspace/client";
import AccountControls from "@/components/auth/account-controls";
import auth from "@/components/auth/auth.module.css";
import styles from "./members.module.css";
const INVITATION_KEY="task-workspace-invitation";
export default function MemberForm({initialState,signedIn=true}:{initialState:MemberState|null;signedIn?:boolean}){
 const [token,setToken]=useState("");const [name,setName]=useState("");const [pending,setPending]=useState(false);const [error,setError]=useState("");const busy=useRef(false);
 useEffect(()=>{
  try{
   const hash=window.location.hash.slice(1);
   if(/^[a-f0-9]{64}$/.test(hash)){sessionStorage.setItem(INVITATION_KEY,hash);history.replaceState(null,"",window.location.pathname);}
   const saved=sessionStorage.getItem(INVITATION_KEY)??"";if(/^[a-f0-9]{64}$/.test(saved))setToken(saved);
  }catch{setError("Allow session storage in this browser, then reopen your invitation link.");}
 },[]);
 async function submit(event:FormEvent){
  event.preventDefault();if(busy.current||!signedIn)return;
  const clean=memberName(name);if(!clean){setError("Enter your own name, between 1 and 50 characters.");return;}
  busy.current=true;setPending(true);setError("");
  try{const result=decodeMemberResponse(await requestWorkspace({action:"accept",token,name:clean}));if(!result.current||!result.workspace)throw new Error("Membership could not be confirmed. Refresh before retrying.");sessionStorage.removeItem(INVITATION_KEY);window.location.assign("/account");}
  catch(reason){setError(reason instanceof Error?reason.message:"We couldn’t confirm joining. Try again.");}
  finally{busy.current=false;setPending(false);}
 }
 return <div className={styles.memberStep}>
  {signedIn&&<p className={styles.verified}><span aria-hidden="true">✓</span> Personal account signed in</p>}
  {error&&<p className={auth.error} role="alert">{error}</p>}
  {initialState?.current&&initialState.workspace?<Link className={auth.primary} href="/account">Open workspace</Link>:token?<>
   <p className={styles.capacity}>An invitation reserves your place for seven days. Sign in with the same verified email the Owner invited.</p>
   {signedIn?<form onSubmit={submit} aria-busy={pending}><label className={auth.field}><span>Your name</span><CapitalizedInput autoComplete="name" maxLength={50} required value={name} disabled={pending} onValueChange={setName} placeholder="Enter your own name"/></label><button className={auth.primary} disabled={pending}>{pending?"Joining…":"Accept invitation"}</button></form>:<><Link className={auth.primary} href="/sign-in">Sign in</Link><p className={styles.modeSwitch}>New here? <Link href="/sign-up">Create your account</Link></p></>}
  </>:<p className={styles.capacity}>You haven’t joined a workspace yet. Ask the Owner for your invitation link, then open it in this browser. Signing up alone does not grant workspace access.</p>}
  {signedIn&&<div className={styles.stepSignOut}><AccountControls blocked={pending}/></div>}
 </div>;
}

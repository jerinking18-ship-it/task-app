import type { Metadata } from "next";
import AuthShell from "@/components/auth/auth-shell";
import MemberForm from "@/components/members/member-form";
import { createClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/flow";
export const metadata:Metadata={title:"Workspace invitation · BGM Task App",robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function InvitationPage(){
 let signedIn=false;try{const client=await createClient();signedIn=!!await verifiedIdentity(client.auth);}catch{/* Show sign-in choice. */}
 return <AuthShell eyebrow="PRAISE THE LORD" title="You’re invited" description="Join your team’s shared workspace with your personal account."><MemberForm initialState={null} signedIn={signedIn}/></AuthShell>;
}

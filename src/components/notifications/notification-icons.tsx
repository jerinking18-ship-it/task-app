import type {ReactNode}from'react';
export type NoticeIcon='people'|'shield'|'clock'|'rupee'|'warning'|'check'|'request'|'settings'|'trash'|'back'|'close'|'mail'|'lock';
export function NoticeIcon({name,size=20}:{name:NoticeIcon;size?:number}){
 const paths:Record<NoticeIcon,ReactNode>={
 people:<><circle cx="8" cy="7" r="3"/><path d="M2 21v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M17 13l4 4-4 4M15 17h6"/></>,
 shield:<><path d="m12 3 9 4v5c0 5-6 8-9 10-3-2-9-5-9-10V7l9-4Z"/><path d="m8 12 3 3 5-6"/></>,
 clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
 rupee:<><circle cx="12" cy="12" r="10"/><path d="M8 6h8M8 9h8M10 6c7 0 7 7-2 7l7 6"/></>,
 warning:<><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/></>,
 check:<><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></>,
 request:<><path d="M3 5v5h5M3 10a9 9 0 1 1 1 8"/><path d="M12 7v5l3 2"/></>,
 settings:<><path d="m9 3-.5 3-2 1.2-2.8-.9L1.8 10l2.3 2-.1 2.3L2 16.2l2 3.5 3-.8L9 20l.8 3h4.4l.8-3 2-1.1 3 .8 2-3.5-2-1.9-.1-2.3 2.3-2-1.9-3.7-2.8.9-2-1.2L15 3Z"/><circle cx="12" cy="13" r="3"/></>,
 trash:<><path d="M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
 back:<path d="M20 12H4m7-7-7 7 7 7"/>,close:<path d="m6 6 12 12M6 18 18 6"/>,
 mail:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></>,
 lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>};
 return <svg width={size}height={size}viewBox="0 0 24 24"fill="none"stroke="currentColor"strokeWidth="1.65"strokeLinecap="round"strokeLinejoin="round"aria-hidden="true">{paths[name]}</svg>;
}

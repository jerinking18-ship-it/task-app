import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
function load(file,deps={},globals={}){const exports={};const{outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,...globals,require(name){if(name in deps)return deps[name];throw Error(name);}});return exports;}
const model=load('../src/lib/tasks/model.ts'),period=load('../src/lib/tasks/meeting-period.ts',{'./model':model});
const validation=load('../src/lib/tasks/validation.ts',{'./model':model});
const special=load('../src/lib/special-meetings/model.ts',{'@/lib/tasks/model':model,'@/lib/tasks/validation':validation});
const{completedMeeting}=load('../src/lib/tasks/meeting-celebration.ts',{'./model':model,'./meeting-period':period,'@/lib/special-meetings/model':special});
const member='member',other='other',now=new Date('2026-11-04T19:30:00+05:30');
const task=(id,patch={})=>({...model.blankTask(),id,title:id,category:'Healing Meeting',assignedToId:member,date:'2026-11-04',createdAt:'2026-11-01T00:00:00Z',...patch});
const done=t=>({...t,completed:true,completedById:member,completedAt:now.toISOString()});
test('only an authoritative own active-to-completed transition can celebrate a nonempty finished meeting',()=>{
 const a=done(task('a')),b=task('b'),before=[a,b],confirmed=done(b),original=JSON.stringify(before);
 const event=completedMeeting(before,confirmed,member,now);assert.equal(event.meeting,'Healing Meeting');assert.equal(event.total,2);assert.match(event.key,/Healing Meeting/);assert.equal(JSON.stringify(before),original);
 for(const[rows,row,id]of [[[],confirmed,member],[[a,done(b)],confirmed,member],[before,b,member],[before,confirmed,undefined],[before,{...confirmed,completedById:other},member],[before,{...confirmed,assignedToId:other},member],[before,{...confirmed,date:'2026-11-05'},member]])assert.equal(completedMeeting(rows,row,id,now),null);
});
test('a remaining task in any priority or status filter blocks celebration; other members and future/old/history work do not',()=>{
 const b=task('b'),hidden=task('hidden',{priority:'High'});assert.equal(completedMeeting([b,hidden],done(b),member,now),null);
 const rows=[b,task('other',{assignedToId:other}),task('future',{date:'2026-11-11'}),task('old',{date:'2026-10-28'}),task('history',{completed:true,repeat:'Weekly',historyAt:'2026-11-04T01:00:00Z'}),task('deferred',{availableAt:'2026-11-05T00:00:00Z'})];
 assert.equal(completedMeeting(rows,done(b),member,now).total,1);
 const expired=task('expired',{date:'',completed:true,completedAt:'2026-10-28T10:00:00Z',missedCompletionRole:'coordinator'});assert.equal(completedMeeting([b,expired],done(b),member,now).total,1);
});
test('Sunday Morning and Evening form one celebration for that Sunday occurrence',()=>{
 const n=new Date('2026-11-08T20:00:00+05:30'),morning=task('morning',{category:'Sunday Service',date:'2026-11-08',sundayService:'morning'}),evening=task('evening',{category:'Sunday Service',date:'2026-11-08',sundayService:'evening'});
 assert.equal(completedMeeting([morning,evening],done(morning),member,n),null);
 const first=completedMeeting([done(morning),evening],done(evening),member,n);assert.equal(first.total,2);assert.equal(first.meeting,'Sunday Service');
 assert.equal(completedMeeting([done(morning),evening],done(evening),member,new Date('2026-11-09T23:59:59.999+05:30')).key,first.key);
 assert.equal(completedMeeting([done(morning),evening],done(evening),member,new Date('2026-11-10T00:00:00+05:30')),null);
});
test('Missed completion, reopening and already-finished loads never produce a celebration',()=>{
 const b=task('b');assert.equal(completedMeeting([b],{...done(b),missedCompletionRole:'coordinator'},member,now),null);
 assert.equal(completedMeeting([done(task('missed',{missedCompletionRole:'owner'})),b],done(b),member,now),null);
 assert.equal(completedMeeting([done(b)],b,member,now),null);
 assert.equal(completedMeeting([done(b)],done(b),member,now),null);
});
test('meeting boundaries and undated tasks use India time without celebrating on unrelated meeting days',()=>{
 const b=task('b'),undated=task('undated',{date:''});assert.equal(completedMeeting([b,undated],done(b),member,now),null);
 for(const n of ['2026-11-03T23:59:59+05:30','2026-11-06T00:00:00+05:30'])assert.equal(completedMeeting([b],done(b),member,new Date(n)),null);
 assert.equal(completedMeeting([b],done(b),member,new Date('2026-11-05T23:59:59.999+05:30')).total,1);
});
test('Special Meeting uses its shared name and a distinct daily key, and locks/replacement rules still apply',()=>{
 const event={id:'event',startDate:'2026-11-04',days:3,locked:false,version:'v',startsAt:'2026-11-04T00:00:00+05:30',endsAt:'2026-11-07T00:00:00+05:30'};
 const b=task('special',{category:'Special Meeting',specialMeeting:event,specialEnabled:true}),c=task('tomorrow',{category:'Special Meeting',specialMeeting:event,specialEnabled:true,date:'2026-11-05'});
 const result=completedMeeting([b,c],done(b),member,now,[event],'Youth Meeting');assert.equal(result.meeting,'Youth Meeting');assert.equal(result.total,1);
 const tomorrow=completedMeeting([done(b),c],done(c),member,new Date('2026-11-05T20:00:00+05:30'),[event],'Youth Meeting');assert.notEqual(result.key,tomorrow.key);
 assert.equal(completedMeeting([b],done(b),member,now,[{...event,locked:true}]),null);
 assert.equal(completedMeeting([task('regular')],done(task('regular')),member,now,[event]),null);
 assert.equal(completedMeeting([b],done(b),member,new Date(event.endsAt),[event]),null);
});
function motionFixture(reduce=false,defer=false){
 const animations=[],pieces=[],timers=new Map(),listeners=new Map(),frames=new Map(),effects=[];let timerId=0,closed=0;
 const animate=(frames,options)=>{const a={frames,options,cancelled:false,onfinish:null,cancel(){this.cancelled=true;}};animations.push(a);return a;};
 const rect=()=>({left:100,top:100,width:76,height:76});const element={animate,getBoundingClientRect:rect};
 const particles={appendChild:p=>pieces.push(p),replaceChildren:()=>pieces.splice(0)};
 const root={...element,querySelector:selector=>selector==='[data-confetti]'?particles:element,querySelectorAll:()=>[element,element,element]};
 const media={matches:reduce,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const window={requestAnimationFrame:fn=>{frames.set(1,fn);return 1;},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>media,setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)};
 const document={createElement:()=>({style:{},animate,remove(){}})};
 const motion=load('../src/components/meeting-complete-celebration.tsx',{'react':{useRef:()=>({current:root}),useEffect:fn=>effects.push(fn)},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'./meeting-complete-celebration.module.css':{default:{particle:'particle'}}},{window,document});
 let cleanup;
 if(defer){motion.default({celebration:{key:"meeting",meeting:"Healing Meeting",total:1},onClose:()=>closed++});cleanup=effects[0]();}
 else cleanup=motion.animateMeetingCompletion(root,()=>closed++);
 return{animations,pieces,timers,listeners,media,cleanup,frames,closed:()=>closed};
}
test('confetti is bounded; auto-dismiss and cleanup stop every animation, timer and media listener',()=>{
 const f=motionFixture();assert.equal(f.pieces.length,54);assert.equal(f.timers.size,1);const timer=[...f.timers.values()][0];assert.equal(timer.delay,4600);timer.fn();
 const fade=f.animations.at(-1);assert.equal(fade.options.duration,250);fade.onfinish();assert.equal(f.closed(),1);
 f.cleanup();assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);assert.equal(f.pieces.length,0);assert.ok(f.animations.every(a=>a.cancelled));fade.onfinish();assert.equal(f.closed(),1);
});
test('reduced motion has no particles or animated transitions, and toggling it cancels motion immediately',()=>{
 const f=motionFixture(true);assert.equal(f.animations.length,0);assert.equal(f.pieces.length,0);[...f.timers.values()][0].fn();assert.equal(f.closed(),1);f.cleanup();
 const g=motionFixture();g.media.matches=true;g.listeners.get('change')();assert.equal(g.pieces.length,0);assert.ok(g.animations.every(a=>a.cancelled));g.cleanup();
});

test('component waits until the parent dialog is visible before measuring and starting motion',()=>{
 const f=motionFixture(false,true);assert.equal(f.pieces.length,0);assert.equal(f.animations.length,0);assert.equal(f.frames.size,1);f.frames.get(1)();assert.equal(f.pieces.length,54);assert.equal(f.pieces[0].style.left,'138px');assert.equal(f.pieces[0].style.top,'138px');f.cleanup();assert.equal(f.frames.size,0);assert.ok(f.animations.every(a=>a.cancelled));
 const early=motionFixture(false,true);early.cleanup();assert.equal(early.frames.size,0);assert.equal(early.animations.length,0);
});

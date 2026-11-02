import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url),React=require('react'),jsx=require('react/jsx-runtime');
function load(file,deps={},globals={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,...globals,require(name){if(name in deps)return deps[name];throw Error(name);}});return exports;}
const model=load('../src/lib/tasks/model.ts'),service=load('../src/lib/tasks/sunday-service.ts',{'./model':model});
const selection=load('../src/lib/tasks/sunday-selection.ts',{'./model':model,'./sunday-service':service});
const at=s=>new Date(s+'+05:30');

test('service defaults use India 4 PM boundary, keep Monday Evening, and respect available services',()=>{
 for(const stamp of ['2026-11-08T00:00:00','2026-11-08T15:59:59'])assert.equal(selection.selectedSundayService(at(stamp),['morning','evening'],null),'morning');
 for(const stamp of ['2026-11-08T16:00:00','2026-11-09T00:00:00','2026-11-09T23:59:59'])assert.equal(selection.selectedSundayService(at(stamp),['morning','evening'],null),'evening');
 assert.equal(selection.selectedSundayService(at('2026-11-08T10:00:00'),['evening'],null),'evening');
 assert.equal(selection.selectedSundayService(at('2026-11-08T20:00:00'),['morning'],null),'morning');
 assert.equal(selection.selectedSundayService(at('2026-11-08T20:00:00'),['morning','evening'],'morning'),'morning');
 assert.equal(selection.sundaySelectionPeriod(at('2026-11-09T23:59:59')),'2026-11-08');
 assert.equal(selection.sundaySelectionPeriod(at('2026-11-15T00:00:00')),'2026-11-15');
});

function hookFixture({broken=false}={}){
 const stored=new Map(),states=[],effects=[],dependencies=[];let cursor=0;
 const fakeReact={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useEffect(effect,deps){const i=cursor++;if(!dependencies[i]||deps.some((value,index)=>value!==dependencies[i][index])){dependencies[i]=deps;effects.push(effect);}}};
 const hook=load('../src/lib/tasks/use-sunday-selection.ts',{'react':fakeReact,'./sunday-selection':selection},{window:{sessionStorage:{getItem(key){if(broken)throw Error('Storage blocked');return stored.get(key)??null;},setItem(key,value){if(broken)throw Error('Storage blocked');stored.set(key,value);}}}}).useSundaySelection;
 return {stored,render(now,scope='assigned',services=['morning','evening']){cursor=0;const result=hook(now,scope,services);while(effects.length)effects.shift()();return result;}};
}
test('manual selections survive page remounts, stay per page and reset next Sunday',()=>{
 const f=hookFixture(),morning=at('2026-11-08T10:00:00'),evening=at('2026-11-08T20:00:00');
 assert.equal(f.render(morning).service,'morning');f.render(morning).selectService('evening');assert.equal(f.render(morning).service,'evening');
 assert.equal(f.render(evening,'overview').service,'evening');assert.equal(f.render(morning,'overview').service,'morning');
 f.render(morning,'assigned');assert.equal(f.render(morning,'assigned').service,'evening');
 const reloaded=hookFixture();for(const entry of f.stored)reloaded.stored.set(...entry);reloaded.render(morning);assert.equal(reloaded.render(morning).service,'evening');
 const next=at('2026-11-15T10:00:00');assert.equal(f.render(next).service,'morning');assert.equal(f.render(next).service,'morning');
 for(const value of f.stored.values()){const data=JSON.parse(value);assert.deepEqual(Object.keys(data).sort(),['period','service']);}
});
test('automatic selection changes at 4 PM without manual choice; storage errors and corrupt values fail safely',()=>{
 const f=hookFixture(),before=at('2026-11-08T15:59:59'),after=at('2026-11-08T16:00:00');assert.equal(f.render(before).service,'morning');assert.equal(f.render(after).service,'evening');
 for(const raw of ['invalid','{"period":"2026-11-08","service":"all"}','{"period":"2026-11-01","service":"evening"}']){const bad=hookFixture();bad.stored.set('bgm-sunday-selection:assigned',raw);bad.render(before);assert.equal(bad.render(before).service,'morning');}
 const broken=hookFixture({broken:true});assert.equal(broken.render(before).service,'morning');broken.render(before).selectService('evening');assert.equal(broken.render(before).service,'evening');broken.render(before).selectService('all');assert.equal(broken.render(before).service,'evening');
});
test('service filtering preserves other categories, legacy Evening assignments and source records',()=>{
 const rows=[{...model.blankTask(),id:'morning',category:'Sunday Service',sundayService:'morning'},{...model.blankTask(),id:'evening',category:'Sunday Service',sundayService:'evening'},{...model.blankTask(),id:'legacy',category:'Sunday Service',sundayService:null},{...model.blankTask(),id:'healing',category:'Healing Meeting'}],original=JSON.stringify(rows);
 assert.deepEqual(Array.from(selection.sundayServiceTasks(rows,'morning'),t=>t.id),['morning','healing']);assert.deepEqual(Array.from(selection.sundayServiceTasks(rows,'evening'),t=>t.id),['evening','legacy','healing']);assert.equal(JSON.stringify(rows),original);
});
test('the shared selector is accessible, cannot submit attendance forms and uses actual supplied counts',()=>{
 const Selector=load('../src/components/sunday-service-selector.tsx',{'react/jsx-runtime':jsx,'@/lib/tasks/sunday-selection':selection,'./sunday-service-selector.module.css':{default:{}}}).default;
 const html=require('react-dom/server').renderToStaticMarkup(React.createElement(Selector,{value:'evening',onChange(){},counts:{morning:0,evening:7},disabled:true}));
 assert.equal((html.match(/type="button"/g)??[]).length,2);assert.equal((html.match(/aria-pressed="true"/g)??[]).length,1);assert.equal((html.match(/disabled=""/g)??[]).length,2);assert.match(html,/>0<\/span>/);assert.match(html,/>7<\/span>/);
 const chosen=[];const element=Selector({value:'morning',onChange:value=>chosen.push(value)});element.props.children[1].props.onClick();assert.deepEqual(chosen,['evening']);
});

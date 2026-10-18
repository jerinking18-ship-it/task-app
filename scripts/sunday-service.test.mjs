import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={},globals={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,...globals,require(name){if(name in deps)return deps[name];throw Error(name);}});return exports;}
const model=load('../src/lib/tasks/model.ts'),service=load('../src/lib/tasks/sunday-service.ts',{'./model':model}),validation=load('../src/lib/tasks/validation.ts',{'./model':model});
const at=value=>new Date(value+'+05:30'),id='00000000-0000-4000-8000-000000000001';
test('Sunday ordering changes exactly at4PM and remains Evening throughout Monday',()=>{
 for(const value of ['2026-10-18T00:00:00','2026-10-18T15:59:59'])assert.equal(service.currentSundayService(at(value)),'morning');
 for(const value of ['2026-10-18T16:00:00','2026-10-18T23:59:59','2026-10-19T00:00:00','2026-10-19T23:59:59'])assert.equal(service.currentSundayService(at(value)),'evening');
 for(const value of ['2026-10-20T00:00:00','2026-10-21T12:00:00'])assert.equal(service.currentSundayService(at(value)),null);
 assert.deepEqual([...service.sundayServiceOrder(at('2026-10-18T15:59:59'))],['morning','evening']);assert.deepEqual([...service.sundayServiceOrder(at('2026-10-18T16:00:00'))],['evening','morning']);
});
test('Sunday mapping preserves selected service and legacy defaults without leaking into other meetings',()=>{
 const fields={title:'Sound',notes:null,status:'active',due_date:null,due_time:null,priority:'medium',category_id:id,weekdays:[],repeat_rule:'off',assigned_to_member_id:id};
 const row={...fields,id,created_at:'2026-10-15T00:00:00Z',updated_at:'2026-10-15T00:00:00Z',completed_at:null,sunday_service:'morning'};
 const categories=[{id,name:'Sunday Service'}];const task=model.mapTask(validation.decodeRow(row),categories);assert.equal(task.sundayService,'morning');assert.equal(model.taskFields(task,categories).sunday_service,'morning');
 assert.equal(model.mapTask(validation.decodeRow({...row,sunday_service:undefined}),categories).sundayService,'evening');
 assert.equal(model.taskFields({...task,category:'Healing Meeting'},[{id,name:'Healing Meeting'}]).sunday_service,null);
 assert.equal(service.taskSundayService({...task,category:'Healing Meeting'}),null);
 assert.equal(model.newTaskDraft('Sunday Service').sundayService,'evening');assert.equal(model.newTaskDraft('Healing Meeting').sundayService,null);
 for(const bad of ['night',false,[],1])assert.equal(validation.validFields({...fields,sunday_service:bad}),false);
 assert.throws(()=>validation.decodeRow({...row,sunday_service:'night'}));
});
test('Sunday section rendering uses both service headings and separate scoped controls',()=>{
 const React=require('react'),jsx=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server');
 const label=load('../src/components/sunday-service-label.tsx',{'react/jsx-runtime':jsx,'./sunday-service.module.css':{default:new Proxy({},{get:(_,key)=>String(key)})}});
 const Panel=load('../src/components/sunday-service-sections.tsx',{'react':React,'react/jsx-runtime':jsx,'@/lib/tasks/sunday-service':service,'./sunday-service-label':label,'./assigned-meeting-heading.module.css':{default:{}},'./sunday-service.module.css':{default:{}}}).default;
 const html=renderToStaticMarkup(React.createElement(Panel,{now:at('2026-10-18T16:00:00'),render:(value,status)=>React.createElement('p',null,value+':'+status)}));
 assert.ok(html.indexOf('Evening Service')<html.indexOf('Morning Service'));assert.match(html,/evening:Active/);assert.match(html,/morning:Active/);assert.equal((html.match(/CURRENT SERVICE/g)??[]).length,1);
 const morning=renderToStaticMarkup(React.createElement(label.default,{value:'morning'})),evening=renderToStaticMarkup(React.createElement(label.default,{value:'evening'}));assert.match(morning,/class="label morning"/);assert.match(evening,/class="label evening"/);
});
test('bulk shared details copy service into existing and subsequently added rows without crossing categories',()=>{
 const React=require('react'),jsx=require('react/jsx-runtime');let cursor=0,refCursor=0;const states=[],refs=[];
 const fakeReact={...React,useId:()=> 'bulk-test',useEffect(){},useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=refCursor++;if(!(i in refs))refs[i]={current:initial};return refs[i];}};
 const Dummy=()=>null;const Bulk=load('../src/components/bulk-task-editor.tsx',{'react':fakeReact,'react/jsx-runtime':jsx,'./capitalized-input':{default:Dummy},'@/lib/tasks/model':model,'./task-repeat':{default:Dummy},'./task-time':{default:Dummy},'./task-assignee':{default:Dummy},'./sunday-service-field':{default:Dummy},'./special-meeting-title':{SpecialMeetingTitleField:Dummy},'./special-meeting-schedule':{SpecialMeetingSchedule:Dummy},'./task-app.module.css':{default:new Proxy({},{get:(_,key)=>String(key)})},'@/lib/templates/model':{templateDrafts:()=>[]}},{window:{requestAnimationFrame(){}}}).default;
 // Real component callbacks, with only browser focus side effects stubbed.
 const oldWindow=globalThis.window;globalThis.window={requestAnimationFrame(){}};
 const props={categories:['Sunday Service','Healing Meeting'],initialCategory:'Sunday Service',members:[],onSave(){},onClose(){},onDirty(){},pending:false,uncertain:false};
 const render=()=>{cursor=0;refCursor=0;return Bulk(props);};
 function flatten(node){if(!node||typeof node!=='object')return[];return[node,...React.Children.toArray(node.props?.children).flatMap(flatten)];}
 let tree=flatten(render());const sub=tree.find(n=>n.props?.label==='Subcategory for task 1');assert.equal(sub.props.value,'evening');sub.props.onChange('morning');
 tree=flatten(render());tree.find(n=>n.type==='button'&&n.props.className==='applyDetails').props.onClick();tree=flatten(render());tree.find(n=>n.type==='button'&&n.props.className==='addAnother').props.onClick();tree=flatten(render());
 const values=tree.filter(n=>n.props?.label?.startsWith('Subcategory for task')).map(n=>n.props.value);assert.deepEqual(values,['morning','morning']);
 tree.find(n=>n.type==='select'&&n.props.value==='Sunday Service').props.onChange({target:{value:'Healing Meeting'}});tree=flatten(render());assert.equal(tree.filter(n=>n.props?.label?.startsWith('Subcategory for task')).length,0);
 globalThis.window=oldWindow;
});

test('Assigned Sunday headings hide missing services while category defaults and other meeting layouts stay intact',()=>{
 const React=require('react'),jsx=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server');
 const label=load('../src/components/sunday-service-label.tsx',{'react/jsx-runtime':jsx,'./sunday-service.module.css':{default:{}}});
 const Sunday=load('../src/components/sunday-service-sections.tsx',{'react':React,'react/jsx-runtime':jsx,'@/lib/tasks/sunday-service':service,'./sunday-service-label':label,'./assigned-meeting-heading.module.css':{default:{}},'./sunday-service.module.css':{default:{}}}).default;
 const Assigned=load('../src/components/assigned-meeting-sections.tsx',{'react':React,'react/jsx-runtime':jsx,'@/lib/tasks/sunday-service':service,'./assigned-meeting-heading':{default:()=>React.createElement('h2',null,'Current meeting')},'./sunday-service-sections':{default:Sunday},'./special-meeting-title':{SpecialMeetingHeading:()=>React.createElement('h2',null,'Special Meeting')},'./sunday-service.module.css':{default:{}}}).default;
 const props={now:at('2026-10-18T10:00:00'),title:null,hasSpecial:false,pending:false,error:'',onRefresh(){},render:(scope,status)=>React.createElement('p',{'data-scope':scope},scope+':'+(status??'global'))};
 const html=extra=>renderToStaticMarkup(React.createElement(Assigned,{...props,...extra}));
 const morning=html({sundayServices:['morning']});assert.match(morning,/Morning Service/);assert.doesNotMatch(morning,/Evening Service/);assert.match(morning,/morning:Active/);assert.doesNotMatch(morning,/regular:global/);
 const evening=html({sundayServices:['evening']});assert.match(evening,/Evening Service/);assert.doesNotMatch(evening,/Morning Service/);
 const both=html({sundayServices:['morning','evening'],hasOtherRegular:true,hasSpecial:true});assert.match(both,/other:global/);assert.match(both,/special:Active/);assert.ok(both.indexOf('Morning Service')<both.indexOf('Evening Service'));
 const after4=html({now:at('2026-10-18T16:00:00'),sundayServices:['morning','evening']});assert.ok(after4.indexOf('Evening Service')<after4.indexOf('Morning Service'));
 const empty=html({sundayServices:[]});assert.match(empty,/regular:global/);assert.doesNotMatch(empty,/Morning Service|Evening Service/);
 const wednesday=html({now:at('2026-10-21T10:00:00'),sundayServices:['morning','evening']});assert.match(wednesday,/regular:global/);assert.doesNotMatch(wednesday,/Morning Service|Evening Service/);
 const replacement=html({activeSpecial:true,hasSpecial:true,sundayServices:['morning','evening']});assert.match(replacement,/special:Active/);assert.doesNotMatch(replacement,/Current meeting|Morning Service|Evening Service/);
});

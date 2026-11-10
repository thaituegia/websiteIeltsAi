import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../deploy/inspect-exam-audio.py", import.meta.url));
const fixture = String.raw`
import copy,importlib.util,json,os,pathlib,stat,sys,tempfile
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('audio_inspection',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
scenario=sys.argv[2];secret='sk-SYNTHETIC_PRIVATE_NEVER_PRINT';calls=[];budgets=[];state={'created':False,'running':False,'removed':False};identifier='d'*64
with tempfile.TemporaryDirectory(prefix='ielts-audio-inspection-test-') as directory:
 root=pathlib.Path(directory);m.LIVE_DIR=root/'live';private=m.LIVE_DIR/'.local/deploy';private.mkdir(parents=True,mode=0o700)
 selector=private/'deploy.env';selector.write_text('IELTS_COMPOSE_PROJECT='+m.PROJECT+'\n');selector.chmod(0o600)
 def owned(path,directory=False,private=False):
  row=path.lstat();assert path.resolve(strict=True)==path
  assert stat.S_ISDIR(row.st_mode) if directory else stat.S_ISREG(row.st_mode)
  assert not private or row.st_mode&0o077==0
 m.owned=owned
 networks={m.PROJECT+'_web':'1'*64,m.PROJECT+'_database':'2'*64}
 environment={'MONGODB_URI':'mongodb://mongo:27017/ielts_ai','APP_ORIGIN':'https://sutonghanyu.vn','DUO_CREDENTIALS_FILE':'','DUO_ACCOUNTS_JSON':'synthetic-unlock','IELTS_OPENAI_API_KEY':secret}
 rows={}
 for service,key in [('app','a'),('mongo','b')]:
  rows[service]={'Id':key*64,'Image':'sha256:'+'c'*64,'Name':'/'+m.PROJECT+'-'+service+'-1','Config':{'Env':[key+'='+value for key,value in environment.items()],'Labels':{'com.docker.compose.project':m.PROJECT,'com.docker.compose.service':service,'com.docker.compose.project.working_dir':str(m.LIVE_DIR/'deploy')}},'HostConfig':{'PortBindings':{'3001/tcp':[{'HostIp':'127.0.0.1','HostPort':'19088'}]}},'State':{'Running':True,'Health':{'Status':'healthy'}},'NetworkSettings':{'Networks':{key:{'NetworkID':value} for key,value in networks.items() if service=='app' or key.endswith('_database')},'Ports':{'3001/tcp':[{'HostIp':'127.0.0.1','HostPort':'19088'}]}}}
 if scenario=='foreign-project':rows['app']['Config']['Labels']['com.docker.compose.project']='foreign'
 if scenario=='wrong-origin':rows['app']['Config']['Env']=[item.replace('https://sutonghanyu.vn','https://other.invalid') for item in rows['app']['Config']['Env']]
 original=copy.deepcopy(rows)
 report={'mode':'cache-only-read-only','providerRequests':0,'configured':True,'inspectionComplete':True,'allExamAudioReady':False,'groups':[{'scope':'duo','band':3,'format':'full-mock','papers':138,'readyPapers':85,'missingPapers':53,'sections':270,'readySections':171,'missingSections':99,'readyPaperIds':[],'missing':[]}],'placement':{'total':1,'ready':1,'missing':0,'missingIds':[]},'inspectionErrors':0}
 def command(args,timeout=30):
  calls.append(args);assert secret not in json.dumps(args)
  if args[:2]==['docker','ps']:
   if any(value.startswith('name=') for value in args):return identifier if state['created'] and not state['removed'] else ''
   service=next(value.split('=',2)[-1] for value in args if value.startswith('label=com.docker.compose.service='));return rows[service]['Id']
  if args[:3]==['docker','network','inspect']:
   name=args[-1];kind='database' if name.endswith('_database') else 'web'
   return json.dumps([{'Id':networks[name],'Name':name,'Internal':kind=='database','Labels':{'com.docker.compose.project':m.PROJECT,'com.docker.compose.network':kind}}])
  if args[:2]==['docker','inspect']:
   if args[-1] in [rows['app']['Id'],rows['mongo']['Id']]:return json.dumps([next(row for row in rows.values() if row['Id']==args[-1])])
   assert args[-1]==identifier
   value=copy.deepcopy(state['job']);value['State']={'Running':state['running'],'ExitCode':0}
   if scenario=='job-owner-mismatch':value['Config']['Labels']['com.websiteieltsai.project']='foreign'
   if scenario=='wrong-job-network':value['NetworkSettings']['Networks'][m.PROJECT+'_web']['NetworkID']='f'*64
   return json.dumps([value])
  if args[:2]==['docker','create']:
   assert '--memory=384m' in args and '--memory-swap=384m' in args and '--cpus=0.25' in args and '--read-only' in args and '--cap-drop=ALL' in args
   assert not any(value in args for value in ['--mount','--volume','-v','--publish','-p'])
   assert args.count('--network')==2 and args[-1]==m.NODE_PROGRAM
   path=pathlib.Path(args[args.index('--env-file')+1]);assert stat.S_IMODE(path.stat().st_mode)==0o600 and secret in path.read_text()
   labels=dict(args[index+1].split('=',1) for index,value in enumerate(args) if value=='--label')
   state['job']={'Id':identifier,'Image':rows['app']['Image'],'Name':'/'+args[args.index('--name')+1],'Config':{'Labels':labels},'NetworkSettings':{'Networks':{key:{'NetworkID':value} for key,value in networks.items()}}};state['created']=True
   if scenario=='create-timeout':raise m.Refusal('Synthetic create timeout')
   return identifier
  if args[:2]==['docker','start']:assert args[-1]==identifier;state['running']=False;return identifier
  if args[:2]==['docker','logs']:
   assert args[-1]==identifier
   value=copy.deepcopy(report)
   if scenario=='private-output':value['private']=secret
   if scenario=='nested-private-output':value['groups'][0]['private']=secret
   if scenario=='false-ready':value['allExamAudioReady']=True
   if scenario=='malformed-output':return secret
   return json.dumps(value)
  if args[:2]==['docker','rm']:assert args[-1]==identifier;state['removed']=True;return identifier
  if args[:2]==['docker','stop']:assert args[-1]==identifier;state['running']=False;return identifier
  raise AssertionError('Unexpected diagnostic command')
 m.command=command
 def headroom(value):
  budgets.append(value)
  if scenario=='low-memory':raise m.Refusal('Insufficient RAM')
 m.headroom=headroom
 failure=None
 try:result=m.diagnose()
 except (m.Refusal,ValueError):failure=True
 if scenario=='success':assert not failure and result==report and state['removed'] and budgets==[384,0]
 else:assert failure
 if state['created'] and scenario!='job-owner-mismatch':assert state['removed']
 if scenario in ['low-memory','foreign-project','wrong-origin']:assert not state['created']
 if scenario=='job-owner-mismatch':assert not any(args[:2] in (['docker','rm'],['docker','stop']) for args in calls)
 assert rows==original
 assert not list(private.glob('audio-inspect-*'))
 assert not any(args[:2] in (['docker','exec'],['docker','restart']) for args in calls)
 print(json.dumps({'scenario':scenario,'readOnly':True,'providerRequests':0}))
`;

for (const scenario of ["success", "low-memory", "foreign-project", "wrong-origin", "job-owner-mismatch", "wrong-job-network", "private-output", "nested-private-output", "false-ready", "malformed-output", "create-timeout"]) {
  test(`cache-only audio inspection: ${scenario}`, () => {
    const result = spawnSync("python3", ["-c", fixture, script, scenario], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).scenario, scenario);
  });
}

test("actual inspection program verifies all papers without writes, downloads or provider calls", () => {
  const program = spawnSync("python3", ["-c", "import importlib.util,sys;sys.dont_write_bytecode=True;s=importlib.util.spec_from_file_location('d',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.NODE_PROGRAM)", script], { encoding: "utf8" });
  assert.equal(program.status, 0, program.stderr);
  const run = String.raw`
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const mode=process.env.INSPECTION_FIXTURE_MODE,lesson=[],mocks=[];
for(let band=3;band<=8;band+=0.5){for(let variant=0;variant<8;variant++)lesson.push({id:'duo-private-lesson-'+band+'-'+variant,title:'Private lesson',skill:'listening',format:'lesson',band,sections:[{id:'duo-lesson-'+band+'-'+variant,text:'SYNTHETIC source never printed.'}]});for(let variant=0;variant<4;variant++)mocks.push({id:'duo-private-mock-'+band+'-'+variant,title:'Private mock',skill:'listening',format:'full-mock',band,sections:Array.from({length:4},(_,index)=>({id:'duo-mock-'+band+'-'+variant+'-'+index,text:'SYNTHETIC source never printed.'}))});}
for(let variant=0;variant<6;variant++)lesson.push({id:'duo-private-supplement-'+variant,title:'Private supplement',skill:'listening',format:'lesson',band:3,sections:[{id:'duo-supplement-'+variant,text:'SYNTHETIC source never printed.'}]});
globalThis.sources={content:[{id:'public-lesson',title:'Public lesson',band:3,format:'lesson',sections:[{id:'public-1',text:'Unprinted public source'}]}],duo_exam_content:mode==='absent'?[]:[...lesson,...mocks],placementItems:[{id:'placement-1',text:'Unprinted placement source'}]};
const privateSections=[...lesson,...mocks].flatMap(paper=>paper.sections);
globalThis.ready=new Set(['public-1','placement-1',...privateSections.slice(0,mode==='complete'?270:171).map(section=>section.id)]);
globalThis.readinessCalls=0;globalThis.connected=0;globalThis.closed=0;
const mongo='export class MongoClient{async connect(){globalThis.connected++}db(){return{databaseName:"ielts_ai",collection(name){if(!["content","duo_exam_content","placementItems"].includes(name))throw Error("unexpected collection");return{find(filter,options){if(filter.skill!=="listening"||!options.projection)throw Error("unexpected query");const items=globalThis.sources[name];return{sort(){return this},limit(){return this},batchSize(){return this},async close(){},async *[Symbol.asyncIterator](){yield*items}}}}}}}async close(){globalThis.closed++}}';
const speech='export function speechCapabilities(){return{configured:true}};export class SpeechAudioCache{constructor(database){if(database.db.databaseName!=="ielts_ai")throw Error("wrong database")}async readiness(sections){globalThis.readinessCalls++;return{configured:true,totalCount:sections.length,readyCount:sections.filter(section=>globalThis.ready.has(section.id)).length}}async get(){throw Error("PAID GET FORBIDDEN")}async getReady(){throw Error("DOWNLOAD FORBIDDEN")}}';
registerHooks({resolve(specifier,context,next){let source;if(specifier==='mongodb')source=mongo;else if(specifier==='/app/server/duo-auth.ts')source='export function loadDuoCredentials(){return{synthetic:true}}';else if(specifier==='/app/server/provider-config.ts')source='export function activateProviderConfig(){return true}';else if(specifier==='/app/server/speech-audio.ts')source=speech;return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(specifier,context)}});
const prints=[],originalLog=console.log;console.log=value=>prints.push(value);
await(async()=>{PROGRAM})();
console.log=originalLog;
assert.equal(prints.length,1);assert.equal(prints[0].includes('Unprinted'),false);assert.equal(prints[0].includes('SYNTHETIC source'),false);
const result=JSON.parse(prints[0]);assert.equal(result.providerRequests,0);assert.equal(globalThis.connected,1);assert.equal(globalThis.closed,1);
await assert.rejects(globalThis.fetch('https://api.openai.com/v1/audio/speech'),/External HTTP disabled/);
if(mode==='absent'){assert.equal(result.inspectionComplete,false);assert.equal(result.allExamAudioReady,false);assert.equal(result.error,'inventory-incomplete');}
else {assert.equal(result.inspectionComplete,true);const groups=result.groups.filter(group=>group.scope==='duo');assert.equal(groups.reduce((sum,group)=>sum+group.papers,0),138);assert.equal(groups.reduce((sum,group)=>sum+group.sections,0),270);assert.equal(groups.reduce((sum,group)=>sum+group.readySections,0),mode==='complete'?270:171);assert.equal(groups.reduce((sum,group)=>sum+group.missingSections,0),mode==='complete'?0:99);assert.equal(result.allExamAudioReady,mode==='complete');if(mode==='partial'){assert.equal(groups.filter(group=>group.format==='lesson').every(group=>group.missingPapers===0),true);assert.equal(groups.reduce((sum,group)=>sum+group.readyPapers,0),113);}}
console.log(JSON.stringify({mode,readOnly:true}));
`;
  for (const mode of ["partial", "complete", "absent"]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-"], { input: run.replace("PROGRAM", program.stdout), env: { ...process.env, MONGODB_URI: "mongodb://mongo:27017/ielts_ai", INSPECTION_FIXTURE_MODE: mode }, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).mode, mode);
  }
});

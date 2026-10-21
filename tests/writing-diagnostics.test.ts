import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../deploy/diagnose-writing.py", import.meta.url));
const fixture = String.raw`
import copy,importlib.util,json,os,pathlib,stat,subprocess,sys,tempfile
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('writing_diagnostic',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
scenario=sys.argv[2];secret='SYNTHETIC_WRITING_PRIVATE_NEVER_PRINT';calls=[]
with tempfile.TemporaryDirectory(prefix='ielts-writing-diagnostic-') as folder:
 root=pathlib.Path(folder);m.LIVE_DIR=root/'live';private=m.LIVE_DIR/'.local/deploy';private.mkdir(parents=True,mode=0o700)
 cfg=private/'deploy.env';cfg.write_text('IELTS_COMPOSE_PROJECT='+m.PROJECT+'\nOPENAI_API_KEY='+secret+'\n');cfg.chmod(0o600)
 actual_lstat=pathlib.Path.lstat
 def synthetic_lstat(path,*args,**kwargs):
  info=actual_lstat(path,*args,**kwargs)
  if path.is_relative_to(root):
   fields=list(info);fields[4]=0;return os.stat_result(fields)
  return info
 pathlib.Path.lstat=synthetic_lstat
 identifier='a'*64
 app={'Id':identifier,'Image':'sha256:'+'b'*64,'ImageRef':m.PROJECT+'-app:release-'+'c'*12+'-nonce','Labels':{'com.docker.compose.project':m.PROJECT,'com.docker.compose.service':'app','com.docker.compose.project.working_dir':str(m.LIVE_DIR/'deploy'),'private':secret},'State':{'Running':scenario!='stopped','OOMKilled':True,'Health':{'Status':'healthy','Log':[secret]},'Error':secret},'RestartCount':2,'ConfiguredPorts':{'3001/tcp':[{'HostIp':'127.0.0.1','HostPort':'19088'}]},'Ports':{'3001/tcp':[{'HostIp':'127.0.0.1','HostPort':'19088'}]}}
 if scenario=='foreign-project':app['Labels']['com.docker.compose.project']='foreign'
 if scenario=='foreign-port':app['ConfiguredPorts']['3001/tcp'][0]['HostPort']='9999'
 if scenario=='wrong-image':app['Image']=secret
 if scenario=='redirected-config':
  cfg.unlink();(root/'foreign.env').write_text('IELTS_COMPOSE_PROJECT='+m.PROJECT+'\n');cfg.symlink_to(root/'foreign.env')
 def command(args,timeout=20,stderr=False):
  calls.append(args)
  if args[:2]==['docker','ps']:return identifier+'\n'
  if args[:2]==['docker','inspect']:
   assert '.Config.Env' not in args[3];return json.dumps(app)
  if args[:2]==['docker','logs']:
   assert args[2:6]==['--tail','300','--since','24h'] and args[-1]==identifier
   if scenario=='logs-unavailable':raise m.Refusal('Diagnostic command failed')
   return 'API failure: '+secret+'\nAI grading failure: {"code":"AI_PROVIDER_AUTH","private":"'+secret+'"}\nAI grading failure: AI_EVIDENCE_INVALID\n'
  if args[:2]==['docker','exec']:
   assert args[2]==identifier and args[3:9]==['node','--import','tsx','--input-type=module','-e',m.PROVIDER_PROGRAM]
   assert 'server/index' not in args[-1] and 'connectDatabase' not in args[-1] and '/chat/completions' not in args[-1]
   row={'configured':True,'configuration':'available','models':[{'model':'gpt-4o','roles':['extraction','scoring'],'httpStatus':200,'access':'available','key':secret}],'private':secret,'billingQuotaChecked':True,'gradingCalled':True}
   if scenario=='model-response-private':row['models'][0]['model']=secret
   if scenario=='model-response-malformed':return secret
   return json.dumps(row)
  raise AssertionError('Unexpected diagnostic command')
 m.command=command;m.health=lambda tls=False:{'ok':True,'httpStatus':200}
 try:report=m.diagnose()
 except m.Refusal:
  assert scenario in ('foreign-project','foreign-port','wrong-image','redirected-config')
  assert not any(args[:2]==['docker','exec'] for args in calls)
  print(json.dumps({'scenario':scenario,'refused':True}));sys.exit(0)
 assert scenario not in ('foreign-project','foreign-port','wrong-image','redirected-config')
 rendered=json.dumps(report)
 assert secret not in rendered and 'private' not in rendered
 assert report['mode']=='read-only' and report['app']['oomKilled'] is True and report['app']['restarts']==2
 assert report['app']['releaseCommitPrefix']=='c'*12
 assert report['openaiModelAccess']['billingQuotaChecked'] is False and report['openaiModelAccess']['gradingCalled'] is False
 if scenario=='stopped':assert not any(args[:2]==['docker','exec'] for args in calls)
 if scenario.startswith('model-response-'):assert report['openaiModelAccess']['configuration']=='diagnostic-unavailable'
 if scenario=='logs-unavailable':assert report['logsLast24hTail300']=={'available':False}
 else:
  assert report['logsLast24hTail300']['apiFailures']==1
  assert report['logsLast24hTail300']['aiCodes']['AI_PROVIDER_AUTH']==1 and report['logsLast24hTail300']['aiCodes']['AI_EVIDENCE_INVALID']==1
 assert all(args[1] in ('ps','inspect','logs','exec') for args in calls)
 print(json.dumps({'scenario':scenario,'readOnly':True}))
`;

for (const scenario of ["success", "stopped", "foreign-project", "foreign-port", "wrong-image", "redirected-config", "logs-unavailable", "model-response-private", "model-response-malformed"]) {
  test(`Writing diagnostics: ${scenario}`, () => {
    const result = spawnSync("python3", ["-c", fixture, script, scenario], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).scenario, scenario);
  });
}

test("model diagnostic executes only bounded GET lookups, deduplicates models and never prints the key", () => {
  const program = spawnSync("python3", ["-c", "import importlib.util,sys;sys.dont_write_bytecode=True;s=importlib.util.spec_from_file_location('d',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.PROVIDER_PROGRAM)", script], { encoding: "utf8" });
  assert.equal(program.status, 0, program.stderr);
  const run = String.raw`
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(specifier==='/app/server/duo-auth.ts')return {url:'data:text/javascript,export function loadDuoCredentials(){return {synthetic:true}}',shortCircuit:true};
 if(specifier==='/app/server/provider-config.ts')return {url:'data:text/javascript,export function activateProviderConfig(s){globalThis.configActivated=s.synthetic;return true}',shortCircuit:true};
 return next(specifier,context);
}});
const calls=[],prints=[];
const originalConsole=console.log;
globalThis.fetch=async(url,options)=>{
 assert.match(url,/^https:\/\/api\.openai\.com\/v1\/models\/(?:gpt-4o|gpt-4o-mini)$/);
 assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);
 assert.equal(options.headers.Authorization,'Bearer sk-SYNTHETIC_KEY_MUST_NEVER_PRINT');
 assert.ok(options.signal instanceof AbortSignal);calls.push(url);
 return new Response('',{status:process.env.SYNTHETIC_STATUS==='denied'?401:200});
};
console.log=value=>prints.push(value);
const run=async()=>{PROGRAM};
await run();
console.log=originalConsole;
assert.equal(globalThis.configActivated,true);
assert.equal(prints.length,1);assert.equal(prints[0].includes('sk-SYNTHETIC'),false);
const result=JSON.parse(prints[0]);
assert.equal(result.billingQuotaChecked,false);assert.equal(result.gradingCalled,false);
const scenario=process.env.SYNTHETIC_SCENARIO;
if(scenario==='invalid-model'){assert.equal(calls.length,0);assert.equal(result.configuration,'invalid-model-name')}
else if(scenario==='missing-key'){assert.equal(calls.length,0);assert.equal(result.configured,false)}
else {
 assert.equal(calls.length,scenario==='distinct-models'?2:1);
 assert.equal(result.models[0].access,scenario==='denied'?'denied':'available');
}
console.log(JSON.stringify({scenario,calls:calls.length}));
`;
  for (const scenario of ["same-model", "distinct-models", "denied", "invalid-model", "missing-key"]) {
    const environment = { ...process.env, IELTS_OPENAI_API_KEY: scenario === "missing-key" ? "" : "sk-SYNTHETIC_KEY_MUST_NEVER_PRINT", OPENAI_API_KEY: "", EXTRACTOR_MODEL: scenario === "invalid-model" ? "sk-SYNTHETIC_PRIVATE" : "gpt-4o", SCORING_MODEL: scenario === "distinct-models" ? "gpt-4o-mini" : "gpt-4o", SYNTHETIC_SCENARIO: scenario, SYNTHETIC_STATUS: scenario };
    const result = spawnSync(process.execPath, ["--input-type=module", "-"], { input: run.replace("PROGRAM", program.stdout), env: environment, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).scenario, scenario);
  }
});

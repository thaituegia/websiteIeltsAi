import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../deploy/update-app.py", import.meta.url));
// Reuse the existing complete synthetic installation rather than maintaining a
// second copy of its Compose/rollback assertions. Every command is intercepted.
const existing = readFileSync(new URL("./update-app.test.ts", import.meta.url), "utf8");
const prefix = "const fixture = String.raw`";
const start = existing.indexOf(prefix) + prefix.length;
const end = existing.indexOf("`;", start);
assert.ok(start >= prefix.length && end > start);
const fixture = existing.slice(start, end)
  .replace("m.deploy(guards,diagnostic,commit,archive)\n", "m.deploy(guards,diagnostic,commit,archive,add_three_gate_papers=True)\n")
  .replace("  budgets.append(budget)", "  budgets.append(budget)\n  if scenario=='supplement-low-memory' and budget==384 or scenario=='supplement-low-memory-before-switch' and budget==512 and 384 in budgets:raise RuntimeError('Insufficient memory')")
  .replace(" guards=types.SimpleNamespace", String.raw`
 base_command=command;supplement_calls=[];supplement_state={'exists':False,'id':'a1'*32}
 def command(args,timeout=60):
  if args[:2]==['docker','run'] and '/app/server/duo-gate-supplement-cli.ts' in args:
   calls.append(args);supplement_calls.append(args)
   assert state['app']['Id']==oldid and 'build' in logs and not switches
   assert timeout==240 and args[-5:]==[newimage,'--import','tsx','/app/server/duo-gate-supplement-cli.ts','--prepare']
   assert '--memory=384m' in args and '--memory-swap=384m' in args and '--cpus=0.25' in args and budgets[-1]==384
   assert '--restart=no' in args and '--rm' in args and '--read-only' in args and '--cap-drop=ALL' in args and '--user=node' in args
   assert '--pids-limit=64' in args and '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m' in args and '--security-opt=no-new-privileges:true' in args
   assert [args[i+1] for i,x in enumerate(args) if x=='--network']==[project+'_web',project+'_database']
   assert not any(x in args for x in ('--mount','--volume','-v','--network=host','-p','--publish','--watch','--resume'))
   name=args[args.index('--name')+1];assert re.fullmatch(re.escape(project)+r'-gate-supplement-[a-f0-9]+',name)
   labels=dict(args[i+1].split('=',1) for i,x in enumerate(args) if x=='--label')
   assert labels=={'com.websiteieltsai.project':project,'com.websiteieltsai.kind':'gate-supplement','com.websiteieltsai.operation-id':name.rsplit('-gate-supplement-',1)[1]}
   path=pathlib.Path(args[args.index('--env-file')+1]);probe_files.append(path)
   assert path.name=='gate-supplement.env' and path.stat().st_mode&0o777==0o600 and not path.is_symlink()
   env=dict(line.split('=',1) for line in path.read_text().splitlines())
   assert env['OPENAI_API_KEY']==secret and env['DUO_ACCOUNTS_JSON']==environment['DUO_ACCOUNTS_JSON']
   assert env['MONGODB_URI']=='mongodb://mongo:27017/ielts_ai' and env['APP_ORIGIN']==m.ORIGIN and 'NODE_VERSION' not in env
   assert secret not in json.dumps(args)
   supplement_state.update({'name':name,'labels':labels})
   if scenario in ('supplement-timeout','supplement-timeout-foreign'):
    supplement_state['exists']=True
    raise subprocess.TimeoutExpired(args,timeout)
   report={'ok':True,'version':m.GATE_SUPPLEMENT_VERSION,'total':3,'ready':3,'providerRequests':3,'maxProviderRequests':3,'inputCharacters':7200,'maxInputCharacters':9000}
   if scenario=='supplement-pending':report['ready']=2
   if scenario=='supplement-bad-counts':report['providerRequests']=4
   if scenario=='supplement-bool-count':report['providerRequests']=True
   if scenario=='supplement-extra-field':report['private']=secret
   if scenario=='supplement-wrong-version':report['version']='other-version'
   if scenario=='supplement-previous-version':report['version']='duo-gate-20261110-v1'
   if scenario=='supplement-command-error':raise RuntimeError(secret)
   return json.dumps(report)
  if args[:2]==['docker','ps'] and any(x.startswith('name=^/'+project+'-gate-supplement-') for x in args):
   calls.append(args);return supplement_state['id'] if supplement_state['exists'] else ''
  if args[:2]==['docker','inspect'] and args[-1]==supplement_state['id']:
   calls.append(args);labels=copy.deepcopy(supplement_state['labels'])
   if scenario=='supplement-timeout-foreign':labels['com.websiteieltsai.kind']='foreign-kind'
   return json.dumps({'Id':supplement_state['id'],'Image':newimage,'Name':'/'+supplement_state['name'],'Labels':labels})
  if args[:2]==['docker','rm'] and args[-1]==supplement_state['id']:
   calls.append(args);assert scenario=='supplement-timeout' and args==['docker','rm','--force',supplement_state['id']]
   supplement_state['exists']=False;return ''
  return base_command(args,timeout)
 guards=types.SimpleNamespace`)
  .replace("or scenario in ('upgrade-timeout-probe-cleaned','upgrade-success-probe-rm-race')", "or scenario in ('upgrade-timeout-probe-cleaned','upgrade-success-probe-rm-race','supplement-timeout')")
  .replace(" print(json.dumps({'scenario':scenario", String.raw`
 assert len(supplement_calls)==(0 if scenario=='supplement-low-memory' else 1)
 if scenario=='success':
  assert receipt['privateGateSupplement']['ready']==3 and receipt['privateGateSupplement']['maxProviderRequests']==3
  assert receipt['privateGateSupplement']['version']==m.GATE_SUPPLEMENT_VERSION
  assert json.loads(next((private/'app-updates').glob('*/gate-supplement.json')).read_text())==receipt['privateGateSupplement']
 else:
  assert not switches and not list((private/'app-updates').glob('*/complete.json'))
 if scenario=='supplement-timeout':assert not supplement_state['exists']
 if scenario=='supplement-timeout-foreign':assert supplement_state['exists'] and not any(x[:2]==['docker','rm'] for x in calls)
 print(json.dumps({'scenario':scenario`);

for (const additional of [false, true]) {
  const selectedFixture = additional ? fixture
    .replace("add_three_gate_papers=True", "add_three_more_gate_papers=True")
    .replace("'--prepare']", "'--prepare-additional']")
    .replaceAll("m.GATE_SUPPLEMENT_VERSION", "m.ADDITIONAL_GATE_SUPPLEMENT_VERSION") : fixture;
  const scenarios = ["success", "supplement-pending", "supplement-bad-counts", "supplement-bool-count", "supplement-extra-field", "supplement-wrong-version", "supplement-command-error", "supplement-timeout", "supplement-timeout-foreign", "supplement-low-memory", "supplement-low-memory-before-switch",
    ...(additional ? ["supplement-previous-version"] : [])];
  for (const scenario of scenarios) {
    test(`opt-in ${additional ? "additional" : "initial"} three-paper rollout: ${scenario}`, () => {
      const result = spawnSync("python3", ["-c", selectedFixture, script, scenario], { encoding: "utf8", timeout: 20_000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(!result.stdout.includes("SYNTHETIC_PRIVATE_NEVER_PRINT"));
    });
  }
}

test("operator accepts only the explicit finite three-paper mode", () => {
  const program = String.raw`
import importlib.util,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('operator',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.os.geteuid=lambda:0;calls=[];downloads=[]
m.download=lambda *args:downloads.append(args)
m.checked_module=lambda path,name:('synthetic-module',name)
real_deploy=m.deploy
for options in [{'add_three_gate_papers':True,'add_three_more_gate_papers':True},{'upgrade_text_models':True,'add_three_more_gate_papers':True}]:
 try:real_deploy(None,None,'a'*40,'b'*64,**options)
 except RuntimeError:pass
 else:raise AssertionError('Mixed paid operations accepted')
def deploy(*args,**kwargs):calls.append(kwargs)
m.deploy=deploy
m.sys.argv=['update-app.py','a'*40,'b'*64,'--add-three-gate-papers'];m.main()
assert calls==[{'upgrade_text_models':False,'add_three_gate_papers':True}] and len(downloads)==2
m.sys.argv=['update-app.py','a'*40,'b'*64,'--add-three-more-gate-papers'];m.main()
assert calls[-1]=={'upgrade_text_models':False,'add_three_more_gate_papers':True} and len(downloads)==4
for extra in [['--add-three-gate-papers','--cached-audio-only'],['--add-three-gate-papers','--upgrade-text-models'],['--add-three-gate-papers','--add-three-gate-papers'],['--add-three-gate-papers=3'],['--max-provider-requests','3'],['--add-three-more-gate-papers','--cached-audio-only'],['--add-three-more-gate-papers','--upgrade-text-models'],['--add-three-more-gate-papers','--add-three-gate-papers'],['--add-three-more-gate-papers','--add-three-more-gate-papers'],['--add-three-more-gate-papers=3']]:
 m.sys.argv=['update-app.py','a'*40,'b'*64]+extra
 try:m.main()
 except RuntimeError:pass
 else:raise AssertionError('Unapproved audio allowance accepted')
assert len(calls)==2 and len(downloads)==4
`;
  const result = spawnSync("python3", ["-c", program, script], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

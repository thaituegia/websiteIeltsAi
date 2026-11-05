import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../deploy/update-app.py", import.meta.url));

// Execute the actual operator with a synthetic installation. Docker, downloads
// and health are isolated fixtures: no live VPS, user, database or provider.
const fixture = String.raw`
import contextlib,copy,hashlib,importlib.util,io,json,os,pathlib,re,stat,subprocess,sys,tarfile,tempfile,types
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('operator',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
scenario=sys.argv[2];upgrade=scenario.startswith('upgrade-');preserved=scenario in ('ordinary-success-previous-model-upgrade','ordinary-success-legacy-models');secret='SYNTHETIC_PRIVATE_NEVER_PRINT';commit='a'*40;archive='b'*64
with tempfile.TemporaryDirectory(prefix='ielts-app-only-test-') as folder:
 root=pathlib.Path(folder);m.LIVE_DIR=root/'live';private=m.LIVE_DIR/'.local/deploy';private.mkdir(parents=True,mode=0o700)
 (m.LIVE_DIR/'deploy').mkdir();(private/'tls').mkdir();(m.LIVE_DIR/'.local/releases').mkdir(mode=0o700)
 os.umask(0o077)
 for name in ['deploy.env','app.env','domain.compose.yaml','release.compose.yaml']:(private/name).write_text('PRIVATE='+secret+'\n')
 for name in ['compose.yaml','compose.sh','nginx.conf']:(m.LIVE_DIR/'deploy'/name).write_text('public placeholder\n')
 (private/'tls/site.crt').write_text('public cert\n');gateway=root/'gateway.conf';gateway.write_text('public gateway\n')
 release=private/'release.compose.yaml';original_override=release.read_bytes();project=m.PROJECT
 oldid='c'*64;newid='d'*64;restoredid='e'*64;oldimage='sha256:'+'1'*64;newimage='sha256:'+'2'*64
 credentials={'duoId':'synthetic-test','accounts':[{'role':role,'name':'Synthetic '+role,'phone':phone,'passwordHash':'scrypt:'+'3'*32+':'+'4'*128} for role,phone in [('husband','0390000001'),('wife','0390000002')]]}
 environment={'MONGODB_URI':'mongodb://mongo:27017/ielts_ai','APP_ORIGIN':m.ORIGIN,'DUO_ENABLED':'true','DUO_CREDENTIALS_FILE':'','DUO_ACCOUNTS_JSON':json.dumps(credentials,ensure_ascii=False,separators=(',',':')),'OPENAI_API_KEY':secret}
 if scenario=='upgrade-newline-env':environment['OPENAI_API_KEY']=secret+'\nINJECTED_UNSAFE=yes'
 if upgrade:environment.update({'CONTENT_MODEL':'gpt-4o','SCORING_MODEL':'gpt-4o','EXTRACTOR_MODEL':'gpt-4o'})
 if preserved:
  explicit={role:'gpt-6.1-sol' for role in m.TEXT_MODEL_ROLES} if scenario=='ordinary-success-previous-model-upgrade' else {'CONTENT_MODEL':'gpt-4o','SCORING_MODEL':'gpt-4.1','EXTRACTOR_MODEL':'gpt-4.1','TRANSLATION_MODEL':'gpt-4o-mini'}
  environment.update(explicit)
  (private/'app.env').write_text('OPENAI_API_KEY='+secret+'\n'+''.join(role+'=gpt-4o\n' for role in m.TEXT_MODEL_ROLES))
  release.write_text('services:\n  app:\n    environment:\n'+''.join('      '+role+': '+value+'\n' for role,value in explicit.items()))
  original_override=release.read_bytes()
 networks={project+'_web':{'NetworkID':'5'*64},project+'_database':{'NetworkID':'6'*64}}
 def row(identifier,service,image=oldimage,values=None):
  selected=environment if values is None else values
  return {'Id':identifier,'Image':image,'Config':{'Env':[key+'='+value for key,value in selected.items()]+['NODE_VERSION=24.21.0'],'Labels':{'com.docker.compose.project':project,'com.docker.compose.service':service,'com.docker.compose.project.working_dir':str(m.LIVE_DIR/'deploy')}},
  'State':{'Running':True,'Health':{'Status':'healthy'}},'HostConfig':{'Memory':512*1048576},'NetworkSettings':{'Networks':{key:copy.deepcopy(value) for key,value in networks.items() if service=='app' or key.endswith('_'+('database' if service=='mongo' else 'web'))}}}
 state={'app':row(oldid,'app'),'mongo':row('7'*64,'mongo'),'proxy':row('8'*64,'proxy'),'worker':{'id':'9'*64,'running':False}}
 original=copy.deepcopy(state);calls=[];logs=[];budgets=[];switches=[];probe_files=[];probe_state={'id':'f'*64,'exists':False}
 real_owned=m.owned
 def owned(path,directory=False,private=False):
  info=path.lstat();assert path.resolve(strict=True)==path and not stat.S_ISLNK(info.st_mode)
  assert stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
  assert not private or not info.st_mode&0o077
  return info
 m.owned=owned
 current={'name':project,'services':{'app':{'image':'old-app:release','build':{'context':str(m.LIVE_DIR),'dockerfile':'Dockerfile'},'environment':copy.deepcopy(environment),'mem_limit':512*1048576},'mongo':{'image':'mongo:unchanged'},'proxy':{'image':'nginx:unchanged'}}}
 def configuration(override,unresolved):
  result=copy.deepcopy(current)
  if override and override.name=='release.compose.new' or override and override==release and release.read_bytes()!=original_override:
   text=override.read_text();result['services']['app']['image']=re.search(r'    image: (.+)',text)[1]
   result['services']['app']['build']={'context':re.search(r'      context: (.+)',text)[1],'dockerfile':'deploy/Dockerfile.release'}
   if upgrade or preserved:
    if preserved:
     for role in m.TEXT_MODEL_ROLES:result['services']['app']['environment'][role]='gpt-4o'
    for role in m.TEXT_MODEL_ROLES:
     match=re.search(r'(?m)^      '+role+r': (.+)$',text)
     assert match, 'Missing explicit candidate model '+role
     result['services']['app']['environment'][role]=match[1].strip("\"'")
    if scenario=='upgrade-foreign-env':result['services']['app']['environment']['DEMO_ENABLED']='true'
    if scenario=='upgrade-provider-env':result['services']['app']['environment']['OPENAI_API_KEY']='changed-private-key'
    if scenario=='upgrade-audio-env':result['services']['app']['environment']['SPEAKING_AUDIO_MODEL']='gpt-6.1-sol'
    if scenario=='upgrade-wrong-target':result['services']['app']['environment']['SCORING_MODEL']='gpt-4o'
    if scenario=='upgrade-missing-model':del result['services']['app']['environment']['TRANSLATION_MODEL']
   if scenario=='foreign-compose':result['services']['mongo']['image']='foreign-image'
   if scenario=='changed-credentials':result['services']['app']['environment']['DUO_ACCOUNTS_JSON']=json.dumps({'private':secret})
  if unresolved:result['services']['app']['env_file']=[{'path':str(private/'app.env')}]
  return result
 def command(args,timeout=60):
  calls.append(args)
  if args[:2]==['docker','ps']:
   if any(value.startswith('name=^/') for value in args):
    assert any(value.startswith('name=^/'+project+'-model-probe-') and value.endswith('$') for value in args)
    return probe_state['id'] if probe_state['exists'] else ''
   service=next(x.split('=',2)[-1] for x in args if x.startswith('label=com.docker.compose.service='));return state[service]['Id']
  if args[:2]==['docker','run'] and m.TEXT_MODEL_PROBE in args:
   assert upgrade and timeout==240 and args[-6:]==[oldimage,'--import','tsx','--input-type=module','-e',m.TEXT_MODEL_PROBE]
   assert '--rm' in args and '--memory=512m' in args and '--memory-swap=512m' in args and '--cpus=0.5' in args
   assert '--pids-limit=64' in args and '--read-only' in args and '--cap-drop=ALL' in args and '--user=node' in args and '--entrypoint=node' in args
   assert '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m' in args and '--security-opt=no-new-privileges:true' in args
   assert args[args.index('--network')+1]==project+'_web'
   assert not any(x in args for x in ('--mount','--volume','-v','--network=host','-p','--publish'))
   name=args[args.index('--name')+1];assert re.fullmatch(re.escape(project)+r'-model-probe-[a-f0-9]+',name)
   labels=dict(args[index+1].split('=',1) for index,value in enumerate(args) if value=='--label')
   probe_state.update({'name':name,'labels':labels})
   assert labels=={'com.websiteieltsai.project':project,'com.websiteieltsai.kind':'model-probe','com.websiteieltsai.operation-id':name.split('-model-probe-',1)[1]}
   env_path=pathlib.Path(args[args.index('--env-file')+1]);probe_files.append(env_path)
   assert env_path.name=='model-probe.env' and private/'app-updates' in env_path.parents
   assert env_path.stat().st_mode&0o777==0o600 and not env_path.is_symlink()
   probe_env=dict(line.split('=',1) for line in env_path.read_text().splitlines())
   allowed={'IELTS_OPENAI_API_KEY','OPENAI_API_KEY','APP_ORIGIN','NODE_ENV','DUO_ENABLED','DUO_CREDENTIALS_FILE','DUO_ACCOUNTS_JSON'}
   assert set(probe_env)<=allowed and probe_env['OPENAI_API_KEY']==secret and probe_env['DUO_ACCOUNTS_JSON']==environment['DUO_ACCOUNTS_JSON']
   assert state['app']['Id']==oldid and 'build' not in logs and budgets and all(value==512 for value in budgets)
   assert secret not in json.dumps(args)
   if scenario in ('upgrade-success-probe-auto-removed','upgrade-success-probe-rm-race'):probe_state['exists']=True
   if scenario=='upgrade-failed-probe':return json.dumps({'ok':False,'model':m.TEXT_MODEL,'code':'model-unavailable','httpStatus':404})
   if scenario=='upgrade-denied-probe':return json.dumps({'ok':False,'model':m.TEXT_MODEL,'code':'model-denied','httpStatus':403})
   if scenario=='upgrade-malformed-probe':return json.dumps({'ok':True,'model':m.TEXT_MODEL,'private':secret})
   if scenario=='upgrade-nonjson-probe':return secret
   if scenario=='upgrade-oversized-probe':return secret*1000
   if scenario=='upgrade-command-error':raise RuntimeError(secret)
   if scenario in ('upgrade-timeout-probe-cleaned','upgrade-timeout-probe-foreign'):
    probe_state['exists']=True
    raise subprocess.TimeoutExpired(args,timeout)
   return json.dumps({'ok':True,'model':m.TEXT_MODEL})
  if args[:2]==['docker','inspect']:
   assert args[-1]==probe_state['id'] and timeout==20 and args[2]=='--format'
   if scenario=='upgrade-success-probe-auto-removed':
    probe_state['exists']=False
    raise RuntimeError(secret)
   labels=copy.deepcopy(probe_state['labels'])
   if scenario=='upgrade-timeout-probe-foreign':labels['com.websiteieltsai.project']='foreign-project'
   return json.dumps({'Id':probe_state['id'],'Image':oldimage,'Name':'/'+probe_state['name'],'Labels':labels})
  if args[:2]==['docker','rm']:
   assert scenario in ('upgrade-timeout-probe-cleaned','upgrade-success-probe-rm-race') and args==['docker','rm','--force',probe_state['id']] and timeout==30
   probe_state['exists']=False
   if scenario=='upgrade-success-probe-rm-race':raise RuntimeError(secret)
   return ''
  if args[:3]==['docker','image','inspect']:
   if args[-1]=='old-app:release':return oldimage
   return newimage
  if args[:3]==['docker','network','inspect']:
   name=args[-1];kind='database' if name.endswith('_database') else 'web';return json.dumps([{'Name':name,'Id':networks[name]['NetworkID'],'Internal':kind=='database','Labels':{'com.docker.compose.project':'foreign' if scenario=='foreign-network' else project,'com.docker.compose.network':kind}}])
  if args[:2]==['docker','compose']:
   paths=[pathlib.Path(args[i+1]) for i,x in enumerate(args) if x=='-f'];return json.dumps(configuration(paths[-1], '--no-env-resolution' in args))
  if args[:2]==['docker','info']:return str(root) if args[-1]=='{{.DockerRootDir}}' else 'true true true true'
  if args[:2]==['nginx','-t']:return ''
  if args[:2]==['nginx','-T']:return '# configuration file '+str(gateway)+':\n'
  if args[0]=='systemctl':return '42'
  if args[:2]==['docker','run']:
   assert '--network=none' in args and '--memory=512m' in args and '--memory-swap=512m' in args and '--cpus=0.5' in args
   assert not any(x in args for x in ('--mount','--volume','-v'))
   if scenario=='changed-bank' and newimage in args:return 'f'*64+'\n'
   return '0'*64+'\n'
  raise AssertionError('Unexpected command '+repr(args))
 def verify_container(row,project,service):
  assert row['Config']['Labels']['com.docker.compose.project']==project and row['Config']['Labels']['com.docker.compose.service']==service and row['State']['Running']
 def inspect(identifier):return copy.deepcopy(next(x for key,x in state.items() if key!='worker' and x['Id']==identifier))
 def env_values(entries):return dict(x.split('=',1) for x in entries)
 def memory(budget):
  budgets.append(budget)
  if scenario=='low-memory' or scenario=='low-memory-before-switch' and len(budgets)>=5 or scenario=='upgrade-low-memory-before-probe' and len(budgets)>=2 or scenario=='upgrade-low-memory-before-switch' and len(budgets)>=6:raise RuntimeError('Insufficient memory')
 def snapshot(exclude):return {key:copy.deepcopy(value) for key,value in state.items() if key!='app' or value['Id']!=exclude}
 guards=types.SimpleNamespace(LIVE_DIR=m.LIVE_DIR,read_project=lambda path:project,command=command,inspect=inspect,verify_container=verify_container,env_values=env_values,memory_headroom=memory,running_snapshot=snapshot,listener_snapshot=lambda:[('127.0.0.1:19088','0.0.0.0:*')])
 def health(tls=False):
  return {'ok':not(scenario in ('unhealthy-replacement','rollback-failed','upgrade-unhealthy-replacement') and state['app']['Image']==newimage) and scenario!='unhealthy-original'}
 diagnostic=types.SimpleNamespace(LIVE_DIR=m.LIVE_DIR,health=health)
 def download(url,digest,path,limit):
  assert url.endswith(commit) and digest==archive
  with tarfile.open(path,'w:gz') as bundle:
   for name in ['deploy/Dockerfile.release','.dockerignore']:
    data=b'public source\n';info=tarfile.TarInfo('websiteIeltsAi-'+commit+'/'+name);info.size=len(data);bundle.addfile(info,io.BytesIO(data))
 m.download=download
 def run_logged(args,audit,label,timeout=1800,environment=None):
  logs.append(label);assert secret not in json.dumps(args)
  if label=='build':
   assert state['app']['Id']==oldid and '--memory=512m' in args and '--memory-swap=512m' in args and '--cpu-quota=50000' in args and environment['DOCKER_BUILDKIT']=='0'
   if scenario=='build-failed':raise RuntimeError('Synthetic bounded build failed')
   if scenario=='concurrent-config':gateway.write_text('changed concurrently\n')
   return
  assert args[-8:]==['up','-d','--no-deps','--no-build','--wait','--wait-timeout','240','app']
  switches.append(label)
  if label=='start-app':
   selected=configuration(release,False)['services']['app']['environment'] if upgrade or preserved else environment
   if scenario=='upgrade-wrong-runtime-model':selected['SCORING_MODEL']='gpt-4o'
   if scenario=='upgrade-wrong-runtime-provider':selected['OPENAI_API_KEY']='changed-private-key'
   state['app']=row(newid,'app',newimage,selected)
   if scenario=='switch-failed':raise RuntimeError('Synthetic start failed after recreation')
   if scenario=='foreign-release-after-switch':release.write_text('foreign override\n');raise RuntimeError('Concurrent override')
  else:
   assert label=='restore-app' and release.read_bytes()==original_override
   if scenario=='rollback-failed':raise RuntimeError('Synthetic rollback failed')
   state['app']=row(restoredid,'app',oldimage)
 m.run_logged=run_logged;m.os.cpu_count=lambda:1000
 m.shutil.disk_usage=lambda path:types.SimpleNamespace(free=20*1024**3)
 output=io.StringIO();failure=None
 with contextlib.redirect_stdout(output):
  try:m.deploy(guards,diagnostic,commit,archive,upgrade_text_models=True) if upgrade else m.deploy(guards,diagnostic,commit,archive)
  except RuntimeError as error:failure=str(error)
 rendered=output.getvalue()+(failure or '')
 assert secret not in rendered
 assert state['mongo']==original['mongo'] and state['proxy']==original['proxy'] and state['worker']==original['worker']
 assert not any(args[0]=='docker' and args[1] in ('stop','restart','start','exec','prune') for args in calls)
 assert not any('bank-upgrade' in str(args) or 'bank-reset' in str(args) for args in calls)
 assert not any(args[:2]==['docker','rm'] for args in calls) or scenario in ('upgrade-timeout-probe-cleaned','upgrade-success-probe-rm-race')
 assert upgrade or not any(m.TEXT_MODEL_PROBE in args for args in calls)
 assert all(not path.exists() for path in probe_files)
 if scenario in ('success','upgrade-success','upgrade-success-probe-auto-removed','upgrade-success-probe-rm-race','ordinary-success-previous-model-upgrade','ordinary-success-legacy-models'):
  assert failure is None and switches==['start-app'] and state['app']['Image']==newimage
  assert release.read_bytes()!=original_override and 'HOÀN TẤT' in rendered
  receipt=json.loads(next((private/'app-updates').glob('*/complete.json')).read_text())
  assert receipt['bankUnchanged'] is True and receipt['onlyAppReplaced'] is True
  if preserved:
   actual=env_values(state['app']['Config']['Env'])
   assert all(actual[role]==value for role,value in explicit.items())
   assert all(actual[key]==value for key,value in environment.items())
   assert not any(m.TEXT_MODEL_PROBE in args for args in calls)
  if upgrade:
   actual=env_values(state['app']['Config']['Env'])
   assert all(actual[role]==m.TEXT_MODEL for role in m.TEXT_MODEL_ROLES)
   assert all(actual[key]==value for key,value in environment.items() if key not in m.TEXT_MODEL_ROLES)
   assert actual['OPENAI_API_KEY']==secret and 'TRANSLATION_MODEL' not in environment
   assert all(budget==512 for budget in budgets)
   assert len([args for args in calls if m.TEXT_MODEL_PROBE in args])==1
 elif scenario in ('unhealthy-replacement','switch-failed','upgrade-unhealthy-replacement','upgrade-wrong-runtime-model','upgrade-wrong-runtime-provider'):
  assert failure and 'đã phục hồi app cũ healthy' in failure and switches==['start-app','restore-app']
  assert state['app']['Image']==oldimage and release.read_bytes()==original_override
  if upgrade:assert env_values(state['app']['Config']['Env'])==env_values(original['app']['Config']['Env'])
 elif scenario=='foreign-release-after-switch':
  assert failure and 'chưa xác nhận phục hồi' in failure and switches==['start-app'] and release.read_text()=='foreign override\n'
 elif scenario=='rollback-failed':
  assert failure and 'chưa xác nhận phục hồi' in failure and switches==['start-app','restore-app']
 else:
  assert failure and not switches and state['app']==original['app'] and release.read_bytes()==original_override
 if scenario in ('upgrade-failed-probe','upgrade-denied-probe','upgrade-malformed-probe','upgrade-nonjson-probe','upgrade-oversized-probe','upgrade-command-error','upgrade-low-memory-before-probe','upgrade-timeout-probe-cleaned','upgrade-timeout-probe-foreign','upgrade-newline-env'):assert 'build' not in logs and not switches
 if scenario=='upgrade-timeout-probe-cleaned':assert not probe_state['exists'] and len([args for args in calls if args[:2]==['docker','rm']])==1
 if scenario in ('upgrade-success-probe-auto-removed','upgrade-success-probe-rm-race'):assert not probe_state['exists']
 if scenario=='upgrade-timeout-probe-foreign':assert probe_state['exists'] and not any(args[:2]==['docker','rm'] for args in calls)
 print(json.dumps({'scenario':scenario,'switches':switches,'budgets':budgets}))
`;

for (const scenario of ["success", "ordinary-success-previous-model-upgrade", "ordinary-success-legacy-models", "low-memory", "low-memory-before-switch", "unhealthy-original", "foreign-network", "build-failed", "changed-bank", "foreign-compose", "changed-credentials", "concurrent-config", "switch-failed", "unhealthy-replacement", "foreign-release-after-switch", "rollback-failed", "upgrade-success", "upgrade-success-probe-auto-removed", "upgrade-success-probe-rm-race", "upgrade-failed-probe", "upgrade-denied-probe", "upgrade-malformed-probe", "upgrade-nonjson-probe", "upgrade-oversized-probe", "upgrade-command-error", "upgrade-timeout-probe-cleaned", "upgrade-timeout-probe-foreign", "upgrade-newline-env", "upgrade-low-memory-before-probe", "upgrade-low-memory-before-switch", "upgrade-foreign-env", "upgrade-provider-env", "upgrade-audio-env", "upgrade-wrong-target", "upgrade-missing-model", "upgrade-wrong-runtime-model", "upgrade-wrong-runtime-provider", "upgrade-unhealthy-replacement"]) {
  test(`app-only deployment: ${scenario}`, () => {
    const result = spawnSync("python3", ["-c", fixture, script, scenario], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).scenario, scenario);
  });
}

test("app-only archive rejects links and escaping paths before extraction", () => {
  const check = String.raw`
import importlib.util,io,pathlib,sys,tarfile,tempfile
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('operator',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
commit='a'*40
with tempfile.TemporaryDirectory() as folder:
 root=pathlib.Path(folder)
 for index,name in enumerate(['websiteIeltsAi-'+commit+'/../escape','/absolute','other-'+commit+'/file','websiteIeltsAi-'+commit+'/link']):
  archive=root/(str(index)+'.tar.gz');destination=root/('dest'+str(index));destination.mkdir()
  with tarfile.open(archive,'w:gz') as bundle:
   item=tarfile.TarInfo(name)
   if name.endswith('/link'):item.type=tarfile.SYMTYPE;item.linkname='/etc/passwd'
   bundle.addfile(item,io.BytesIO())
  try:m.extract_source(archive,destination,commit)
  except RuntimeError:pass
  else:raise AssertionError('Unsafe archive accepted')
  assert not list(destination.iterdir())
`;
  const result = spawnSync("python3", ["-c", check, script], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("app-only downloads reject wrong hashes and redirected hosts", () => {
  const check = String.raw`
import hashlib,importlib.util,pathlib,sys,tempfile,types
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('operator',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
data=b'synthetic public source';url='https://raw.githubusercontent.com/owner/repo/commit/file';digest=hashlib.sha256(data).hexdigest()
class Response:
 status=200
 def __init__(self,actual):self.url=actual
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self,limit):return data[:limit]
with tempfile.TemporaryDirectory() as folder:
 for index,(actual,checksum,limit) in enumerate([(url,'0'*64,1024),('https://foreign.example/file',digest,1024),('http://raw.githubusercontent.com/file',digest,1024),(url,digest,3)]):
  path=pathlib.Path(folder)/str(index);m.urllib.request.urlopen=lambda *args,**kwargs:Response(actual)
  try:m.download(url,checksum,path,limit)
  except RuntimeError:pass
  else:raise AssertionError('Untrusted download accepted')
  assert not path.exists()
 path=pathlib.Path(folder)/'good';m.urllib.request.urlopen=lambda *args,**kwargs:Response(url);m.download(url,digest,path,1024);assert path.read_bytes()==data
`;
  const result = spawnSync("python3", ["-c", check, script], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("text model migration permits only the four fixed target roles", () => {
  const check = String.raw`
import copy,importlib.util,json,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('operator',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
private='SYNTHETIC_PRIVATE_NEVER_PRINT'
credentials={'duoId':'synthetic-test','accounts':[{'role':role,'name':'Synthetic '+role,'phone':phone,'passwordHash':'scrypt:'+'3'*32+':'+'4'*128} for role,phone in [('husband','0390000001'),('wife','0390000002')]]}
values={'OPENAI_API_KEY':private,'DUO_ACCOUNTS_JSON':json.dumps(credentials),'CONTENT_MODEL':'gpt-4o','SCORING_MODEL':'gpt-4o','EXTRACTOR_MODEL':'gpt-4o'}
current={'services':{'app':{'image':'old:release','build':{'context':'/old','dockerfile':'Dockerfile'},'environment':copy.deepcopy(values),'mem_limit':512*1048576},'mongo':{'image':'unchanged'}}}
proposed=copy.deepcopy(current);proposed['services']['app'].update({'image':'new:release','build':{'context':'/new','dockerfile':'deploy/Dockerfile.release'}})
for key in m.TEXT_MODEL_ROLES:proposed['services']['app']['environment'][key]=m.TEXT_MODEL
m.validate_config(current,proposed,values,512*1048576,upgrade_text_models=True)

def refuses(before,after,actual=values,upgrade=True):
 try:m.validate_config(before,after,actual,512*1048576,upgrade_text_models=upgrade)
 except RuntimeError as error:assert private not in str(error)
 else:raise AssertionError('Unapproved Compose change accepted')

refuses(current,proposed,upgrade=False)
for target in ('OPENAI_API_KEY','SPEAKING_AUDIO_MODEL','TRANSCRIPTION_MODEL','MONGODB_URI','APP_ORIGIN','UNEXPECTED_NEW_OPTION'):
 changed=copy.deepcopy(proposed);changed['services']['app']['environment'][target]='changed';refuses(current,changed)
for role in m.TEXT_MODEL_ROLES:
 changed=copy.deepcopy(proposed);changed['services']['app']['environment'][role]='gpt-4o';refuses(current,changed)
 changed=copy.deepcopy(proposed);del changed['services']['app']['environment'][role];refuses(current,changed)
for target in ('OPENAI_API_KEY','SCORING_MODEL'):
 changed=copy.deepcopy(values);changed[target]='concurrent-different-value';refuses(current,proposed,changed)
changed=copy.deepcopy(proposed);changed['services']['mongo']['image']='foreign';refuses(current,changed)
changed=copy.deepcopy(proposed);changed['services']['app']['mem_limit']=256*1048576;refuses(current,changed)
changed=copy.deepcopy(proposed);del changed['services']['app']['environment']['OPENAI_API_KEY'];refuses(current,changed)
`;
  const result = spawnSync("python3", ["-c", check, script], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("model migration CLI accepts only the explicit upgrade flag", () => {
  const check = String.raw`
import importlib.util,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('operator',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
commit='a'*40;archive='b'*64;calls=[];downloads=[]
m.os.geteuid=lambda:0
m.download=lambda *args:downloads.append(args)
m.checked_module=lambda path,name:('synthetic-module',name)
def deploy(guards,diagnostic,selected,checksum,upgrade_text_models=False):
 assert selected==commit and checksum==archive
 calls.append(upgrade_text_models)
m.deploy=deploy
for extra,expected in [([],False),(['--upgrade-text-models'],True)]:
 m.sys.argv=['update-app.py',commit,archive]+extra;m.main()
 assert calls[-1] is expected
assert len(downloads)==4
for extra in [['--force'],['--upgrade-text-models=gpt-6.1-sol'],['--upgrade-text-models','--force'],['--upgrade-text-models','--upgrade-text-models']]:
 before=len(downloads);m.sys.argv=['update-app.py',commit,archive]+extra
 try:m.main()
 except RuntimeError:pass
 else:raise AssertionError('Unapproved option accepted')
 assert len(downloads)==before and len(calls)==2
`;
  const result = spawnSync("python3", ["-c", check, script], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

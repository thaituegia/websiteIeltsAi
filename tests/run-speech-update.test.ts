import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../deploy/run-speech-update.py", import.meta.url));
const guardsScript = fileURLToPath(new URL("../deploy/set-duo-band-3.py", import.meta.url));

// The real operator and guard functions execute, but every Docker/updater call,
// download, diagnostic and health request uses a synthetic in-memory fixture.
// This never starts containers or contacts a VPS, database or speech provider.
const fixture = String.raw`
import contextlib, copy, hashlib, importlib.util, io, json, os, pathlib, stat, subprocess, sys, tempfile, types
sys.dont_write_bytecode=True
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
m=load(sys.argv[1],'speech_update_operator');guards=load(sys.argv[2],'real_deployment_guards')
scenario=sys.argv[3];secret='SYNTHETIC_SECRET_MUST_NEVER_PRINT';commit='a'*40;archive='b'*64
assert m.GUARDS_SHA=='179cf2d406b60fe74a0ac9e0e33676fb6f2e54d3e9b52d1858405d3b3dea2812'
assert m.UPDATE_ENTRY_SHA=='cdfe535df91f950d83e3158527bbbd2cc58cd2a5a05e8275b11a452be068badb'
assert m.RESET_COMPAT_SHA=='7751527ca73606d49746818af9922401bae036aab23ce60d84ba1f552a3a5a2a'
assert m.UPDATER_SHA=='5400f1a934c03665e6ff5901c4c2cb36209003a60d65c778d2001c1567cda9fb'
with tempfile.TemporaryDirectory(prefix='ielts-speech-update-test-') as folder:
 root=pathlib.Path(folder);guards.LIVE_DIR=root/'live';private=guards.LIVE_DIR/'.local/deploy';private.mkdir(parents=True,mode=0o700)
 project='website-ielts-ai-synthetic-recovery';config=private/'deploy.env';config.write_text('IELTS_COMPOSE_PROJECT='+project+'\n');config.chmod(0o600)
 def private_file(path):
  metadata=path.lstat();assert stat.S_ISREG(metadata.st_mode) and not metadata.st_mode&0o077
 guards.private_file=private_file
 budgets=[];guards.memory_headroom=lambda budget:budgets.append(budget)
 guards.listener_snapshot=lambda:[('127.0.0.1:19088','0.0.0.0:*')]
 name='ielts-speech-prewarm-'+hashlib.sha256(project.encode()).hexdigest()[:16]
 image='sha256:'+'f'*64;web=project+'_web';database=project+'_database'
 networks={web:{'NetworkID':'1'*64},database:{'NetworkID':'2'*64}}
 appid='c'*64;oldid='d'*64;newappid='e'*64;newworkerid='9'*64
 def row(identifier,label,service=None):
  labels={'ielts.speech.project':project,'ielts.speech.kind':'prewarm','ielts.speech.owner':str(guards.LIVE_DIR),'ielts.speech.commit':'f'*40}
  if service:labels={'com.docker.compose.project':project,'com.docker.compose.service':service,'com.docker.compose.project.working_dir':str(guards.LIVE_DIR/'deploy')}
  ports={'3001/tcp':[{'HostIp':'127.0.0.1','HostPort':'19088'}]} if service=='app' else {}
  return {'Id':identifier,'Name':'/'+label,'Image':image,'RestartCount':0,
   'Config':{'Labels':labels,'Env':['MONGODB_URI=mongodb://mongo:27017/ielts_ai','APP_ORIGIN=https://sutonghanyu.vn','DUO_ENABLED=true','DUO_CREDENTIALS_FILE=','DUO_ACCOUNTS_JSON='+json.dumps({'private':secret}),'OPENAI_API_KEY='+secret]},
   'State':{'Running':True,'Restarting':False,'Status':'running','StartedAt':'2026-10-13T01:01:01Z','Pid':42,'Health':{'Status':'healthy','Log':[{'Output':secret}]}},
   'HostConfig':{'Memory':384*1048576,'MemorySwap':384*1048576,'PortBindings':copy.deepcopy(ports),'PublishAllPorts':False},
   'NetworkSettings':{'Networks':copy.deepcopy(networks),'Ports':copy.deepcopy(ports)}}
 state={'app':row(appid,'app','app'),'worker':row(oldid,name),'other':row('0'*64,'unrelated','other')}
 if scenario=='foreign-worker-owner':state['worker']['Config']['Labels']['ielts.speech.owner']='/other-installation'
 if scenario=='foreign-app-owner':state['app']['Config']['Labels']['com.docker.compose.project.working_dir']='/other-installation/deploy'
 if scenario=='worker-image':state['worker']['Image']='sha256:'+'0'*64
 if scenario=='worker-network':state['worker']['NetworkSettings']['Networks'][web]['NetworkID']='3'*64
 if scenario=='worker-runtime-port':state['worker']['NetworkSettings']['Ports']={'3001/tcp':[{'HostIp':'0.0.0.0','HostPort':'19089'}]}
 if scenario=='worker-configured-port':state['worker']['HostConfig']['PortBindings']={'3001/tcp':[{'HostIp':'127.0.0.1','HostPort':'19089'}]}
 if scenario=='worker-commit':state['worker']['Config']['Labels']['ielts.speech.commit']='main'
 if scenario=='worker-name':state['worker']['Name']='/foreign-worker'
 if scenario=='originally-stopped':state['worker']['State'].update(Running=False,Status='exited')
 if scenario=='missing-worker':del state['worker']
 original=copy.deepcopy(state);calls=[];events=[];diagnostics=[];downloads=[];download_paths=[];worker_inspections=0;healthcalls=[]
 def synthetic_run(args,**kwargs):
  global worker_inspections
  calls.append(list(args));events.append(args[0]+':'+args[1])
  if args[0]=='bash':
   assert args[2:]==[str(guards.LIVE_DIR),commit,archive,m.RESET_COMPAT_SHA,m.UPDATER_SHA]
   assert [x[0] for x in downloads]==['set-duo-band-3.py','diagnose-listening.py','run-exam-update.sh']
   if scenario=='updater-exception':raise OSError(secret)
   if scenario in ('new-app-invalid-old-worker','same-image-recreated-app'):
    state['app']['Id']=newappid
    if scenario=='new-app-invalid-old-worker':state['app']['Image']='sha256:'+'8'*64
    return subprocess.CompletedProcess(args,19,'','')
   if scenario=='updater-failed-network-changed':
    state['app']['NetworkSettings']['Networks'][web]['NetworkID']='4'*64
    return subprocess.CompletedProcess(args,19,'','')
   if scenario=='updater-failed-unhealthy':state['app']['State']['Health']['Status']='unhealthy'
   if scenario=='updater-failed-not-running':state['app']['State'].update(Running=False,Status='exited')
   if scenario in ('updater-failed-safe','originally-stopped','updater-failed-unhealthy','updater-failed-not-running','updater-failed-http-health','app-changed-during-recovery'):
    return subprocess.CompletedProcess(args,19,'','')
   state['app']['Id']=newappid;state['app']['Image']='sha256:'+'8'*64
   return subprocess.CompletedProcess(args,0,'','')
  assert args[0]=='docker','Unexpected external command: '+args[0]
  action=args[1];output=''
  if action=='ps':
   if '--filter' in args:
    if any(x.startswith('name=') for x in args):
     assert args==['docker','ps','-aq','--no-trunc','--filter','name=^/'+name+'$']
     output=state.get('worker',{}).get('Id','')
    else:
     assert 'label=com.docker.compose.project='+project in args and 'label=com.docker.compose.service=app' in args
     output=state['app']['Id'] if state['app']['State']['Running'] else ''
   else:output='\n'.join(x['Id'] for x in state.values() if x['State']['Running'])
  elif action=='inspect':
   selected=[next(x for x in state.values() if x['Id']==identifier) for identifier in args[2:]]
   if args[2:]==[oldid]:
    worker_inspections+=1
    if scenario=='poststopinspect-oncefails' and worker_inspections==3:
     return subprocess.CompletedProcess(args,1,'',secret)
    if scenario=='worker-changed-before-stop' and worker_inspections==2:
     state['worker']['Config']['Labels']['ielts.speech.owner']='/other-installation';selected=[state['worker']]
   output=json.dumps(selected)
  elif action=='network' and args[2]=='inspect':
   network=args[3];output=json.dumps([{'Name':network,'Id':state['app']['NetworkSettings']['Networks'][network]['NetworkID'],'Internal':network==database}])
  elif action=='stop':
   assert args==['docker','stop','--time=30',oldid]
   if scenario=='stop-failed-still-running':raise subprocess.TimeoutExpired(args,45,output=secret,stderr=secret)
   state['worker']['State'].update(Running=False,Restarting=False,Status='exited');output=oldid
   if scenario=='stop-completed-timeout-foreign-worker':state['worker']['Config']['Labels']['ielts.speech.owner']='/other-installation'
   if scenario=='stop-completed-timeout-appchanged':state['app']['Id']=newappid
   if scenario.startswith('stop-completed-timeout'):raise subprocess.TimeoutExpired(args,45,output=secret,stderr=secret)
  elif action=='rm':
   assert args==['docker','rm',oldid] and not state['worker']['State']['Running'];del state['worker'];output=oldid
  elif action=='create':
   assert '--no-healthcheck' in args and '--memory=384m' in args and '--memory-swap=384m' in args
   assert '--cpus=0.25' in args and '--pids-limit=64' in args and '--read-only' in args
   assert '--max-clips' in args and args[args.index('--max-clips')+1]=='32'
   assert '--max-retries' in args and args[args.index('--max-retries')+1]=='3'
   assert not any(x in args for x in ('--force','--seed','--reset','--resume','--resume-quota','--publish','-p'))
   state['worker']=row(newworkerid,name);state['worker']['Image']=args[args.index('--entrypoint=node')+1]
   state['worker']['Config']['Labels']['ielts.speech.commit']=commit
   state['worker']['NetworkSettings']['Networks']={web:copy.deepcopy(networks[web])}
   state['worker']['State'].update(Running=False,Status='created');output=newworkerid
  elif action=='network' and args[2]=='connect':
   assert args==['docker','network','connect',database,newworkerid]
   state['worker']['NetworkSettings']['Networks'][database]=copy.deepcopy(networks[database])
  elif action=='start':
   assert args[2] in (oldid,newworkerid)
   worker=state['worker'];assert worker['Id']==args[2]
   worker['State'].update(Running=True,Status='running');output=args[2]
   if scenario=='post-start-app-unhealthy' and args[2]==newworkerid:state['app']['State']['Health']['Status']='unhealthy'
  else:raise AssertionError('Unexpected Docker action '+repr(args))
  return subprocess.CompletedProcess(args,0,output,'')
 m.subprocess.run=synthetic_run
 def diagnostic_report():
  diagnostics.append('read-only');events.append('diagnostic')
  assert not any(x[0]=='docker' and x[1]=='logs' for x in calls)
  return {'mode':'read-only','health':{'directApp':{'ok':True},'localDomainTLS':{'ok':True}},'logs':{'workerProgress':{'total':432,'ready':7,'failed':1,'lastErrorCode':'storage'}}}
 def health(tls=False):
  healthcalls.append((tls,any(x[:2]==['docker','start'] and x[2]==newworkerid for x in calls)))
  if scenario=='app-changed-during-recovery' and any(x[0]=='bash' for x in calls) and tls:state['app']['Id']=newappid
  return {'ok':not (scenario=='updater-failed-http-health' and any(x[0]=='bash' for x in calls)) and not (scenario=='post-start-http-health' and healthcalls[-1][1])}
 diagnostic=types.SimpleNamespace(LIVE_DIR=guards.LIVE_DIR,diagnose=diagnostic_report,health=health)
 def download(selected_commit,filename,digest,scratch):
  assert selected_commit==commit and len(digest)==64
  downloads.append((filename,digest));path=scratch/filename;download_paths.append(path);path.write_text('public synthetic checked source\n');return path
 m.download=download;m.checked_module=lambda path,module:guards if path.name=='set-duo-band-3.py' else diagnostic
 m.os.geteuid=lambda:0;sys.argv=[sys.argv[1],commit,archive]
 output=io.StringIO();error=io.StringIO();failure=None
 with contextlib.redirect_stdout(output),contextlib.redirect_stderr(error):
  try:m.main()
  except RuntimeError as caught:failure=str(caught)
 rendered=output.getvalue()+error.getvalue()+(failure or '')
 assert secret not in rendered and secret not in json.dumps(calls)
 assert events[0]=='diagnostic' and events[-1]=='diagnostic' and diagnostics==['read-only','read-only']
 assert state['other']==original['other']
 assert not any(x[0] in ('nginx','systemctl','curl') or x[0]=='docker' and x[1] in ('run','exec','restart','prune') for x in calls)
 stops=[x for x in calls if x[:2]==['docker','stop']];starts=[x for x in calls if x[:2]==['docker','start']]
 updates=[x for x in calls if x[0]=='bash'];creates=[x for x in calls if x[:2]==['docker','create']]
 success=scenario in ('success','missing-worker')
 if success:
  assert failure is None and 'ĐÃ CẬP NHẬT APP' in rendered
  assert starts==[['docker','start',newworkerid]] and len(updates)==len(creates)==1
  assert stops==([] if scenario=='missing-worker' else [['docker','stop','--time=30',oldid]])
  assert (False,True) in healthcalls and (True,True) in healthcalls
  for path in (private/'speech-prewarm').iterdir():
   assert path.stat().st_mode&0o777==0o600
   assert secret in path.read_text()
 elif scenario in ('updater-failed-safe','updater-exception'):
  assert failure and 'Đã khởi động lại đúng worker cũ' in failure
  assert starts==[['docker','start',oldid]] and stops==[['docker','stop','--time=30',oldid]] and len(updates)==1 and not creates
  assert state['app']==original['app'] and state['worker']['State']['Running']
 elif scenario in ('stop-completed-timeout','poststopinspect-oncefails'):
  assert failure and 'chưa chạy updater' in failure and 'Đã khởi động lại đúng worker cũ' in failure
  assert starts==[['docker','start',oldid]] and stops==[['docker','stop','--time=30',oldid]] and not updates and not creates
  assert state['app']==original['app'] and state['worker']['State']['Running']
 elif scenario=='stop-failed-still-running':
  assert failure and 'chưa chạy updater' in failure and 'không gửi lệnh khởi động lại' in failure
  assert stops==[['docker','stop','--time=30',oldid]] and not starts and not updates and not creates
  assert state==original
 elif scenario in ('stop-completed-timeout-foreign-worker','stop-completed-timeout-appchanged'):
  assert failure and 'chưa chạy updater' in failure and 'không được tự khởi động lại' in failure
  assert stops==[['docker','stop','--time=30',oldid]] and not starts and not updates and not creates
  assert not state['worker']['State']['Running']
 elif scenario in ('post-start-app-unhealthy','post-start-http-health'):
  assert failure and 'ĐÃ CẬP NHẬT APP' not in rendered
  assert starts==[['docker','start',newworkerid]] and len(creates)==1
  if scenario=='post-start-http-health':assert (False,True) in healthcalls
 elif scenario.startswith('updater-failed') or scenario in ('new-app-invalid-old-worker','same-image-recreated-app','app-changed-during-recovery'):
  assert failure and 'không được tự khởi động lại' in failure
  assert stops==[['docker','stop','--time=30',oldid]] and not starts and len(updates)==1 and not creates
  assert not state['worker']['State']['Running']
 elif scenario=='originally-stopped':
  assert failure and 'giữ nguyên trạng thái' in failure
  assert not stops and not starts and len(updates)==1 and not creates
 else:
  assert failure and not stops and not starts and not updates and not creates
 assert all(not path.exists() for path in download_paths)
 print('synthetic fixture passed')
`;

const scenarios = [
  "success", "missing-worker", "updater-failed-safe", "updater-exception", "foreign-worker-owner", "foreign-app-owner",
  "worker-image", "worker-network", "worker-runtime-port", "worker-configured-port", "worker-commit", "worker-name",
  "worker-changed-before-stop", "new-app-invalid-old-worker", "same-image-recreated-app", "updater-failed-network-changed",
  "updater-failed-unhealthy", "updater-failed-not-running", "updater-failed-http-health", "originally-stopped",
  "app-changed-during-recovery", "post-start-app-unhealthy", "post-start-http-health",
  "stop-completed-timeout", "poststopinspect-oncefails", "stop-failed-still-running",
  "stop-completed-timeout-foreign-worker", "stop-completed-timeout-appchanged",
];
for (const scenario of scenarios) {
  test(`Speech update ${scenario} preserves ownership, data and safe worker recovery`, () => {
    const result = spawnSync("python3", ["-B", "-c", fixture, script, guardsScript, scenario], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "synthetic fixture passed");
  });
}

test("Speech update downloads only bounded SHA-verified HTTPS helpers before execution", () => {
  const code = String.raw`
import hashlib, importlib.util, pathlib, sys, tempfile
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('speech_download_guard',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
commit='a'*40;body=b'public checked diagnostic source\n';digest=hashlib.sha256(body).hexdigest()
class Response:
 status=200;url='https://raw.githubusercontent.com/thaituegia/websiteIeltsAi/'+commit+'/deploy/diagnose-listening.py'
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self,bound):assert bound==1024*1024+1;return body
response=Response();calls=[]
def request(url,timeout):
 calls.append((url,timeout));assert url==Response.url and timeout==60;return response
m.urllib.request.urlopen=request
with tempfile.TemporaryDirectory(prefix='ielts-speech-download-test-') as folder:
 root=pathlib.Path(folder);path=m.download(commit,'diagnose-listening.py',digest,root);assert path.read_bytes()==body;path.unlink()
 for mode in ('hash','redirect','size','status'):
  response.url=Response.url;response.status=200;body=b'public checked diagnostic source\n';expected=digest
  if mode=='hash':expected='0'*64
  if mode=='redirect':response.url='http://other.example/diagnose-listening.py'
  if mode=='size':body=b'x'*(1024*1024+1)
  if mode=='status':response.status=302
  try:m.download(commit,'diagnose-listening.py',expected,root);raise AssertionError('Expected download refusal')
  except RuntimeError:pass
  assert not list(root.iterdir())
assert len(calls)==5
print('synthetic download fixture passed')
`;
  const result = spawnSync("python3", ["-B", "-c", code, script], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "synthetic download fixture passed");
});

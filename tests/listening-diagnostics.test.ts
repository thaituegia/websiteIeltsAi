import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../deploy/diagnose-listening.py", import.meta.url));
// Every subprocess is a synthetic Docker executable in a temporary directory.
// The production module gets only a synthetic filesystem and mocked HTTP checks;
// these tests cannot contact a deployment, database, provider or learner account.
const fixture = String.raw`
import copy, hashlib, importlib.util, json, os, pathlib, stat, subprocess, sys, tempfile, types
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('listening_diagnostic',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
secret='SYNTHETIC_SECRET_MUST_NEVER_PRINT'
with tempfile.TemporaryDirectory(prefix='ielts-listening-diagnostic-test-') as folder:
 root=pathlib.Path(folder);m.LIVE_DIR=root/'live';private=m.LIVE_DIR/'.local/deploy';private.mkdir(parents=True,mode=0o700)
 project='website-ielts-ai-synthetic-diagnostic'
 cfg=private/'deploy.env';cfg.write_text('IELTS_COMPOSE_PROJECT='+project+'\nOPENAI_API_KEY='+secret+'\n');cfg.chmod(0o600)
 appenv=private/'app.env';appenv.write_text(secret);appenv.chmod(0o600)
 # Run the actual ownership guards. Only filesystem UIDs are simulated because
 # the fixture process is deliberately not production root; per-path overrides
 # exercise non-root Nginx logs and reject foreign owners without real chown.
 uids={};actual_lstat=pathlib.Path.lstat;actual_fstat=os.fstat
 def synthetic_stat(path,info):
  if path.is_relative_to(root):
   fields=list(info);fields[4]=uids.get(path,0);return os.stat_result(fields)
  return info
 def synthetic_lstat(path,*args,**kwargs):return synthetic_stat(path,actual_lstat(path,*args,**kwargs))
 def synthetic_fstat(fd):return synthetic_stat(pathlib.Path(os.readlink('/proc/self/fd/'+str(fd))),actual_fstat(fd))
 pathlib.Path.lstat=synthetic_lstat;m.os.fstat=synthetic_fstat
 def passwd(name):
  assert name in ('www-data','nginx')
  return types.SimpleNamespace(pw_uid={'www-data':33,'nginx':101}[name])
 m.pwd.getpwnam=passwd
 actual_health=m.health
 m.health=lambda tls=False:{'ok':True,'httpStatus':200,'elapsedMs':1}
 m.host_resources=lambda:{'MemAvailableKiB':1048576}
 image='sha256:'+'f'*64;name='ielts-speech-prewarm-'+hashlib.sha256(project.encode()).hexdigest()[:16]
 state={}
 for index,service in enumerate(('app','mongo','proxy','worker')):
  identifier='abcd'[index]*64
  labels={'com.docker.compose.project':project,'com.docker.compose.service':service,'com.docker.compose.project.working_dir':str(m.LIVE_DIR/'deploy')}
  if service=='worker':labels={'ielts.speech.project':project,'ielts.speech.kind':'prewarm','ielts.speech.owner':str(m.LIVE_DIR),'ielts.speech.commit':'e'*40}
  state[service]={'Id':identifier,'Name':'/'+(name if service=='worker' else service),'Image':image,'Labels':labels,
   'State':{'Status':'running','Running':True,'OOMKilled':service=='app','ExitCode':0,'StartedAt':'2026-10-13T01:01:01Z','Health':{'Status':'healthy','Log':[{'Output':secret} ]},'Error':secret},
   'RestartCount':2,'Memory':384*1048576,'MemorySwap':384*1048576,'NanoCpus':250000000,'CpuQuota':0,'CpuPeriod':0,
   'Networks':{project+'_web':{},project+'_database':{}},
   'Ports':{'3001/tcp':[{'HostIp':'127.0.0.1','HostPort':'19088'}]} if service=='app' else {},
   'ConfiguredPorts':{'3001/tcp':[{'HostIp':'127.0.0.1','HostPort':'19088'}]} if service=='app' else {}}
 statepath=root/'state.json';calls=root/'calls.jsonl';statepath.write_text(json.dumps(state))
 binary=root/'docker'
 binary.write_text('#!'+sys.executable+'\n'+r'''
import json,os,pathlib,sys
p=pathlib.Path(os.environ['IELTS_SYNTHETIC_STATE']);rows=json.loads(p.read_text());args=sys.argv[1:]
with open(os.environ['IELTS_SYNTHETIC_CALLS'],'a') as out:out.write(json.dumps(args)+'\n')
if args[0]=='ps':
 service=next(x.split('=',2)[2] for x in args if x.startswith('label=com.docker.compose.service='))
 print(rows[service]['Id'])
elif args[0]=='inspect':
 assert '.Config.Env' not in args[2]
 assert '.HostConfig.PortBindings' in args[2]
 value=next((x for x in rows.values() if x['Id']==args[-1] or x['Name']=='/'+args[-1]),None)
 if value is None:sys.exit(1)
 print(json.dumps(value))
elif args[0]=='stats':
 for x in rows.values():
  print(json.dumps({'ID':x['Id'][:12],'CPUPerc':'0.25%','MemUsage':'100MiB / 384MiB','MemPerc':'26.04%','PIDs':'7','BlockIO':'12.3MB / 4.5MB','Name':os.environ['IELTS_SYNTHETIC_SECRET']}))
elif args[0]=='logs':
 print('API failure: TypeError '+os.environ['IELTS_SYNTHETIC_SECRET'],file=sys.stderr)
 if args[-1]==rows['worker']['Id']:
  print(json.dumps({'configured':True,'state':'paused','total':432,'ready':7,'pending':424,'failed':1,'lastErrorCode':'quota','private':os.environ['IELTS_SYNTHETIC_SECRET']}))
elif args[0]=='stop':
 assert args[1]=='--time=30' and args[2]==rows['worker']['Id']
 rows['worker']['State']['Running']=False;rows['worker']['State']['Status']='exited';p.write_text(json.dumps(rows));print(args[2])
else:raise AssertionError('Unexpected command '+args[0])
''')
 binary.chmod(0o700)
 os.environ.update(PATH=str(root)+os.pathsep+os.environ['PATH'],IELTS_SYNTHETIC_STATE=str(statepath),IELTS_SYNTHETIC_CALLS=str(calls),IELTS_SYNTHETIC_SECRET=secret)
 scenario=sys.argv[2]
 if scenario.startswith('gateway-') and scenario!='gateway-missing-directory':
  domain=private/('domain-'+hashlib.sha256(m.DOMAIN.encode()).hexdigest()[:12]);domain.mkdir(mode=0o700)
  owner=domain/'owner';owner.write_text('\n'.join([m.DOMAIN,str(m.LIVE_DIR),project])+'\n');owner.chmod(0o600)
  error=domain/'https.error.log';access=domain/'https.access.log'
  error.write_text('2026/10/13 18:01:01 [error] connect() failed (111: Connection refused) while connecting to upstream '+secret+', request: "GET /api/content?private='+secret+' HTTP/1.1"\n'
   '2026/10/13 18:01:02 [error] upstream prematurely closed connection, request: "GET /api/attempts/'+secret+'/listening-audio HTTP/1.1"\n'
   '2026/10/13 18:01:03 [error] upstream timed out, request: "GET /api/content/'+secret+'/listening-audio/readiness HTTP/1.1"\n')
  def access_line(url,status,second):return '198.51.100.77 - '+secret+' [13/Oct/2026:18:01:'+second+' +0000] "GET '+url+' HTTP/1.1" '+str(status)+' 123 "'+secret+'" "'+secret+'"\n'
  access.write_text(access_line('/api/attempts/'+secret+'/listening-audio',502,'04')+
   access_line('/api/content?private='+secret,503,'05')+access_line('/api/placement/'+secret+'/audio',504,'06')+
   access_line('/api/content',200,'07')+secret+' malformed 502\n')
  opened=[];real_open=m.os.open
  def checked_open(path,*args,**kwargs):
   opened.append(pathlib.Path(path))
   if pathlib.Path(path)==error:
    if scenario=='gateway-raced-inode':error.rename(root/'old-error');error.write_text(secret+'\n')
    elif scenario=='gateway-raced-owner':uids[error]=1002
    elif scenario=='gateway-raced-mode':error.chmod(0o666)
   return real_open(path,*args,**kwargs)
  m.os.open=checked_open
 if scenario=='default':
  report=m.diagnose();assert report['containers']['app']['oomKilled'] is True
  assert report['containers']['app']['restarts']==2 and report['usage']['app']['PIDs']=='7'
  assert report['logs']['app']['type-error']==1 and report['logs']['app']['api-failure']==1
  assert report['logs']['workerProgress']=={'configured':True,'state':'paused','total':432,'ready':7,'pending':424,'failed':1,'lastErrorCode':'quota'}
  assert report['health']['localDomainTLS']['ok'] is True
  assert report['usage']['mongo']['BlockIO']=='12.3MB / 4.5MB'
  assert secret not in json.dumps(report)
  assert all(json.loads(x)[0] in ('ps','inspect','stats','logs') for x in calls.read_text().splitlines())
  assert json.loads(statepath.read_text())==state
 elif scenario=='pause':
  report=m.diagnose(True);assert report['workerPause']['stopped'] is True and report['workerPause']['cacheAndContainerRetained'] is True
  mutations=[json.loads(x) for x in calls.read_text().splitlines() if json.loads(x)[0] not in ('ps','inspect','stats','logs')]
  assert mutations==[['stop','--time=30',state['worker']['Id']]]
  after=json.loads(statepath.read_text());assert all(after[x]==state[x] for x in ('app','mongo','proxy'))
 elif scenario=='exited-oom-app':
  state['app']['State'].update(Status='exited',Running=False,OOMKilled=True,ExitCode=137)
  state['app']['Ports']={};statepath.write_text(json.dumps(state))
  report=m.diagnose();app=report['containers']['app']
  assert app['status']=='exited' and app['running'] is False and app['oomKilled'] is True and app['exitCode']==137
  assert all(json.loads(x)[0] in ('ps','inspect','stats','logs') for x in calls.read_text().splitlines())
  assert json.loads(statepath.read_text())==state and secret not in json.dumps(report)
  calls.write_text('');report=m.diagnose(True)
  assert report['workerPause']['stopped'] is True and report['workerPause']['cacheAndContainerRetained'] is True
  mutations=[json.loads(x) for x in calls.read_text().splitlines() if json.loads(x)[0] not in ('ps','inspect','stats','logs')]
  assert mutations==[['stop','--time=30',state['worker']['Id']]]
  after=json.loads(statepath.read_text());assert all(after[x]==state[x] for x in ('app','mongo','proxy'))
 elif scenario in ('foreign-worker','foreign-app','wrong-port','wrong-configured-port','exited-wrong-configured-port','worker-port','worker-image'):
  if scenario=='foreign-worker':state['worker']['Labels']['ielts.speech.owner']='/opt/other-project'
  if scenario=='foreign-app':state['app']['Labels']['com.docker.compose.project.working_dir']='/opt/other-project/deploy'
  if scenario=='wrong-port':state['app']['Ports']['3001/tcp'][0]['HostIp']='0.0.0.0'
  if scenario in ('wrong-configured-port','exited-wrong-configured-port'):
   state['app']['ConfiguredPorts']['3001/tcp'][0]['HostIp']='0.0.0.0'
   if scenario=='exited-wrong-configured-port':state['app']['State'].update(Status='exited',Running=False);state['app']['Ports']={}
  if scenario=='worker-port':state['worker']['ConfiguredPorts']={'3001/tcp':[{'HostIp':'127.0.0.1','HostPort':'19089'}]}
  if scenario=='worker-image':state['worker']['Image']='sha256:'+'0'*64
  statepath.write_text(json.dumps(state))
  try:m.diagnose(True);raise AssertionError('Expected refusal')
  except m.Refusal:pass
  assert all(json.loads(x)[0] in ('ps','inspect') for x in calls.read_text().splitlines())
 elif scenario=='duplicate-selector':
  cfg.write_text(cfg.read_text()+'IELTS_COMPOSE_PROJECT='+project+'\n')
  try:m.diagnose(True);raise AssertionError('Expected refusal')
  except m.Refusal:pass
  assert not calls.exists()
 elif scenario=='missing-worker':
  del state['worker'];statepath.write_text(json.dumps(state));report=m.diagnose(True)
  assert report['workerPause']['nothingChanged'] is True
  assert all(json.loads(x)[0] in ('ps','inspect','stats','logs') for x in calls.read_text().splitlines())
 elif scenario in ('gateway-log','gateway-www-data','gateway-nginx','gateway-bounded-tail'):
  if scenario in ('gateway-www-data','gateway-nginx'):
   uid=33 if scenario=='gateway-www-data' else 101;uids[error]=uid;uids[access]=uid
  if scenario=='gateway-bounded-tail':
   error.write_text('connect() failed (111: Connection refused) '+secret+'\n'+' '*65536+'\n2026/10/13 18:01:03 [error] upstream timed out\n')
   access.write_text(access_line('/api/content',502,'01')+' '*65536+'\n'+access_line('/api/content',504,'09'))
  report=m.diagnose();errors=report['files']['gatewayErrorsLast64KiB']
  files=report['files'];assert errors['available'] is True
  assert files['domainDirectory']['expectedPath'].endswith('/domain-1241e521adef')
  assert files['domainDirectory']['uid']==0 and files['domainDirectory']['mode']=='0o700'
  assert files['https.error.log']['uid']==uids.get(error,0) and files['https.error.log']['resolvedExact'] is True
  if scenario=='gateway-bounded-tail':
   assert errors['connection-refused']==0 and errors['upstream-closed']==0 and errors['upstream-timeout']==1
   assert files['gatewayAccessLast64KiB']['statusCounts']=={'502':0,'503':0,'504':1}
  else:
   assert errors['connection-refused']==1 and errors['upstream-closed']==1 and errors['upstream-timeout']==1
   requests=files['gatewayRequestsLast64KiB'];assert requests['counts']['attempt-audio']==1
   assert requests['lastErrorAtServerTime']=='2026/10/13 18:01:03'
   summary=files['gatewayAccessLast64KiB'];assert summary['parsedRequests']==4
   assert summary['statusCounts']=={'502':1,'503':1,'504':1}
   assert summary['counts']['attempt-audio']==1 and summary['counts']['content-list']==1 and summary['counts']['placement-audio']==1
   assert summary['lastGatewayFailureAtServerTime']=='13/Oct/2026:18:01:06 +0000'
  assert secret not in json.dumps(report)
  assert '198.51.100.77' not in json.dumps(report) and '/api/attempts/' not in json.dumps(report)
  assert all(json.loads(x)[0] in ('ps','inspect','stats','logs') for x in calls.read_text().splitlines())
 elif scenario in ('gateway-log-symlink','gateway-log-loop','gateway-parent-link','gateway-parent-loop','gateway-unowned-parent',
                   'gateway-parent-mode','gateway-parent-file','gateway-unowned-owner-file','gateway-owner-loop',
                   'gateway-wrong-owner','gateway-unknown-log-owner','gateway-writable-log','gateway-nonregular-log',
                   'gateway-missing-log','gateway-raced-inode','gateway-raced-owner','gateway-raced-mode'):
  expected='unsafe-domain-scope';scope_failure=False
  if scenario=='gateway-log-symlink':
   target=root/('private-target-'+secret);target.write_text(error.read_text());error.unlink();error.symlink_to(target);expected='redirected-file'
  elif scenario=='gateway-log-loop':error.unlink();error.symlink_to(error);expected='redirected-file'
  elif scenario=='gateway-parent-link':
   target=root/('private-target-'+secret);domain.rename(target);domain.symlink_to(target);scope_failure=True
  elif scenario=='gateway-parent-loop':domain.rename(root/'old-domain');domain.symlink_to(domain);scope_failure=True
  elif scenario=='gateway-parent-file':domain.rename(root/'old-domain');domain.write_text(secret);scope_failure=True
  elif scenario=='gateway-parent-mode':domain.chmod(0o755);scope_failure=True
  elif scenario=='gateway-unowned-parent':uids[domain]=1002;scope_failure=True
  elif scenario=='gateway-unowned-owner-file':uids[owner]=1002;expected='unsafe-domain-owner-file';scope_failure=True
  elif scenario=='gateway-owner-loop':owner.unlink();owner.symlink_to(owner);expected='unsafe-domain-owner-file';scope_failure=True
  elif scenario=='gateway-wrong-owner':owner.write_text('\n'.join([m.DOMAIN,str(m.LIVE_DIR),secret])+'\n');expected='domain-owner-mismatch';scope_failure=True
  elif scenario=='gateway-unknown-log-owner':uids[error]=1002;expected='unexpected-file-owner'
  elif scenario=='gateway-writable-log':error.chmod(0o666);expected='writable-by-group-or-other'
  elif scenario=='gateway-nonregular-log':error.unlink();os.mkfifo(error);expected='non-regular-file'
  elif scenario=='gateway-missing-log':error.unlink();expected='missing-file'
  elif scenario=='gateway-raced-inode':expected='file-changed-during-check'
  elif scenario in ('gateway-raced-owner','gateway-raced-mode'):expected='unsafe-opened-file'
  report=m.diagnose();files=report['files'];assert files['gatewayErrorsLast64KiB']=={'available':False,'reason':expected}
  if scope_failure:assert error not in opened and access not in opened
  elif scenario.startswith('gateway-raced-'):assert error in opened
  else:assert error not in opened
  assert files['gatewayAccessLast64KiB']['available'] is (not scope_failure)
  if scenario=='gateway-log-symlink':assert files['https.error.log']['type']=='symlink' and files['https.error.log']['resolvedExact'] is False
  if scenario=='gateway-unowned-parent':assert files['domainDirectory']['uid']==1002
  if scenario=='gateway-unknown-log-owner':assert files['https.error.log']['uid']==1002
  assert secret not in json.dumps(report) and '198.51.100.77' not in json.dumps(report)
 elif scenario=='gateway-missing-directory':
  report=m.diagnose();files=report['files'];assert files['domainDirectory']['exists'] is False
  assert files['domainDirectory']['reason']=='missing-path'
  assert files['gatewayErrorsLast64KiB']=={'available':False,'reason':'unsafe-domain-scope'}
 elif scenario=='worker-error-stages':
  base={'state':'running','total':4324,'ready':12,'pending':4312,'failed':0,'private':secret}
  for code,stage in [('provider-timeout','provider-response'),('lease-lost','lease-renew'),('claim-timeout','claim-wait'),('storage','bank-publish')]:
   value=m.worker_progress(json.dumps({**base,'lastErrorCode':code,'lastErrorStage':stage}))
   assert value['lastErrorCode']==code and value['lastErrorStage']==stage and secret not in json.dumps(value)
  value=m.worker_progress(json.dumps({**base,'lastErrorCode':secret,'lastErrorStage':secret}))
  assert 'lastErrorCode' not in value and 'lastErrorStage' not in value and secret not in json.dumps(value)
 elif scenario=='disk-resources':
  paths=[]
  def statvfs(path):
   paths.append(path)
   if path==pathlib.Path('/tmp'):raise OSError(secret)
   return types.SimpleNamespace(f_blocks=100,f_frsize=4096,f_bfree=30,f_bavail=20,f_files=90,f_ffree=60,f_favail=50)
  m.os.statvfs=statvfs;value=m.disk_resources()
  assert paths==[pathlib.Path('/'),pathlib.Path('/tmp'),m.LIVE_DIR]
  assert value['root']=={'totalBytes':409600,'freeBytes':122880,'availableBytes':81920,'totalInodes':90,'freeInodes':60,'availableInodes':50}
  assert value['deployment']==value['root'] and value['tmp']=={'available':False}
  assert all(type(x) is int for x in value['root'].values()) and secret not in json.dumps(value)
 elif scenario=='verified-local-tls':
  connection=m.LocalTLS(m.DOMAIN,timeout=5)
  assert connection._context.check_hostname is True and connection._context.verify_mode==m.ssl.CERT_REQUIRED
  recorded=[]
  class Plain:
   def close(self):recorded.append('closed')
  class Context:
   def wrap_socket(self,plain,server_hostname):recorded.append(server_hostname);return plain
  m.socket.create_connection=lambda address,timeout:(recorded.append((address,timeout)) or Plain())
  connection._context=Context();connection.connect()
  assert recorded==[(('127.0.0.1',443),5),m.DOMAIN]
  class Response:
   status=200
   def read(self,bound):assert bound==16385;return json.dumps({'status':'ok','database':'mongodb','private':secret}).encode()
  class HTTP:
   def __init__(self,*args,**kwargs):pass
   def request(self,method,path,headers):assert method=='GET' and path=='/api/health'
   def getresponse(self):return Response()
   def close(self):pass
  m.http.client.HTTPConnection=HTTP
  report=actual_health();assert report['ok'] is True and secret not in json.dumps(report)
 else:raise AssertionError('Unknown scenario')
 print('synthetic fixture passed')
`;

const scenarios = [
  "default", "pause", "exited-oom-app", "foreign-worker", "foreign-app", "wrong-port",
  "wrong-configured-port", "exited-wrong-configured-port", "worker-port", "worker-image",
  "duplicate-selector", "missing-worker", "gateway-log", "gateway-www-data", "gateway-nginx",
  "gateway-bounded-tail", "gateway-log-symlink", "gateway-log-loop", "gateway-parent-link",
  "gateway-parent-loop", "gateway-parent-mode", "gateway-parent-file", "gateway-unowned-parent",
  "gateway-unowned-owner-file", "gateway-owner-loop", "gateway-wrong-owner", "gateway-unknown-log-owner",
  "gateway-writable-log", "gateway-nonregular-log", "gateway-missing-log", "gateway-raced-inode",
  "gateway-raced-owner", "gateway-raced-mode", "gateway-missing-directory", "worker-error-stages",
  "disk-resources", "verified-local-tls",
];

for (const scenario of scenarios) {
  test(`Listening diagnostic ${scenario} confines inspection and mutations to its owned installation`, () => {
    const result = spawnSync("python3", ["-c", fixture, script, scenario], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "synthetic fixture passed");
  });
}

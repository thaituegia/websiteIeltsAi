import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../deploy/diagnose-listening.py", import.meta.url));
// Every subprocess is a synthetic Docker executable in a temporary directory.
// The production module gets only a synthetic filesystem and mocked HTTP checks;
// these tests cannot contact a deployment, database, provider or learner account.
const fixture = String.raw`
import copy, hashlib, importlib.util, json, os, pathlib, stat, subprocess, sys, tempfile
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('listening_diagnostic',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
secret='SYNTHETIC_SECRET_MUST_NEVER_PRINT'
with tempfile.TemporaryDirectory(prefix='ielts-listening-diagnostic-test-') as folder:
 root=pathlib.Path(folder);m.LIVE_DIR=root/'live';private=m.LIVE_DIR/'.local/deploy';private.mkdir(parents=True,mode=0o700)
 project='website-ielts-ai-synthetic-diagnostic'
 cfg=private/'deploy.env';cfg.write_text('IELTS_COMPOSE_PROJECT='+project+'\nOPENAI_API_KEY='+secret+'\n');cfg.chmod(0o600)
 appenv=private/'app.env';appenv.write_text(secret);appenv.chmod(0o600)
 # Preserve the real filesystem/type/symlink/private-mode checks. Only ownership
 # is simulated because the test process is deliberately not production root.
 def owned(path,directory=False,private=False):
  try:info=path.lstat()
  except OSError:raise m.Refusal('Synthetic path unavailable') from None
  if path.resolve(strict=True)!=path or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) or private and info.st_mode&0o077:
   raise m.Refusal('Synthetic path guard')
  return info
 m.owned=owned
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
  print(json.dumps({'ID':x['Id'][:12],'CPUPerc':'0.25%','MemUsage':'100MiB / 384MiB','MemPerc':'26.04%','PIDs':'7','Name':os.environ['IELTS_SYNTHETIC_SECRET']}))
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
 if scenario=='default':
  report=m.diagnose();assert report['containers']['app']['oomKilled'] is True
  assert report['containers']['app']['restarts']==2 and report['usage']['app']['PIDs']=='7'
  assert report['logs']['app']['type-error']==1 and report['logs']['app']['api-failure']==1
  assert report['logs']['workerProgress']=={'configured':True,'state':'paused','total':432,'ready':7,'pending':424,'failed':1,'lastErrorCode':'quota'}
  assert report['health']['localDomainTLS']['ok'] is True
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
 elif scenario=='gateway-log':
  domain=private/('domain-'+hashlib.sha256(m.DOMAIN.encode()).hexdigest()[:12]);domain.mkdir(mode=0o700)
  (domain/'https.error.log').write_text('connect() failed (111: Connection refused) while connecting to upstream '+secret+'\nupstream prematurely closed connection\nupstream timed out\n')
  report=m.diagnose();errors=report['files']['gatewayErrorsLast64KiB']
  assert errors['connection-refused']==1 and errors['upstream-closed']==1 and errors['upstream-timeout']==1
  assert secret not in json.dumps(report)
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

for (const scenario of ["default", "pause", "exited-oom-app", "foreign-worker", "foreign-app", "wrong-port", "wrong-configured-port", "exited-wrong-configured-port", "worker-port", "worker-image", "duplicate-selector", "missing-worker", "gateway-log", "verified-local-tls"]) {
  test(`Listening diagnostic ${scenario} confines inspection and mutations to its owned installation`, () => {
    const result = spawnSync("python3", ["-c", fixture, script, scenario], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "synthetic fixture passed");
  });
}

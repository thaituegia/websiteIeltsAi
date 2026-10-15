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
scenario=sys.argv[2];secret='SYNTHETIC_PRIVATE_NEVER_PRINT';commit='a'*40;archive='b'*64
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
 networks={project+'_web':{'NetworkID':'5'*64},project+'_database':{'NetworkID':'6'*64}}
 def row(identifier,service,image=oldimage):
  return {'Id':identifier,'Image':image,'Config':{'Env':[key+'='+value for key,value in environment.items()]+['NODE_VERSION=24.21.0'],'Labels':{'com.docker.compose.project':project,'com.docker.compose.service':service,'com.docker.compose.project.working_dir':str(m.LIVE_DIR/'deploy')}},
  'State':{'Running':True,'Health':{'Status':'healthy'}},'HostConfig':{'Memory':512*1048576},'NetworkSettings':{'Networks':{key:copy.deepcopy(value) for key,value in networks.items() if service=='app' or key.endswith('_'+('database' if service=='mongo' else 'web'))}}}
 state={'app':row(oldid,'app'),'mongo':row('7'*64,'mongo'),'proxy':row('8'*64,'proxy'),'worker':{'id':'9'*64,'running':False}}
 original=copy.deepcopy(state);calls=[];logs=[];budgets=[];switches=[]
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
   if scenario=='foreign-compose':result['services']['mongo']['image']='foreign-image'
   if scenario=='changed-credentials':result['services']['app']['environment']['DUO_ACCOUNTS_JSON']=json.dumps({'private':secret})
  if unresolved:result['services']['app']['env_file']=[{'path':str(private/'app.env')}]
  return result
 def command(args,timeout=60):
  calls.append(args)
  if args[:2]==['docker','ps']:
   service=next(x.split('=',2)[-1] for x in args if x.startswith('label=com.docker.compose.service='));return state[service]['Id']
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
  if scenario=='low-memory' or scenario=='low-memory-before-switch' and len(budgets)>=5:raise RuntimeError('Insufficient memory')
 def snapshot(exclude):return {key:copy.deepcopy(value) for key,value in state.items() if key!='app' or value['Id']!=exclude}
 guards=types.SimpleNamespace(LIVE_DIR=m.LIVE_DIR,read_project=lambda path:project,command=command,inspect=inspect,verify_container=verify_container,env_values=env_values,memory_headroom=memory,running_snapshot=snapshot,listener_snapshot=lambda:[('127.0.0.1:19088','0.0.0.0:*')])
 def health(tls=False):
  return {'ok':not(scenario in ('unhealthy-replacement','rollback-failed') and state['app']['Image']==newimage) and scenario!='unhealthy-original'}
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
   state['app']=row(newid,'app',newimage)
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
  try:m.deploy(guards,diagnostic,commit,archive)
  except RuntimeError as error:failure=str(error)
 rendered=output.getvalue()+(failure or '')
 assert secret not in rendered
 assert state['mongo']==original['mongo'] and state['proxy']==original['proxy'] and state['worker']==original['worker']
 assert not any(args[0]=='docker' and args[1] in ('stop','restart','start','exec','rm','prune') for args in calls)
 assert not any('bank-upgrade' in str(args) or 'bank-reset' in str(args) for args in calls)
 if scenario=='success':
  assert failure is None and switches==['start-app'] and state['app']['Image']==newimage
  assert release.read_bytes()!=original_override and 'HOÀN TẤT' in rendered
 elif scenario in ('unhealthy-replacement','switch-failed'):
  assert failure and 'đã phục hồi app cũ healthy' in failure and switches==['start-app','restore-app']
  assert state['app']['Image']==oldimage and release.read_bytes()==original_override
 elif scenario=='foreign-release-after-switch':
  assert failure and 'chưa xác nhận phục hồi' in failure and switches==['start-app'] and release.read_text()=='foreign override\n'
 elif scenario=='rollback-failed':
  assert failure and 'chưa xác nhận phục hồi' in failure and switches==['start-app','restore-app']
 else:
  assert failure and not switches and state['app']==original['app'] and release.read_bytes()==original_override
 print(json.dumps({'scenario':scenario,'switches':switches,'budgets':budgets}))
`;

for (const scenario of ["success", "low-memory", "low-memory-before-switch", "unhealthy-original", "foreign-network", "build-failed", "changed-bank", "foreign-compose", "changed-credentials", "concurrent-config", "switch-failed", "unhealthy-replacement", "foreign-release-after-switch", "rollback-failed"]) {
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

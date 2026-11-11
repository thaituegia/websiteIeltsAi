import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../deploy/update-app.py", import.meta.url));

// Exercise the production verifier against actual archives and filesystem
// changes. Docker is only a deterministic image-id lookup; no network is used.
const verifier = String.raw`
import hashlib,importlib.util,io,os,pathlib,stat,sys,tarfile,tempfile,types
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('operator',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
scenario=sys.argv[2];commit='a'*40;stamp=commit[:12]+'-20261111T124548Z-958cc4';image_id='sha256:'+'2'*64;before=b'private synthetic override\n'
with tempfile.TemporaryDirectory(prefix='ielts-resume-verify-') as folder:
 root=pathlib.Path(folder);m.LIVE_DIR=root/'live';private=m.LIVE_DIR/'.local/deploy';private.mkdir(parents=True,mode=0o700)
 audits=private/'app-updates';releases=m.LIVE_DIR/'.local/releases';audits.mkdir(mode=0o700);releases.mkdir(mode=0o700)
 audit=audits/stamp;release_dir=releases/stamp;audit.mkdir(mode=0o700);release_dir.mkdir(mode=0o700)
 source=release_dir/'source';source.mkdir(mode=0o700);(source/'deploy').mkdir(mode=0o755)
 os.umask(0o077)
 files={'.dockerignore':b'private-file\n','deploy/Dockerfile.release':b'FROM synthetic\n'}
 for name,data in files.items():
  path=source/name;path.write_bytes(data);path.chmod(0o644)
 image=m.PROJECT+'-app:release-'+stamp
 (audit/'release.compose.before').write_bytes(before)
 (audit/'build.log').write_text('Step 1/1 : synthetic\nSuccessfully built '+image_id[7:19]+'\nSuccessfully tagged '+image+'\n')
 archive=audit/'source.tar.gz'
 with tarfile.open(archive,'w:gz') as bundle:
  parent='websiteIeltsAi-'+commit
  for directory in [parent,parent+'/deploy']:
   entry=tarfile.TarInfo(directory);entry.type=tarfile.DIRTYPE;bundle.addfile(entry)
  for name,data in files.items():
   entry=tarfile.TarInfo(parent+'/'+name);entry.size=len(data);bundle.addfile(entry,io.BytesIO(data))
 digest=hashlib.sha256(archive.read_bytes()).hexdigest()
 def owned(path,directory=False,private=False):
  info=path.lstat()
  if path.resolve(strict=True)!=path or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) or private and info.st_mode&0o077:
   raise RuntimeError('Unsafe synthetic path')
  return info
 m.owned=owned;calls=[]
 def command(args,timeout=60):
  calls.append(args)
  assert args==['docker','image','inspect','--format','{{.Id}}',image],repr(args)
  return ('sha256:'+'3'*64 if scenario=='image-changed' else 'not-an-image' if scenario=='invalid-image-id' else image_id)+'\n'
 guards=types.SimpleNamespace(command=command)
 selected_stamp=stamp
 if scenario=='invalid-stamp':selected_stamp='../'+stamp
 if scenario=='wrong-commit':selected_stamp='b'*12+stamp[12:]
 if scenario=='override-changed':(audit/'release.compose.before').write_bytes(b'other override\n')
 if scenario=='archive-corrupt':archive.write_bytes(archive.read_bytes()+b'changed')
 if scenario=='source-changed':(source/'.dockerignore').write_bytes(b'changed\n')
 if scenario=='source-missing':(source/'.dockerignore').unlink()
 if scenario=='source-extra':(source/'extra-source').write_bytes(b'untracked\n')
 if scenario=='source-extra-dir':(source/'empty-extra-directory').mkdir()
 if scenario=='source-link':
  (source/'.dockerignore').unlink();(source/'.dockerignore').symlink_to(source/'deploy/Dockerfile.release')
 if scenario=='source-root-link':
  source.rename(release_dir/'redirected');source.symlink_to(release_dir/'redirected',target_is_directory=True)
 if scenario=='archive-link':
  archive.rename(audit/'redirected.tar.gz');archive.symlink_to(audit/'redirected.tar.gz')
 if scenario=='missing-build-log':(audit/'build.log').unlink()
 if scenario=='build-id-mismatch':(audit/'build.log').write_text('Successfully built '+'3'*12+'\nSuccessfully tagged '+image+'\n')
 if scenario=='build-tag-mismatch':(audit/'build.log').write_text('Successfully built '+image_id[7:19]+'\nSuccessfully tagged other-app:latest\n')
 if scenario=='incomplete-build-log':(audit/'build.log').write_text('Step 1/1 : synthetic\n')
 if scenario=='oversized-build-log':(audit/'build.log').write_bytes(b'x'*(16*1024*1024+1))
 if scenario=='public-build-log':(audit/'build.log').chmod(0o644)
 if scenario=='public-archive':archive.chmod(0o644)
 if scenario=='public-audit':audit.chmod(0o755)
 if scenario=='optional-candidate-link':(audit/'release.compose.new').symlink_to(audit/'build.log')
 if scenario in ('start-app.log','restore-app.log','complete.json'):(audit/scenario).write_text('synthetic marker\n')
 if scenario=='switch-marker-link':(audit/'start-app.log').symlink_to(audit/'build.log')
 if scenario=='broken-switch-marker':(audit/'start-app.log').symlink_to(audit/'missing-log')
 failure=None
 try:result=m.verified_built_release(guards,commit,digest,private,selected_stamp,before)
 except (RuntimeError,FileNotFoundError) as error:failure=error
 if scenario=='success':
  assert failure is None,repr(failure)
  assert result==(audit,release_dir,source,image,image_id),repr(result)
  assert len(calls)==1
 else:assert failure is not None,'Unsafe resume accepted: '+scenario
 assert not (audit/'start-app.log').exists() or scenario in ('start-app.log','switch-marker-link')
 assert not (audit/'complete.json').exists() or scenario=='complete.json'
 print(scenario)
`;

for (const scenario of [
  "success", "invalid-stamp", "wrong-commit", "override-changed", "archive-corrupt",
  "source-changed", "source-missing", "source-extra", "source-extra-dir", "source-link", "source-root-link", "archive-link",
  "missing-build-log", "build-id-mismatch", "build-tag-mismatch", "incomplete-build-log", "oversized-build-log",
  "public-build-log", "public-archive", "public-audit", "optional-candidate-link",
  "image-changed", "invalid-image-id", "start-app.log", "restore-app.log", "complete.json", "switch-marker-link", "broken-switch-marker",
]) {
  test(`built-release verification: ${scenario}`, () => {
    const result = spawnSync("python3", ["-c", verifier, script, scenario], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), scenario);
  });
}

// Keep the complete installation, Compose, isolation and rollback assertions
// from the original operator fixture, while supplying a previously built image.
const original = readFileSync(new URL("./update-app.test.ts", import.meta.url), "utf8");
const prefix = "const fixture = String.raw`";
const start = original.indexOf(prefix) + prefix.length;
const end = original.indexOf("`;", start);
assert.ok(start >= prefix.length && end > start);
const fixture = original.slice(start, end)
  .replace("scenario=sys.argv[2];upgrade=", "resume_scenario=sys.argv[2];scenario='unhealthy-replacement' if resume_scenario=='rollback' else 'success';upgrade=")
  .replace(" output=io.StringIO();failure=None", String.raw`
 stamp=commit[:12]+'-20261111T124548Z-958cc4';audits=private/'app-updates';audits.mkdir(mode=0o700)
 audit=audits/stamp;release_dir=m.LIVE_DIR/'.local/releases'/stamp;audit.mkdir(mode=0o700);release_dir.mkdir(mode=0o700)
 source=release_dir/'source';source.mkdir(mode=0o700)
 download('https://synthetic/'+commit,archive,audit/'source.tar.gz',128*1024*1024)
 archive=hashlib.sha256((audit/'source.tar.gz').read_bytes()).hexdigest()
 m.extract_source(audit/'source.tar.gz',source,commit)
 (audit/'release.compose.before').write_bytes(original_override)
 (audit/'build.log').write_text('Successfully built '+newimage[7:19]+'\nSuccessfully tagged '+project+'-app:release-'+stamp+'\n')
 (release_dir/'duo.env').write_text("DUO_ENABLED=true\nDUO_CREDENTIALS_FILE=''\nDUO_ACCOUNTS_JSON='"+json.dumps(credentials,ensure_ascii=False,separators=(',',':')).replace("'","\\'")+"'\n")
 def forbidden_download(*args,**kwargs):raise AssertionError('Resume downloaded or rebuilt source')
 m.download=forbidden_download
 base_run_logged=m.run_logged
 def resumed_run_logged(args,audit,label,timeout=1800,environment=None):
  assert label!='build','Resume rebuilt the image'
  return base_run_logged(args,audit,label,timeout,environment)
 m.run_logged=resumed_run_logged
 if resume_scenario=='source-changed':(source/'.dockerignore').write_text('changed source\n')
 if resume_scenario=='low-memory':
  def refuse_memory(budget):budgets.append(budget);raise RuntimeError('Insufficient memory')
  guards.memory_headroom=refuse_memory
 if resume_scenario in ('concurrent-final-memory','concurrent-final-release','concurrent-final-duo','concurrent-final-image'):
  original_memory=guards.memory_headroom
  final_state={'changed_image':False};original_command=guards.command
  def final_image_command(args,timeout=60):
   if final_state['changed_image'] and args[:3]==['docker','image','inspect'] and args[-1]==project+'-app:release-'+stamp:return 'sha256:'+'3'*64
   return original_command(args,timeout)
  guards.command=final_image_command
  def changed_during_final_memory(budget):
   original_memory(budget)
   if len(budgets)==4:
    if resume_scenario=='concurrent-final-memory':gateway.write_text('changed while waiting for final RAM check\n')
    if resume_scenario=='concurrent-final-release':release.write_text('changed override during final RAM check\n')
    if resume_scenario=='concurrent-final-duo':(release_dir/'duo.env').write_text('changed account file during final RAM check\n')
    if resume_scenario=='concurrent-final-image':final_state['changed_image']=True
  guards.memory_headroom=changed_during_final_memory
 if resume_scenario=='changed-bank':
  base_command=guards.command
  def bank_command(args,timeout=60):
   if args[:2]==['docker','run'] and newimage in args:return 'f'*64+'\n'
   return base_command(args,timeout)
  guards.command=bank_command
 previous_audit={path.name:path.read_bytes() for path in audit.iterdir() if path.is_file()}
 output=io.StringIO();failure=None`)
  .replace("m.deploy(guards,diagnostic,commit,archive)\n", "m.deploy(guards,diagnostic,commit,archive,reuse_built_release=stamp)\n")
  .replace(" if scenario in ('success','upgrade-success'", " if resume_scenario=='success' and scenario in ('success','upgrade-success'")
  .replace("  assert failure and not switches and state['app']==original['app'] and release.read_bytes()==original_override\n", "  assert failure and not switches and state['app']==original['app'] and release.read_bytes()==(b'changed override during final RAM check\\n' if resume_scenario=='concurrent-final-release' else original_override)\n")
  .replace(" print(json.dumps({'scenario':scenario", String.raw`
 assert 'build' not in logs
 assert {path.name:path.read_bytes() for path in audit.iterdir() if path.is_file()}==previous_audit
 assert len(list((private/'app-updates').iterdir())) in (1,2) and len(list((m.LIVE_DIR/'.local/releases').iterdir()))==1
 assert budgets and all(value==512 for value in budgets)
 if resume_scenario=='success':
  assert len([args for args in calls if args[:2]==['docker','run']])==2
  assert switches==['start-app']
  assert len(list((private/'app-updates').iterdir()))==2
  assert not (audit/'complete.json').exists() and len(list((private/'app-updates').glob('*/resume.json')))==1
 elif resume_scenario=='rollback':assert failure and switches==['start-app','restore-app'] and state['app']['Image']==oldimage and release.read_bytes()==original_override
 else:assert failure and not switches and state['app']==original['app'] and not (audit/'complete.json').exists()
 print(json.dumps({'resumeScenario':resume_scenario,'scenario':scenario`);

for (const scenario of ["success", "source-changed", "low-memory", "changed-bank", "concurrent-final-memory", "concurrent-final-release", "concurrent-final-duo", "concurrent-final-image", "rollback"]) {
  test(`resume app update without build: ${scenario}`, () => {
    const result = spawnSync("python3", ["-c", fixture, script, scenario], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).resumeScenario, scenario);
  });
}

const parser = String.raw`
import contextlib,importlib.util,io,sys,types
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('operator',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
scenario=sys.argv[2];commit='a'*40;digest='b'*64;stamp=commit[:12]+'-20261111T124548Z-958cc4'
choices={
 'cached':['--cached-audio-only','--reuse-built-release',stamp],
 'ten':['--add-ten-gate-papers','--reuse-built-release',stamp],
 'default':['--reuse-built-release',stamp],
 'ordinary-ten':['--add-ten-gate-papers'],
 'wrong-stamp':['--add-ten-gate-papers','--reuse-built-release','b'*12+stamp[12:]],
 'missing-stamp':['--add-ten-gate-papers','--reuse-built-release'],
 'duplicate-resume':['--reuse-built-release',stamp,'--reuse-built-release',stamp],
 'wrong-order':['--reuse-built-release',stamp,'--add-ten-gate-papers'],
 'upgrade-resume':['--upgrade-text-models','--reuse-built-release',stamp],
}
sys.argv=['update-app.py',commit,digest]+choices[scenario]
m.os.geteuid=lambda:0;downloads=[];deployments=[];modules=[]
def download(url,sha,path,limit):
 assert url.startswith('https://raw.githubusercontent.com/thaituegia/websiteIeltsAi/'+commit+'/deploy/')
 assert len(sha)==64 and limit==1024*1024
 downloads.append((url,sha))
m.download=download
def checked(path,name):
 module=types.SimpleNamespace(identity=name);modules.append(module);return module
m.checked_module=checked
def deploy(*args,**options):deployments.append((args,options))
m.deploy=deploy;failure=None
with contextlib.redirect_stdout(io.StringIO()):
 try:m.main()
 except RuntimeError as error:failure=error
if scenario in ('cached','ten','default','ordinary-ten'):
 assert failure is None and len(downloads)==2 and len(deployments)==1
 args,options=deployments[0]
 assert args==(modules[0],modules[1],commit,digest)
 assert options.get('upgrade_text_models') is False
 assert options.get('add_ten_gate_papers',False)==(scenario in ('ten','ordinary-ten'))
 assert options.get('reuse_built_release')==(None if scenario=='ordinary-ten' else stamp)
 assert not any(options.get(key) for key in ('add_three_gate_papers','add_three_more_gate_papers','add_five_gate_papers'))
else:assert failure is not None and not downloads and not deployments
print(scenario)
`;

for (const scenario of ["cached", "ten", "default", "ordinary-ten", "wrong-stamp", "missing-stamp", "duplicate-resume", "wrong-order", "upgrade-resume"]) {
  test(`resume command validates flags before download: ${scenario}`, () => {
    const result = spawnSync("python3", ["-c", parser, script, scenario], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), scenario);
  });
}

const tenFixture = fixture
  .replace(" output=io.StringIO();failure=None", String.raw`
 audio_calls=[]
 def prepare(guard,selected_image,values,selected_audit,additional=False,five=False,ten=False):
  assert guard.command==guards.command and selected_image==newimage and values['OPENAI_API_KEY']==secret
  assert ten is True and additional is False and five is False
  assert state['app']['Id']==oldid and not switches and 'build' not in logs
  audio_calls.append(selected_audit)
  result={'ok':True,'version':m.TEN_GATE_SUPPLEMENT_VERSION,'total':10,'ready':10,'providerRequests':10,'maxProviderRequests':10,'inputCharacters':24000,'maxInputCharacters':30000}
  (selected_audit/'gate-supplement.json').write_text(json.dumps(result)+'\n')
  return result
 m.prepare_three_gate_papers=prepare
 output=io.StringIO();failure=None`)
  .replace("reuse_built_release=stamp)\n", "reuse_built_release=stamp,add_ten_gate_papers=True)\n")
  .replace(" print(json.dumps({'resumeScenario':", String.raw`
 assert len(audio_calls)==(1 if resume_scenario in ('success','concurrent-final-memory','concurrent-final-release','concurrent-final-duo','concurrent-final-image','rollback') else 0)
 if resume_scenario=='success':
  assert audio_calls[0]!=audit
  assert receipt['privateGateSupplement']['version']==m.TEN_GATE_SUPPLEMENT_VERSION
  assert receipt['privateGateSupplement']['ready']==10 and receipt['privateGateSupplement']['maxProviderRequests']==10
 print(json.dumps({'resumeScenario':`);

for (const scenario of ["success", "source-changed", "low-memory", "changed-bank", "concurrent-final-memory", "concurrent-final-release", "concurrent-final-duo", "concurrent-final-image", "rollback"]) {
  test(`resume preserves bounded ten-paper supplement: ${scenario}`, () => {
    const result = spawnSync("python3", ["-c", tenFixture, script, scenario], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).resumeScenario, scenario);
  });
}

const memoryWait = String.raw`
import contextlib,importlib.util,io,sys,types
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('operator',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
scenario=sys.argv[2];clock={'now':0};sleeps=[];calls=[]
message='RAM khả dụng chưa đủ cho thao tác và 1 GiB dự phòng; không tác động project khác.'
def sleep(seconds):sleeps.append(seconds);clock['now']+=seconds
m.time.monotonic=lambda:clock['now'];m.time.sleep=sleep
def memory(budget):
 calls.append(budget)
 if scenario=='other-error':raise RuntimeError('SYNTHETIC_PRIVATE_NEVER_PRINT')
 if scenario=='success':return
 if scenario=='recovers' and len(calls)>2:return
 if scenario=='shared-deadline' and len(calls)==2:return
 raise RuntimeError(message)
sentinel=object();guard=m.WaitingGuards(types.SimpleNamespace(memory_headroom=memory,command=sentinel),30)
assert guard.command is sentinel
failure=None;output=io.StringIO()
with contextlib.redirect_stdout(output):
 try:
  guard.memory_headroom(512)
  if scenario=='shared-deadline':guard.memory_headroom(384)
 except RuntimeError as error:failure=error
assert 'SYNTHETIC_PRIVATE_NEVER_PRINT' not in output.getvalue()
if scenario=='success':assert failure is None and calls==[512] and not sleeps
elif scenario=='recovers':assert failure is None and calls==[512]*3 and sleeps==[15,15]
elif scenario=='deadline':assert failure is not None and calls==[512]*3 and sleeps==[15,15] and clock['now']==30
elif scenario=='shared-deadline':assert failure is not None and calls==[512,512,384,384] and sleeps==[15,15] and clock['now']==30
elif scenario=='other-error':assert str(failure)=='SYNTHETIC_PRIVATE_NEVER_PRINT' and calls==[512] and not sleeps
else:raise AssertionError(scenario)
print(scenario)
`;

for (const scenario of ["success", "recovers", "deadline", "shared-deadline", "other-error"]) {
  test(`RAM wait preserves reserve and bounded deadline: ${scenario}`, () => {
    const result = spawnSync("python3", ["-c", memoryWait, script, scenario], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), scenario);
  });
}

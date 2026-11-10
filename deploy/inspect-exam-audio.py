#!/usr/bin/env python3
"""Inspect existing exam audio only. No synthesis, seeding, repair or provider calls."""
import json
import os
import pathlib
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time

LIVE_DIR = pathlib.Path('/opt/websiteIeltsAi-20261007T172235Z-7D7gnc')
PROJECT = 'website-ielts-ai-20261007172235-7d7gnc'
ENV_KEYS = ('MONGODB_URI', 'APP_ORIGIN', 'NODE_ENV', 'DUO_ENABLED', 'DUO_CREDENTIALS_FILE',
            'DUO_ACCOUNTS_JSON', 'IELTS_OPENAI_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY',
            'ELEVENLABS_VOICE_BRITISH', 'ELEVENLABS_VOICE_AMERICAN', 'ELEVENLABS_VOICE_AUSTRALIAN', 'ELEVENLABS_MODEL')
NODE_PROGRAM = r'''
const output = console.log.bind(console);
console.log = () => {}; console.error = () => {};
globalThis.fetch = async () => { throw new Error("External HTTP disabled during cache-only inspection"); };
const report = {mode:"cache-only-read-only",providerRequests:0,configured:false,inspectionComplete:false,allExamAudioReady:false,groups:[],placement:{total:0,ready:0,missing:0,missingIds:[]}};
let client;
const timer = setTimeout(() => { output(JSON.stringify({...report,error:"inspection-timeout"})); process.exit(2); }, 540000);
const safeId = value => typeof value === "string" && /^(?!sk-)[\w:.-]{1,180}$/u.test(value) ? value : "invalid-id";
const safeTitle = value => String(value ?? "").replace(/sk-[A-Za-z0-9_-]+/gu,"[redacted]").replace(/[\u0000-\u001f]/gu," ").slice(0,160);
try {
  const {MongoClient} = await import("mongodb");
  const {loadDuoCredentials} = await import("/app/server/duo-auth.ts");
  const {activateProviderConfig} = await import("/app/server/provider-config.ts");
  const {SpeechAudioCache,speechCapabilities} = await import("/app/server/speech-audio.ts");
  activateProviderConfig(loadDuoCredentials());
  if (!speechCapabilities().configured) throw new Error("provider-configuration-unavailable");
  report.configured = true;
  if (process.env.MONGODB_URI !== "mongodb://mongo:27017/ielts_ai") throw new Error("wrong-database");
  client = new MongoClient(process.env.MONGODB_URI,{maxPoolSize:2,serverSelectionTimeoutMS:8000,connectTimeoutMS:8000});
  await client.connect(); const db = client.db();
  if (db.databaseName !== "ielts_ai") throw new Error("wrong-database");
  const cache = new SpeechAudioCache({db});
  const groups = new Map(); let paperCount = 0, inspectionErrors = 0, privatePapers = 0, privateSections = 0, publicPapers = 0;
  for (const [collection,scope] of [["content","public"],["duo_exam_content","duo"]]) {
    const cursor = db.collection(collection).find({skill:"listening"},{projection:{_id:0,id:1,title:1,band:1,format:1,sections:1},timeoutMS:8000,timeoutMode:"iteration"}).sort({band:1,id:1}).limit(2049).batchSize(16);
    try { for await (const paper of cursor) {
      if (++paperCount > 2048) throw new Error("inventory-limit");
      if(scope==="duo")privatePapers++;else publicPapers++;
      const band = typeof paper.band === "number" && Number.isFinite(paper.band) ? paper.band : null;
      const format = paper.format === "full-mock" ? "full-mock" : "lesson";
      const key = JSON.stringify([scope,band,format]);
      let group = groups.get(key);
      if (!group) {group={scope,band,format,papers:0,readyPapers:0,missingPapers:0,sections:0,readySections:0,missingSections:0,readyPaperIds:[],missing:[]};groups.set(key,group);}
      const sections = Array.isArray(paper.sections) ? paper.sections : [];
      if(scope==="duo")privateSections+=sections.length;
      let readyCount = 0, verified = sections.length > 0;
      try {
        if (!verified) throw new Error("empty-source");
        const status = await cache.readiness(sections);
        if (!status.configured || !Number.isSafeInteger(status.readyCount) || status.totalCount !== sections.length || status.readyCount < 0 || status.readyCount > sections.length) throw new Error("invalid-readiness");
        readyCount = status.readyCount;
      } catch {verified=false;inspectionErrors++;}
      const complete = verified && readyCount === sections.length;
      group.papers++; group.sections += sections.length; group.readySections += readyCount;
      group.missingSections += sections.length-readyCount;
      if (complete) {group.readyPapers++;if(group.readyPaperIds.length<128)group.readyPaperIds.push(safeId(paper.id));}
      else {group.missingPapers++;if(group.missing.length<128)group.missing.push({id:safeId(paper.id),title:safeTitle(paper.title),readySections:readyCount,totalSections:sections.length,verified});}
    }} finally {await cursor.close();}
  }
  const placement = db.collection("placementItems").find({skill:"listening"},{projection:{_id:0,id:1,text:1},timeoutMS:8000,timeoutMode:"iteration"}).limit(2049).batchSize(16);
  try {for await (const item of placement) {
    if (++report.placement.total>2048)throw new Error("inventory-limit");
    let ready=false;
    try {const status=await cache.readiness([{id:item.id,title:"",text:item.text}]);ready=status.configured&&status.readyCount===1&&status.totalCount===1;}
    catch {inspectionErrors++;}
    if(ready)report.placement.ready++;else {report.placement.missing++;if(report.placement.missingIds.length<256)report.placement.missingIds.push(safeId(item.id));}
  }} finally {await placement.close();}
  report.groups=[...groups.values()];
  if(privatePapers!==138||privateSections!==270||publicPapers===0||report.placement.total===0){inspectionErrors++;report.error="inventory-incomplete";}
  report.inspectionErrors=inspectionErrors;
  report.inspectionComplete=inspectionErrors===0;
  report.allExamAudioReady=report.inspectionComplete&&report.groups.length>0&&report.groups.every(group=>group.missingPapers===0)&&report.placement.missing===0;
} catch {report.error="inspection-unavailable";}
finally {clearTimeout(timer);if(client)await client.close();}
output(JSON.stringify(report));
'''


class Refusal(RuntimeError):
    pass


def command(args, timeout=30):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Refusal('Audio inspection command timed out; raw output withheld.') from None
    if result.returncode or len(result.stdout) > 1048576 or len(result.stderr) > 1048576:
        raise Refusal('Audio inspection command failed; raw output withheld.')
    return result.stdout.strip()


def owned(path, directory=False, private=False):
    row = path.lstat()
    if (path.resolve(strict=True) != path or row.st_uid != 0 or
            not (stat.S_ISDIR(row.st_mode) if directory else stat.S_ISREG(row.st_mode)) or
            (private and row.st_mode & 0o077)):
        raise Refusal('Audio inspection deployment ownership is invalid.')


def headroom(job_mib):
    rows = re.findall(r'^MemAvailable:\s+(\d+)\s+kB$', pathlib.Path('/proc/meminfo').read_text(), re.M)
    if len(rows) != 1 or int(rows[0]) < (1024 + job_mib) * 1024:
        raise Refusal('Chưa đủ RAM cho kiểm tra audio và 1 GiB dự phòng; không gọi AI hoặc đổi app.')


def installation():
    owned(LIVE_DIR, directory=True)
    private = LIVE_DIR / '.local/deploy'
    owned(private, directory=True, private=True)
    selector = private / 'deploy.env'
    owned(selector, private=True)
    if selector.stat().st_size > 65536 or re.findall(r'^IELTS_COMPOSE_PROJECT=([^\r\n]+)', selector.read_text(), re.M) != [PROJECT]:
        raise Refusal('Audio inspection project selector does not match.')
    rows = {}
    for service in ('app', 'mongo'):
        ids = command(['docker', 'ps', '-q', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + PROJECT,
                       '--filter', 'label=com.docker.compose.service=' + service]).split()
        if len(ids) != 1 or not re.fullmatch(r'[a-f0-9]{64}', ids[0]):
            raise Refusal('Expected one running owned IELTS app and MongoDB.')
        row = json.loads(command(['docker', 'inspect', ids[0]]))[0]
        labels = row['Config'].get('Labels') or {}
        if (row.get('Id') != ids[0] or row['State'].get('Running') is not True or
                labels.get('com.docker.compose.project') != PROJECT or labels.get('com.docker.compose.service') != service or
                labels.get('com.docker.compose.project.working_dir') != str(LIVE_DIR / 'deploy')):
            raise Refusal('Audio inspection service ownership does not match.')
        rows[service] = row
    app = rows['app']
    binding = {'3001/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '19088'}]}
    if (not re.fullmatch(r'sha256:[a-f0-9]{64}', app.get('Image', '')) or
            app['HostConfig'].get('PortBindings') != binding or
            app['NetworkSettings'].get('Ports') != binding or app['State'].get('Health', {}).get('Status') != 'healthy'):
        raise Refusal('Audio inspection requires the verified healthy IELTS app.')
    networks = {}
    for kind in ('web', 'database'):
        name = PROJECT + '_' + kind
        row = json.loads(command(['docker', 'network', 'inspect', name]))[0]
        labels = row.get('Labels') or {}
        if (row.get('Name') != name or not re.fullmatch(r'[a-f0-9]{64}', row.get('Id', '')) or
                labels.get('com.docker.compose.project') != PROJECT or labels.get('com.docker.compose.network') != kind or
                row.get('Internal') is not (kind == 'database')):
            raise Refusal('Audio inspection networks do not belong to IELTS.')
        networks[name] = row['Id']
    if (set(app['NetworkSettings']['Networks']) != set(networks) or
            any(app['NetworkSettings']['Networks'][key].get('NetworkID') != value for key, value in networks.items()) or
            set(rows['mongo']['NetworkSettings']['Networks']) != {PROJECT + '_database'} or
            rows['mongo']['NetworkSettings']['Networks'][PROJECT + '_database'].get('NetworkID') != networks[PROJECT + '_database']):
        raise Refusal('Audio inspection service networks do not match.')
    values = {}
    for entry in app['Config']['Env']:
        key, sep, value = entry.partition('=')
        if not sep or key in values:
            raise Refusal('Audio inspection environment is ambiguous.')
        values[key] = value
    if values.get('MONGODB_URI') != 'mongodb://mongo:27017/ielts_ai' or values.get('APP_ORIGIN') != 'https://sutonghanyu.vn' or values.get('DUO_CREDENTIALS_FILE'):
        raise Refusal('Audio inspection requires the existing private provider binding.')
    return app, networks, {key: values[key] for key in ENV_KEYS if key in values}


def job(identifier, name, image, operation):
    row = json.loads(command(['docker', 'inspect', identifier]))[0]
    labels = row['Config'].get('Labels') or {}
    if (row.get('Id') != identifier or row.get('Name') != '/' + name or row.get('Image') != image or
            labels.get('com.websiteieltsai.project') != PROJECT or labels.get('com.websiteieltsai.kind') != 'audio-inspection' or
            labels.get('com.websiteieltsai.operation-id') != operation):
        raise Refusal('Audio inspection job ownership does not match; nothing stopped.')
    return row


def validate_report(report):
    allowed = {'mode', 'providerRequests', 'configured', 'inspectionComplete', 'allExamAudioReady', 'groups', 'placement', 'inspectionErrors', 'error'}
    if (not isinstance(report, dict) or set(report) - allowed or
            report.get('mode') != 'cache-only-read-only' or type(report.get('providerRequests')) is not int or report['providerRequests'] != 0 or
            any(type(report.get(key)) is not bool for key in ('configured', 'inspectionComplete', 'allExamAudioReady')) or
            not isinstance(report.get('groups'), list) or len(report['groups']) > 1000):
        raise Refusal('Audio inspection output is invalid; raw output withheld.')
    def counts(value, keys):
        return all(type(value.get(key)) is int and 0 <= value[key] <= 10000 for key in keys)
    def ids(values, maximum):
        return isinstance(values, list) and len(values) <= maximum and all(isinstance(value, str) and re.fullmatch(r'(?!sk-)[\w:.-]{1,180}', value) for value in values)
    group_keys = {'scope', 'band', 'format', 'papers', 'readyPapers', 'missingPapers', 'sections', 'readySections', 'missingSections', 'readyPaperIds', 'missing'}
    for group in report['groups']:
        if (not isinstance(group, dict) or set(group) != group_keys or group.get('scope') not in ('public', 'duo') or
                group.get('format') not in ('lesson', 'full-mock') or
                (group.get('band') is not None and (type(group['band']) not in (int, float) or not 0 <= group['band'] <= 9)) or
                not counts(group, ('papers', 'readyPapers', 'missingPapers', 'sections', 'readySections', 'missingSections')) or
                group['readyPapers'] + group['missingPapers'] != group['papers'] or
                group['readySections'] + group['missingSections'] != group['sections'] or
                not ids(group.get('readyPaperIds'), min(128, group['readyPapers'])) or
                not isinstance(group.get('missing'), list) or len(group['missing']) > min(128, group['missingPapers'])):
            raise Refusal('Audio inspection group is invalid; raw output withheld.')
        for missing in group['missing']:
            if (not isinstance(missing, dict) or set(missing) != {'id', 'title', 'readySections', 'totalSections', 'verified'} or
                    not ids([missing.get('id')], 1) or not isinstance(missing.get('title'), str) or len(missing['title']) > 160 or
                    re.search(r'[\x00-\x1f]|\bsk-[A-Za-z0-9_-]+', missing['title']) or
                    not counts(missing, ('readySections', 'totalSections')) or missing['readySections'] > missing['totalSections'] or
                    type(missing.get('verified')) is not bool):
                raise Refusal('Audio inspection missing-paper metadata is invalid; raw output withheld.')
    placement = report.get('placement')
    if (not isinstance(placement, dict) or set(placement) != {'total', 'ready', 'missing', 'missingIds'} or
            not counts(placement, ('total', 'ready', 'missing')) or placement['ready'] + placement['missing'] != placement['total'] or
            not ids(placement['missingIds'], min(256, placement['missing'])) or
            ('inspectionErrors' in report and not counts(report, ('inspectionErrors',))) or
            ('error' in report and report['error'] not in ('inspection-timeout', 'inspection-unavailable', 'inventory-incomplete'))):
        raise Refusal('Audio inspection placement metadata is invalid; raw output withheld.')
    if report['allExamAudioReady'] and (not report['configured'] or not report['inspectionComplete'] or
            not report['groups'] or any(group['missingPapers'] for group in report['groups']) or placement['missing']):
        raise Refusal('Audio inspection cannot announce readiness for missing audio.')
    return report


def diagnose():
    app, networks, values = installation()
    headroom(384)
    if any(re.search(r'[\x00\r\n]', value) for value in values.values()):
        raise Refusal('Audio inspection environment has unsupported characters.')
    operation = os.urandom(6).hex()
    name = PROJECT + '-audio-inspect-' + operation
    identifier, attempted = None, False
    handlers = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    def interrupted(_number, _frame):
        raise KeyboardInterrupt()
    for number in handlers:
        signal.signal(number, interrupted)
    try:
        with tempfile.TemporaryDirectory(prefix='audio-inspect-', dir=LIVE_DIR / '.local/deploy') as folder:
            path = pathlib.Path(folder) / 'provider.env'
            with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'w') as output:
                output.write(''.join(key + '=' + value + '\n' for key, value in values.items()))
            try:
                attempted = True
                identifier = command(['docker', 'create', '--name', name,
                    '--label', 'com.websiteieltsai.project=' + PROJECT,
                    '--label', 'com.websiteieltsai.kind=audio-inspection',
                    '--label', 'com.websiteieltsai.operation-id=' + operation,
                    '--env-file', str(path), '--network', PROJECT + '_web', '--network', PROJECT + '_database',
                    '--memory=384m', '--memory-swap=384m', '--cpus=0.25', '--pids-limit=64', '--read-only',
                    '--cap-drop=ALL', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m',
                    '--security-opt=no-new-privileges:true', '--user=node', '--entrypoint=node', app['Image'],
                    '--import', 'tsx', '--input-type=module', '-e', NODE_PROGRAM], timeout=60)
                if not re.fullmatch(r'[a-f0-9]{64}', identifier):
                    identifier = None
                    raise Refusal('Audio inspection container identifier is invalid.')
                command(['docker', 'start', identifier], timeout=60)
                deadline = time.monotonic() + 600
                while True:
                    headroom(0)
                    row = job(identifier, name, app['Image'], operation)
                    if (set(row['NetworkSettings']['Networks']) != set(networks) or
                            any(row['NetworkSettings']['Networks'][key].get('NetworkID') != value for key, value in networks.items())):
                        raise Refusal('Audio inspection job network changed.')
                    if row['State'].get('Running') is not True:
                        if row['State'].get('ExitCode') != 0:
                            raise Refusal('Audio inspection did not finish; no AI was called.')
                        break
                    if time.monotonic() >= deadline:
                        raise Refusal('Audio inspection timed out; no AI was called.')
                    time.sleep(2)
                raw = command(['docker', 'logs', '--tail', '1', identifier])
                current = command(['docker', 'ps', '-q', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + PROJECT,
                                   '--filter', 'label=com.docker.compose.service=app']).split()
                if current != [app['Id']]:
                    raise Refusal('IELTS app changed during inspection; repeat the read-only check.')
                return validate_report(json.loads(raw))
            finally:
                for number in handlers:
                    signal.signal(number, signal.SIG_IGN)
                if attempted and identifier is None:
                    candidates = command(['docker', 'ps', '-aq', '--no-trunc', '--filter', 'name=^/' + name + '$']).split()
                    if candidates:
                        if len(candidates) != 1 or not re.fullmatch(r'[a-f0-9]{64}', candidates[0]):
                            raise Refusal('Audio inspection temporary job identity is ambiguous.')
                        identifier = candidates[0]
                if identifier:
                    row = job(identifier, name, app['Image'], operation)
                    if row['State'].get('Running') is True:
                        command(['docker', 'stop', '--time', '10', identifier])
                        job(identifier, name, app['Image'], operation)
                    command(['docker', 'rm', '--force', identifier])
    finally:
        for number, handler in handlers.items():
            signal.signal(number, handler)


if __name__ == '__main__':
    try:
        if os.geteuid() != 0 or len(sys.argv) != 1:
            raise Refusal('Run the checksum-verified audio inspection as root without arguments.')
        os.umask(0o077)
        print(json.dumps(diagnose(), ensure_ascii=False))
    except BaseException as error:
        print(str(error) if isinstance(error, Refusal) else 'Audio inspection did not complete; raw output withheld.', file=sys.stderr)
        sys.exit(1)

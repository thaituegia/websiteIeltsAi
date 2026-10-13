import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

test("band assignment operator refuses foreign containers, ports and database configuration before stopping an app", () => {
  const result = spawnSync("python3", ["-c", String.raw`
import copy,json,runpy,sys
module=runpy.run_path(sys.argv[1])
project='website-ielts-ai-synthetic'
row={'Config':{'Labels':{'com.docker.compose.project':project,'com.docker.compose.service':'app',
 'com.docker.compose.project.working_dir':str(module['LIVE_DIR']/'deploy')}},'State':{'Running':True},
 'NetworkSettings':{'Ports':{'3001/tcp':[{'HostIp':'127.0.0.1','HostPort':'19088'}]}}}
module['verify_container'](row,project,'app')
rejected=[]
for label,alter in [
 ('foreign-project',lambda r:r['Config']['Labels'].update({'com.docker.compose.project':'another-project'})),
 ('foreign-service',lambda r:r['Config']['Labels'].update({'com.docker.compose.service':'mongo'})),
 ('foreign-directory',lambda r:r['Config']['Labels'].update({'com.docker.compose.project.working_dir':'/opt/other/deploy'})),
 ('stopped-app',lambda r:r['State'].update({'Running':False})),
 ('public-app-port',lambda r:r['NetworkSettings']['Ports'].update({'3001/tcp':[{'HostIp':'0.0.0.0','HostPort':'19088'}]})),
 ('foreign-port',lambda r:r['NetworkSettings']['Ports'].update({'3001/tcp':[{'HostIp':'127.0.0.1','HostPort':'8080'}]})),
]:
 value=copy.deepcopy(row);alter(value)
 try:module['verify_container'](value,project,'app')
 except RuntimeError:rejected.append(label)
 else:raise AssertionError(label)
env=['MONGODB_URI=mongodb://mongo:27017/ielts_ai','APP_ORIGIN=https://sutonghanyu.vn',
 'DUO_ENABLED=true','DUO_ACCOUNTS_JSON={"synthetic":"credentials-validated-inside-runner"}']
module['env_values'](env)
for label,value in [
 ('foreign-database',[x.replace('/ielts_ai','/another_project') for x in env]),
 ('foreign-mongo',[x.replace('mongodb://mongo:','mongodb://external:') for x in env]),
 ('wrong-origin',[x.replace('https://sutonghanyu.vn','https://example.com') for x in env]),
 ('duo-disabled',[x.replace('DUO_ENABLED=true','DUO_ENABLED=false') for x in env]),
 ('missing-credentials',[x for x in env if not x.startswith('DUO_ACCOUNTS_JSON=')]),
 ('duplicate-variable',env+['MONGODB_URI=mongodb://mongo:27017/ielts_ai']),
]:
 try:module['env_values'](value)
 except RuntimeError:rejected.append(label)
 else:raise AssertionError(label)
print(json.dumps({'rejected':rejected,'externalCommands':0,'databaseWrites':0}))
`, resolve("deploy/set-duo-band-3.py")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.rejected.length, 12);
  assert.equal(report.externalCommands, 0);
  assert.equal(report.databaseWrites, 0);
});

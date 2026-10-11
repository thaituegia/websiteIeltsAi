#!/usr/bin/env bash
# Operator entrypoint: add study material to a complete fresh v2/v3 bank.
# This release only preserves data; legacy and incomplete banks fail closed.
# Reuse only this deployment's private credentials, never exposing them in chat,
# shell history, script arguments or terminal output. Unknown states fail closed.
set -Eeuo pipefail
umask 077
(( $# == 5 )) || { printf '%s\n' 'Usage: run-exam-update.sh LIVE_DIR SOURCE_COMMIT ARCHIVE_SHA256 RESET_SCRIPT_SHA256 UPDATE_SCRIPT_SHA256' >&2; exit 2; }
live_dir="$1"; source_commit="$2"; archive_sha="$3"; reset_sha="$4"; update_sha="$5"
[[ "$live_dir" =~ ^/[A-Za-z0-9._/-]+$ && "$source_commit" =~ ^[a-f0-9]{40}$ && "$archive_sha" =~ ^[a-f0-9]{64}$ && "$reset_sha" =~ ^[a-f0-9]{64}$ && "$update_sha" =~ ^[a-f0-9]{64}$ && $EUID == 0 ]] || exit 2
credentials_file=''; selected_file=''; health_file=''
trap 'rm -f -- "$credentials_file" "$selected_file" "$health_file"' EXIT
credentials_file="$(mktemp /tmp/ielts-exam-accounts.XXXXXX)"
selected_file="$(mktemp /tmp/ielts-exam-code.XXXXXX)"
health_file="$(mktemp /tmp/ielts-exam-health.XXXXXX)"
# RUN_EXAM_EXISTING_CREDENTIALS_BEGIN
python3 - "$live_dir" > "$credentials_file" <<'PYACCOUNTS'
import json,os,re,stat,subprocess,sys
try:
 root=sys.argv[1];assert os.path.realpath(root)==root and os.stat(root).st_uid==0
 config=root+'/.local/deploy/deploy.env'
 assert os.path.realpath(config)==config and stat.S_ISREG(os.stat(config).st_mode) and os.stat(config).st_uid==0
 entries=[line.split('=',1)[1].strip() for line in open(config) if line.startswith('IELTS_COMPOSE_PROJECT=')]
 assert len(entries)==1 and re.fullmatch(r'website-ielts-ai-[a-z0-9][a-z0-9_-]{0,47}',entries[0])
 project=entries[0]
 def docker(args):
  r=subprocess.run(['docker']+args,capture_output=True,text=True,timeout=30);assert r.returncode==0;return r.stdout
 ids=docker(['ps','-q','--no-trunc','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service=app']).split()
 assert len(ids)==1 and re.fullmatch(r'[a-f0-9]{64}',ids[0])
 rows=json.loads(docker(['inspect',ids[0]]));assert len(rows)==1
 app=rows[0];labels=app['Config']['Labels']
 assert app['State']['Running'] and labels['com.docker.compose.project']==project and labels['com.docker.compose.service']=='app'
 assert labels['com.docker.compose.project.working_dir']==root+'/deploy'
 env={}
 for line in app['Config']['Env']:
  key,value=line.split('=',1);assert key not in env;env[key]=value
 assert env.get('DUO_ENABLED')=='true' and not env.get('DUO_CREDENTIALS_FILE')
 assert env.get('APP_ORIGIN')=='https://sutonghanyu.vn'
 settings=json.loads(env['DUO_ACCOUNTS_JSON'])
 assert isinstance(settings,dict) and set(settings)=={'duoId','accounts'}
 assert isinstance(settings['duoId'],str) and re.fullmatch(r'[a-z0-9][a-z0-9-]{2,79}',settings['duoId'])
 assert isinstance(settings['accounts'],list) and len(settings['accounts'])==2
 assert {a['role'] for a in settings['accounts']}=={'husband','wife'}
 assert len({a['phone'] for a in settings['accounts']})==2
 for a in settings['accounts']:
  assert isinstance(a,dict) and set(a)=={'role','name','phone','passwordHash'}
  assert isinstance(a['name'],str) and 2<=len(a['name'].strip())<=80 and len(a['name'])<=80 and not re.search(r'[\x00-\x1f]',a['name'])
  assert isinstance(a['phone'],str) and re.fullmatch(r'0[35789][0-9]{8}',a['phone'])
  assert isinstance(a['passwordHash'],str) and re.fullmatch(r'scrypt:[a-f0-9]{32}:[a-f0-9]{128}',a['passwordHash'])
 # The output is redirected only to a new 0600 temp file, never the terminal.
 json.dump(settings,sys.stdout,ensure_ascii=False,separators=(',',':'))
except Exception:
 sys.exit('Cannot verify existing private Duo configuration; no credentials printed or database changes made.')
PYACCOUNTS
# RUN_EXAM_EXISTING_CREDENTIALS_END
# Read only the existing trusted host gateway; no DNS choice, redirects or
# certificate bypass can route this check to another host.
curl --fail --silent --show-error --noproxy '*' --proto '=https' --connect-timeout 10 --max-time 30 --max-filesize 16384 \
  --resolve sutonghanyu.vn:443:127.0.0.1 https://sutonghanyu.vn/api/health -o "$health_file"
# RUN_EXAM_ROUTING_BEGIN
selected_script="$(python3 - "$health_file" <<'PYROUTE'
import json,sys
def route(state):
 if not isinstance(state,dict) or state.get('status')!='ok' or state.get('database')!='mongodb':
  raise ValueError('Unhealthy application')
 if state.get('duoEnabled') is not True or state.get('authMode')!='phone' or state.get('demoEnabled') is not False:
  raise ValueError('Unexpected authentication mode')
 bank=state.get('bank')
 if not isinstance(bank,dict):raise ValueError('Missing bank metadata')
 keys=('lessons','mocks','vocabulary','placement')
 if any(type(bank.get(key)) is not int or bank[key]<0 for key in keys):raise ValueError('Invalid bank counts')
 version=bank.get('version')
 if 'version' not in bank:raise ValueError('A complete fresh v2 baseline is required; reset is unavailable')
 if 'bankVersion' in state and state['bankVersion']!=version:raise ValueError('Conflicting bank versions')
 expected={'fresh-20261011-v2':(270,52,216,160),'fresh-20261011-v3':(810,156,648,480)}
 if not isinstance(version,str) or version not in expected:raise ValueError('Unknown bank version')
 if any(bank[key]<minimum for key,minimum in zip(keys,expected[version])):raise ValueError('Incomplete fresh bank')
 return 'update-exams.sh'
try:
 with open(sys.argv[1],encoding='utf-8') as source:state=json.load(source)
 print(route(state))
except Exception:
 sys.exit('Cannot safely identify the installed bank; no reset or update has been invoked.')
PYROUTE
)"
# RUN_EXAM_ROUTING_END
case "$selected_script" in
  update-exams.sh)
    selected_sha="$update_sha"
    printf '%s\n' 'Đã có ngân hàng fresh. Tăng học liệu gấp ba, giữ nguyên tài khoản, lịch sử, tiến độ và ghi âm.'
    ;;
  *) exit 2 ;;
esac
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 60 \
  "https://raw.githubusercontent.com/thaituegia/websiteIeltsAi/$source_commit/deploy/$selected_script" -o "$selected_file"
printf '%s  %s\n' "$selected_sha" "$selected_file" | sha256sum --check --status
bash "$selected_file" "$live_dir" "$source_commit" "$archive_sha" < "$credentials_file"

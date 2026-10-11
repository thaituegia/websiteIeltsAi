#!/usr/bin/env bash
# Preserving exam-bank upgrade for an already installed fresh baseline.
# Keep every user, progress, session, custom item and recording byte-for-byte;
# add only missing new exams and applicable server-only reference responses.
# Private HASH-ONLY credentials arrive on stdin, outside the build context.
# Never replaces MongoDB, proxy, gateway, certificates or firewall rules.
# After mutation starts, NEVER automatically restore the old application.
set -Eeuo pipefail
umask 077
say() { printf '\n%s\n' "$*"; }
die() { printf '\nDỪNG: %s\n' "$*" >&2; exit 1; }
usage() { printf '%s\n' 'Usage: bash update-exams.sh LIVE_DIR SOURCE_COMMIT ARCHIVE_SHA256 [--check] < PRIVATE_HASHED_CREDENTIALS_JSON' >&2; exit 2; }
(( $# == 3 || $# == 4 )) || usage
live_dir="$1"; source_commit="$2"; archive_sha256="$3"
[[ $# == 3 || "$4" == --check ]] || usage
[[ "$source_commit" =~ ^[a-f0-9]{40}$ && "$archive_sha256" =~ ^[a-f0-9]{64}$ ]] || usage
[[ "$live_dir" =~ ^/[A-Za-z0-9._/-]+$ && -d "$live_dir" && ! -L "$live_dir" ]] || usage
(( EUID == 0 )) || die 'Chạy trong phiên SSH VPS bằng root; không chạy trên PC.'
for required in docker python3 curl sha256sum awk readlink stat mktemp date sort comm cmp ss df getconf systemctl nginx flock cp chmod mkdir mv rm wc; do
  command -v "$required" >/dev/null || die "Thiếu $required; không tự cài hoặc nâng cấp hệ thống."
done
[[ "$(readlink -e -- "$live_dir")" == "$live_dir" && "$(stat -c '%u' "$live_dir")" == 0 ]] || die 'Thư mục live phải là đường dẫn thật do root sở hữu.'
private_dir="$live_dir/.local/deploy"
[[ "$(readlink -e -- "$private_dir")" == "$private_dir" && "$(stat -c '%u' "$private_dir")" == 0 ]] || die 'Thư mục private deploy bị thiếu hoặc chuyển hướng.'
config_file="$private_dir/deploy.env"; compose_file="$live_dir/deploy/compose.yaml"
compose_wrapper="$live_dir/deploy/compose.sh"; domain_override="$private_dir/domain.compose.yaml"
release_override="$private_dir/release.compose.yaml"
for file in "$config_file" "$compose_file" "$compose_wrapper" "$domain_override" "$private_dir/app.env" "$live_dir/deploy/nginx.conf" "$private_dir/tls/site.crt"; do
  [[ -f "$file" && ! -L "$file" && "$(readlink -e -- "$file")" == "$file" && "$(stat -c '%u' "$file")" == 0 ]] || die 'Thiếu file triển khai thật/root-owned, hoặc có symlink không được phép.'
done
[[ "$(readlink -e -- "$private_dir/tls")" == "$private_dir/tls" ]] || die 'TLS upstream bị chuyển hướng.'
if [[ -e "$release_override" || -L "$release_override" ]]; then
  [[ -f "$release_override" && ! -L "$release_override" && "$(stat -c '%u' "$release_override")" == 0 ]] || die 'Release override không phải file thật do root sở hữu.'
fi
read_setting() { awk -F= -v ielts_key="$1" '$1==ielts_key{n++;value=substr($0,index($0,"=")+1);sub(/\r$/,"",value)}END{if(n!=1)exit 1;print value}' "$config_file"; }
project="$(read_setting IELTS_COMPOSE_PROJECT)" || die 'Compose project thiếu hoặc bị lặp.'
public_host="$(read_setting IELTS_PUBLIC_HOST)" || die 'Thiếu địa chỉ IP đã triển khai.'
public_port="$(read_setting IELTS_PUBLIC_PORT)" || die 'Thiếu cổng HTTPS IP.'
[[ "$project" =~ ^website-ielts-ai-[a-z0-9][a-z0-9_-]{0,47}$ && "$public_host" == 66.42.62.123 && "$public_port" == 8088 ]] || die 'Metadata không khớp website IELTS đã triển khai; không ghi đè project khác.'
domain='sutonghanyu.vn'; origin="https://$domain"; loopback_port=19088
base_args=(--project-name "$project" --env-file "$config_file" -f "$compose_file" -f "$domain_override")
old_args=("${base_args[@]}")
if [[ -f "$release_override" ]]; then old_args+=(-f "$release_override"); fi
current_args=("${old_args[@]}")
private_mode="$(stat -c '%a' "$private_dir")"
[[ "$private_mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$private_mode & 0077) == 0 )) || die 'Thư mục private deploy cần chặn truy cập của group/other.'
docker info >/dev/null 2>&1 || die 'Docker chưa hoạt động; không restart Docker.'
docker compose version >/dev/null 2>&1 || die 'Thiếu Compose v2; không nâng cấp dùng chung.'
docker compose "${old_args[@]}" config --quiet || die 'Compose hiện tại không hợp lệ.'
old_source_dir="$(docker compose "${old_args[@]}" config --format json | python3 -c 'import json,sys;x=json.load(sys.stdin);print(x["services"]["app"]["build"]["context"])')" || die 'Không đọc được build context cũ.'
[[ "$old_source_dir" =~ ^/[A-Za-z0-9._/-]+$ && "$(readlink -e -- "$old_source_dir")" == "$old_source_dir" && "$(stat -c '%u' "$old_source_dir")" == 0 ]] || die 'Build context cũ không phải đường dẫn thật/root-owned.'
[[ "$old_source_dir" == "$live_dir" || "$old_source_dir" == "$live_dir/.local/releases/"* ]] || die 'Build context cũ nằm ngoài source của project này.'
if [[ -f "$release_override" ]]; then
  python3 - "$project" "$config_file" "$compose_file" "$domain_override" "$release_override" "$old_source_dir" "$private_dir/app.env" <<'PYRELEASE' || die 'Release cũ chứa thay đổi ngoài image/source và đăng nhập Duo; cần kiểm tra riêng.'
import json,os,stat,subprocess,sys
project,env,base,domain,release,old_source,app_env=sys.argv[1:]
args=['docker','compose','--project-name',project,'--env-file',env,'-f',base,'-f',domain]
def read(extra,unresolved=False):
 x=subprocess.run(args+extra+['config','--format','json']+(['--no-env-resolution'] if unresolved else []),capture_output=True,text=True,timeout=30);assert x.returncode==0;return json.loads(x.stdout)
a,b=read([]),read(['-f',release])
assert a['services']['app']['build'].get('dockerfile','Dockerfile')=='Dockerfile'
assert b['services']['app']['build'].get('dockerfile','Dockerfile') in ('Dockerfile','deploy/Dockerfile.release')
before,after=read([],True),read(['-f',release],True)
def files(data):
 return [entry['path'] if isinstance(entry,dict) else entry for entry in data['services']['app'].get('env_file',[])]
assert files(before)==[app_env]
extra=files(after)
if extra!=[app_env]:
 duo_env=os.path.join(os.path.dirname(old_source),'duo.env')
 assert extra==[app_env,duo_env] and os.path.realpath(duo_env)==duo_env
 metadata=os.lstat(duo_env)
 assert stat.S_ISREG(metadata.st_mode) and metadata.st_uid==0 and stat.S_IMODE(metadata.st_mode)==0o600 and 0<metadata.st_size<=32768
 values=b['services']['app']['environment']
 assert values.get('DUO_ENABLED')=='true' and not values.get('DUO_CREDENTIALS_FILE')
 settings=json.loads(values['DUO_ACCOUNTS_JSON'].replace('$$','$'))
 assert isinstance(settings,dict) and isinstance(settings.get('accounts'),list) and len(settings['accounts'])==2
for data in (a,b):
 app=data['services']['app'];app.pop('image',None);app['build'].pop('context',None)
 app['build'].pop('dockerfile',None)
 for key in ['DUO_ENABLED','DUO_ACCOUNTS_JSON','DUO_CREDENTIALS_FILE']:app.get('environment',{}).pop(key,None)
assert a==b
PYRELEASE
fi
up_help="$(docker compose up --help)"
for option in --wait --wait-timeout; do
  printf '%s\n' "$up_help" | awk -v ielts_option="$option" '$1==ielts_option{ok=1}END{exit !ok}' || die "Compose thiếu $option."
done
build_help="$(DOCKER_BUILDKIT=0 docker build --help 2>/dev/null)"
for option in --memory --memory-swap --cpu-period --cpu-quota; do
  [[ "$build_help" == *"$option "* ]] || die "Docker không hỗ trợ giới hạn build $option."
done
[[ "$(docker info --format '{{.MemoryLimit}} {{.CPUCfsQuota}} {{.CPUCfsPeriod}} {{.SwapLimit}}')" == 'true true true true' ]] || die 'Kernel/Docker thiếu giới hạn RAM/CPU/swap; không build không giới hạn.'
# IELTS_MEMORY_GUARD_BEGIN
# Keep the previous 1 GiB host reserve; lower the bounded build, not the reserve.
assert_memory_headroom() {
  local phase="$1" job_mib="$2" available_kib required_kib
  [[ "$job_mib" =~ ^[1-9][0-9]{0,6}$ ]] || die 'Giới hạn RAM công việc không hợp lệ.'
  available_kib="$(awk '$1=="MemAvailable:"{n++;value=$2;unit=$3}END{if(n!=1||value!~/^[0-9]+$/||value==0||unit!="kB")exit 1;print value}' /proc/meminfo)" || die 'Không đọc được MemAvailable hợp lệ; chưa thực hiện bước tiếp theo.'
  [[ "$available_kib" =~ ^[1-9][0-9]{0,11}$ ]] || die 'MemAvailable không hợp lệ; chưa thực hiện bước tiếp theo.'
  required_kib=$(( (job_mib + 1024) * 1024 ))
  if (( available_kib < required_kib )); then
    die "RAM khả dụng $(( available_kib / 1024 )) MiB; bước $phase cần $(( required_kib / 1024 )) MiB ($job_mib MiB cho công việc + 1024 MiB dự phòng)."
  fi
}
# IELTS_MEMORY_GUARD_END
assert_memory_headroom 'kiểm tra ban đầu' 512
docker_root="$(docker info --format '{{.DockerRootDir}}')"
for disk_path in "$live_dir" "$docker_root"; do
  disk_kib="$(df -Pk "$disk_path" | awk 'NR==2{print $4}')"
  [[ "$disk_kib" =~ ^[0-9]+$ ]] && (( disk_kib >= 8 * 1024 * 1024 )) || die 'Cần ít nhất 8 GiB trống tại nguồn và kho Docker.'
done
cpu_count="$(getconf _NPROCESSORS_ONLN)"; cpu_load="$(awk '{print $1}' /proc/loadavg)"
[[ "$cpu_count" =~ ^[1-9][0-9]*$ && "$cpu_load" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'Không đọc được tải CPU.'
[[ "$(awk -v ielts_load_average="$cpu_load" -v ielts_cpu_count="$cpu_count" 'BEGIN{print(ielts_load_average<ielts_cpu_count*0.8?"ready":"busy")}')" == ready ]] || die 'Server đang bận; chưa build hoặc dừng app.'
nginx_pid="$(systemctl show nginx.service --property=MainPID --value)"
[[ "$nginx_pid" =~ ^[1-9][0-9]*$ && "$(systemctl is-active nginx.service)" == active ]] || die 'Host gateway chưa hoạt động; không sửa hoặc restart.'
nginx -t >/dev/null 2>&1 || die 'Nginx hiện tại không qua kiểm tra; chưa thay đổi app.'
service_id() { docker ps -q --no-trunc --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$1"; }
old_app_id="$(service_id app)"; mongo_id="$(service_id mongo)"; proxy_id="$(service_id proxy)"
for id in "$old_app_id" "$mongo_id" "$proxy_id"; do [[ "$id" =~ ^[a-f0-9]{64}$ ]] || die 'Cần đúng một app, MongoDB và proxy của project đang chạy.'; done
old_image="$(docker inspect --format '{{.Image}}' "$old_app_id")"
old_image_ref="$(docker inspect --format '{{.Config.Image}}' "$old_app_id")"
[[ "$old_image" =~ ^sha256:[a-f0-9]{64}$ && "$(docker image inspect --format '{{.Id}}' "$old_image_ref")" == "$old_image" ]] || die 'Tag image hiện tại không khớp app đang chạy.'
# IELTS_APP_MEMORY_BEGIN
app_memory_bytes="$(docker inspect --format '{{.HostConfig.Memory}}' "$old_app_id")" || die 'Không đọc được giới hạn RAM app IELTS.'
[[ "$app_memory_bytes" =~ ^[1-9][0-9]{0,12}$ ]] && (( app_memory_bytes <= 1099511627776 )) || die 'App IELTS thiếu giới hạn RAM hợp lệ; chưa dừng app.'
app_memory_mib=$(( (app_memory_bytes + 1048575) / 1048576 ))
offline_job_mib=512
if (( app_memory_mib > offline_job_mib )); then offline_job_mib="$app_memory_mib"; fi
# IELTS_APP_MEMORY_END
current_origin="$(docker inspect --format '{{range .Config.Env}}{{if eq (index (split . "=") 0) "APP_ORIGIN"}}{{println (index (split . "=") 1)}}{{end}}{{end}}' "$old_app_id")"
[[ "$current_origin" == "$origin" ]] || die 'APP_ORIGIN không khớp tên miền đã được cấu hình.'
docker inspect "$old_app_id" "$mongo_id" "$proxy_id" | python3 -c 'import json,sys; rows=json.load(sys.stdin); project,live,port=sys.argv[1:]; assert len(rows)==3; names=set()
for row in rows:
 labels=row["Config"]["Labels"]; assert labels.get("com.docker.compose.project")==project; names.add(labels.get("com.docker.compose.service")); assert labels.get("com.docker.compose.project.working_dir")==live+"/deploy"; assert row["State"]["Running"]
 if labels.get("com.docker.compose.service")=="app": assert row["NetworkSettings"]["Ports"].get("3001/tcp")==[{"HostIp":"127.0.0.1","HostPort":port}]
assert names=={"app","mongo","proxy"}' "$project" "$live_dir" "$loopback_port" || die 'Labels/cổng của container không thuộc chính xác triển khai IELTS.'
for parent in "$private_dir/updates" "$live_dir/.local/releases"; do
  if [[ -e "$parent" || -L "$parent" ]]; then [[ -d "$parent" && ! -L "$parent" && "$(readlink -e "$parent")" == "$parent" && "$(stat -c '%u' "$parent")" == 0 ]] || die 'Thư mục update/release bị chuyển hướng.'; fi
done
curl_domain() { curl --silent --show-error --noproxy '*' --connect-timeout 10 --max-time 30 --resolve "$domain:443:127.0.0.1" "$@"; }
curl_domain --fail "$origin/api/health" | python3 -c 'import json,sys;x=json.load(sys.stdin);assert x["status"]=="ok" and x["database"]=="mongodb" and x["demoEnabled"] is False' || die 'Website hiện tại chưa healthy qua HTTPS hợp lệ.'
# UPGRADE_NETWORK_BEGIN
database_network="$(docker inspect "$old_app_id" "$mongo_id" | python3 -c 'import json,sys
app,mongo=json.load(sys.stdin); networks=mongo["NetworkSettings"]["Networks"]
assert len(networks)==1, "Mongo must use only its isolated database network"
name=next(iter(networks)); assert name in app["NetworkSettings"]["Networks"]
assert "mongo" in networks[name].get("Aliases",[]); print(name)')" || die 'Không xác định được mạng MongoDB riêng của IELTS.'
[[ "$database_network" =~ ^[a-z0-9][a-z0-9_-]{0,127}$ ]] || die 'Tên mạng database không hợp lệ.'
docker network inspect "$database_network" | python3 -c 'import json,sys
x=json.load(sys.stdin);assert len(x)==1;x=x[0]
project,mongo,app=sys.argv[1:]; labels=x.get("Labels") or {}
assert x["Internal"] is True and labels.get("com.docker.compose.project")==project and labels.get("com.docker.compose.network")=="database"
assert set(x.get("Containers",{}))=={mongo,app}' "$project" "$mongo_id" "$old_app_id" || die 'Mạng database không thuộc riêng hai container IELTS đã xác minh.'
# UPGRADE_NETWORK_END
if (( $# == 4 )); then say 'Preflight đạt; --check chỉ đọc, không build/dừng/xóa/thay đổi ứng dụng hoặc dữ liệu.'; exit 0; fi

# No mutation occurs above this line. Lock only this deployment, never Docker.
[[ ! -L "$private_dir/update.lock" ]] || die 'Lock bị chuyển hướng.'
exec 9>"$private_dir/update.lock"
flock -n 9 || die 'Project này đang có một lượt cập nhật khác.'
mkdir -p -m 700 "$private_dir/updates" "$live_dir/.local/releases"
audit_dir="$(mktemp -d "$private_dir/updates/${source_commit:0:12}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
release_dir="$(mktemp -d "$live_dir/.local/releases/${source_commit:0:12}-XXXXXX")"
source_dir="$release_dir/source"; mkdir -m 700 "$source_dir"
duo_env="$release_dir/duo.env"
nonce="${release_dir##*-}"; nonce="${nonce,,}"
new_image="$project-app:release-${source_commit:0:12}-$nonce"
if docker image inspect "$new_image" >/dev/null 2>&1; then die 'Tên image riêng đã tồn tại; chưa build.'; fi
app_stopped=false; new_app_started=false; baseline_ready=false; mutation_started=false
had_release=false
snapshot_containers() {
  local id
  while IFS= read -r id; do [[ -z "$id" ]] || docker inspect --format '{{.Id}} {{.State.Running}} {{.State.StartedAt}}' "$id" || return 1; done < "$audit_dir/before.ids"
}
snapshot_listeners() { ss -H -lntu | awk '{print $1" "$5}' | sort -u; }
protected_files=("$config_file" "$compose_file" "$domain_override" "$private_dir/app.env" "$live_dir/deploy/nginx.conf" "$private_dir/tls/site.crt")
verify_existing() {
  snapshot_containers > "$audit_dir/after.containers" || return 1
  cmp -s "$audit_dir/before.containers" "$audit_dir/after.containers" || return 1
  snapshot_listeners > "$audit_dir/after.listeners" || return 1
  comm -23 "$audit_dir/before.listeners" "$audit_dir/after.listeners" > "$audit_dir/missing.listeners" || return 1
  [[ ! -s "$audit_dir/missing.listeners" ]] || return 1
  [[ "$(systemctl show nginx.service --property=MainPID --value)" == "$nginx_pid" && "$(systemctl is-active nginx.service)" == active ]] || return 1
  sha256sum --check --status "$audit_dir/protected.sha256" || return 1
  python3 - "$audit_dir/nginx-files.json" <<'PYVERIFY' || return 1
import hashlib,json,os,sys
for path,old in json.load(open(sys.argv[1])).items():
 st=os.stat(path); now={'real':os.path.realpath(path),'sha':hashlib.sha256(open(path,'rb').read()).hexdigest(),'mode':st.st_mode,'uid':st.st_uid,'gid':st.st_gid}; assert now==old
PYVERIFY
}
preserve_ip_endpoint() {
  if curl --fail --silent --show-error --noproxy '*' --connect-timeout 5 --max-time 15 --cacert "$private_dir/tls/site.crt" --resolve "$public_host:$public_port:127.0.0.1" "https://$public_host:$public_port/api/health" -o "$audit_dir/ip-health.json" 2>/dev/null; then return 0; fi
  # Re-resolve only this project's upstream after app recreation. No host reload.
  docker compose "${current_args[@]}" exec -T proxy nginx -t > "$audit_dir/ip-proxy.log" 2>&1 || return 1
  docker compose "${current_args[@]}" exec -T proxy nginx -s reload >> "$audit_dir/ip-proxy.log" 2>&1 || return 1
  curl --fail --silent --show-error --noproxy '*' --connect-timeout 5 --max-time 30 --cacert "$private_dir/tls/site.crt" --resolve "$public_host:$public_port:127.0.0.1" "https://$public_host:$public_port/api/health" -o "$audit_dir/ip-health.json" 2>/dev/null
}
restore_old_app() {
  [[ "$(docker image inspect --format '{{.Id}}' "$old_image_ref")" == "$old_image" ]] || return 1
  cp -p -- "$audit_dir/compose.sh.before" "$compose_wrapper" || return 1
  if [[ "$had_release" == true ]]; then cp -p -- "$audit_dir/release.compose.before" "$release_override" || return 1
  else rm -f -- "$release_override" || return 1; fi
  current_args=("${old_args[@]}")
  docker compose "${current_args[@]}" up -d --no-deps --no-build --wait --wait-timeout 240 app > "$audit_dir/restore-old-app.log" 2>&1 || return 1
  [[ "$(docker inspect --format '{{.Image}}' "$(service_id app)")" == "$old_image" ]] || return 1
  preserve_ip_endpoint && verify_existing
}
# UPGRADE_FAILURE_HANDLER_BEGIN
on_exit() {
  local code=$?; trap - EXIT; set +e
  if (( code != 0 )); then
    if [[ "$mutation_started" == true ]]; then
      if [[ "$new_app_started" == true ]]; then
        if docker compose "${current_args[@]}" stop --timeout 30 app > "$audit_dir/failure-stop-new-app.log" 2>&1; then
          printf '%s\n' 'Đã dừng riêng app IELTS mới vì kiểm tra sau khởi động chưa đạt; MongoDB/proxy/website khác không bị dừng.' >&2
        else
          printf '%s\n' 'Chưa xác nhận dừng được app IELTS mới; kiểm tra failure-stop-new-app.log ngay trước khi tiếp tục.' >&2
        fi
      fi
      printf '%s\n' 'Không tự rollback hoặc khởi động image cũ sau khi bắt đầu thêm học liệu. Giữ nguyên backup riêng và database hiện tại để xử lý.' >&2
    elif [[ "$app_stopped" == true ]]; then
      if restore_old_app; then printf '%s\n' 'Đã khôi phục riêng app cũ; thêm học liệu chưa bắt đầu.' >&2
      else printf '%s\n' 'Chưa khôi phục được app cũ; database chưa thay đổi, giữ log riêng để xử lý.' >&2; fi
    fi
    if [[ "$baseline_ready" == true ]] && verify_existing; then printf '%s\n' 'Container khác/MongoDB/proxy, cổng và cấu hình host Nginx giữ nguyên.' >&2; fi
    printf 'Cập nhật bảo toàn chưa được xác nhận. Log/backup riêng: %s\n' "$audit_dir" >&2
  fi
  exit "$code"
}
# UPGRADE_FAILURE_HANDLER_END
trap on_exit EXIT

# The Python program is code only. The inherited stdin carries a bounded private
# JSON document, so no credential value enters an argument, build or log stream.
credential_validator="$(cat <<'PYCREDENTIAL'
import json,os,re,sys
try:
 raw=sys.stdin.buffer.read(16385)
 assert 2<=len(raw)<=16384
 settings=json.loads(raw)
 assert isinstance(settings,dict) and set(settings)=={'duoId','accounts'}
 assert isinstance(settings['duoId'],str) and re.fullmatch(r'[a-z0-9][a-z0-9-]{2,79}',settings['duoId'])
 accounts=settings['accounts'];assert isinstance(accounts,list) and len(accounts)==2
 for account in accounts:
  assert isinstance(account,dict) and set(account)=={'role','name','phone','passwordHash'}
  assert account['role'] in ['husband','wife']
  assert isinstance(account['name'],str) and 2<=len(account['name'].strip())<=80 and len(account['name'])<=80 and not re.search(r'[\x00-\x1f]',account['name'])
  assert isinstance(account['phone'],str) and re.fullmatch(r'0[35789]\d{8}',account['phone'])
  assert isinstance(account['passwordHash'],str) and re.fullmatch(r'scrypt:[a-f0-9]{32}:[a-f0-9]{128}',account['passwordHash'])
  account['name']=account['name'].strip()
 assert len({a['role'] for a in accounts})==len({a['phone'] for a in accounts})==2
 os.umask(0o077)
 compact=json.dumps(settings,ensure_ascii=False,separators=(',',':'))
 with open(sys.argv[1],'x') as output:output.write(compact+'\n')
 # Single-quoted dotenv values prevent dollar interpolation. Compose supports
 # an escaped apostrophe within this quoting form, including in learner names.
 escaped=compact.replace("'", "\\'")
 with open(sys.argv[2],'x') as output:output.write("DUO_ENABLED=true\nDUO_CREDENTIALS_FILE=''\nDUO_ACCOUNTS_JSON='"+escaped+"'\n")
 # Docker --env-file does not remove dotenv quotes as Compose does. Keep an
 # independently private, unquoted file for the short-lived preserving upgrade runner.
 with open(sys.argv[3],'x') as output:output.write("DUO_ENABLED=true\nDUO_CREDENTIALS_FILE=\nDUO_ACCOUNTS_JSON="+compact+"\n")
except Exception:
 sys.exit('Private hashed credential JSON is invalid; no account details printed.')
PYCREDENTIAL
)"
python3 -c "$credential_validator" "$audit_dir/credentials.json" "$duo_env" "$audit_dir/upgrade-cli.env" || die 'Cấu hình hai tài khoản riêng không hợp lệ; app cũ vẫn chạy.'
unset credential_validator
# Account configuration must be identical to the running deployment. This
# updater never changes an identity/hash indirectly through startup provisioning.
python3 - "$old_app_id" "$audit_dir/credentials.json" <<'PYSAMECREDENTIALS' || die 'Cấu hình đăng nhập không giống app hiện tại; không đổi tài khoản hoặc dừng app.'
import json,subprocess,sys
result=subprocess.run(['docker','inspect',sys.argv[1]],capture_output=True,text=True,timeout=30);assert result.returncode==0
rows=json.loads(result.stdout);assert len(rows)==1 and rows[0]['State']['Running']
values={}
for entry in rows[0]['Config']['Env']:
 key,separator,value=entry.partition('=');assert separator and key not in values;values[key]=value
assert values.get('DUO_ENABLED')=='true' and not values.get('DUO_CREDENTIALS_FILE')
assert json.loads(values['DUO_ACCOUNTS_JSON'])==json.load(open(sys.argv[2]))
PYSAMECREDENTIALS

docker ps -q --no-trunc | awk -v ielts_app="$old_app_id" '$0!=ielts_app' | sort > "$audit_dir/before.ids"
snapshot_containers > "$audit_dir/before.containers"
snapshot_listeners > "$audit_dir/before.listeners"
sha256sum "${protected_files[@]}" > "$audit_dir/protected.sha256"
python3 - "$audit_dir/nginx-files.json" <<'PYNGINX'
import hashlib,json,os,re,subprocess,sys
x=subprocess.run(['nginx','-T'],capture_output=True,text=True,timeout=30);assert x.returncode==0;assert len(x.stdout)<10_000_000
paths=re.findall(r'(?m)^# configuration file (.+):\s*$',x.stdout);assert paths
result={}
for path in paths:
 st=os.stat(path);result[path]={'real':os.path.realpath(path),'sha':hashlib.sha256(open(path,'rb').read()).hexdigest(),'mode':st.st_mode,'uid':st.st_uid,'gid':st.st_gid}
json.dump(result,open(sys.argv[1],'w'),sort_keys=True)
PYNGINX
baseline_ready=true
say 'Đang tải đúng commit và kiểm SHA256; app hiện tại vẫn chạy.'
curl --fail --show-error --silent --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 300 --retry 2 "https://codeload.github.com/thaituegia/websiteIeltsAi/tar.gz/$source_commit" -o "$audit_dir/source.tar.gz"
printf '%s  %s\n' "$archive_sha256" "$audit_dir/source.tar.gz" | sha256sum --check --status || die 'Checksum archive không khớp; chưa giải nén hoặc build.'
python3 - "$audit_dir/source.tar.gz" "$source_dir" "$source_commit" <<'PYEXTRACT'
import os,pathlib,sys,tarfile
archive,destination,commit=sys.argv[1:];assert os.path.getsize(archive)<128*1024*1024
with tarfile.open(archive,'r:gz') as bundle:
 members=bundle.getmembers();assert members and len(members)<100_000 and sum(m.size for m in members)<512*1024*1024
 expected='websiteIeltsAi-'+commit
 for member in members:
  parts=pathlib.PurePosixPath(member.name).parts
  assert parts and parts[0]==expected and not pathlib.PurePosixPath(member.name).is_absolute() and '..' not in parts
  assert member.isdir() or member.isfile(), 'Symlink/hardlink/special archive member rejected'
 for member in members:
  parts=pathlib.PurePosixPath(member.name).parts[1:]
  if not parts:continue
  target=os.path.join(destination,*parts)
  if member.isdir():os.makedirs(target,mode=0o755,exist_ok=True)
  else:
   os.makedirs(os.path.dirname(target),mode=0o755,exist_ok=True)
   with bundle.extractfile(member) as source,open(target,'xb') as output:output.write(source.read())
   os.chmod(target,0o644)
# umask 077 protects this private release and its credentials, but masks
# makedirs(0755) to 0700. The runtime COPY changes public source ownership to
# node; a capability-free root CLI must still traverse its subdirectories.
# Normalize only public source children, including implicit tar parents. Keep
# destination and every release/audit/credential/backup ancestor private.
for parent,directories,_ in os.walk(destination):
 for name in directories:os.chmod(os.path.join(parent,name),0o755)
PYEXTRACT
for file in "$source_dir/deploy/Dockerfile.release" "$source_dir/.dockerignore" "$source_dir/deploy/compose.sh" "$source_dir/server/bank-upgrade-cli.ts"; do [[ -f "$file" && ! -L "$file" ]] || die 'Archive thiếu file build/wrapper đã kiểm tra.'; done
bash -n "$source_dir/deploy/compose.sh"
awk '/release\.compose\.yaml/{ok=1}END{exit !ok}' "$source_dir/deploy/compose.sh" || die 'Wrapper của bản mới chưa hỗ trợ release override bền vững.'
cp -p -- "$compose_wrapper" "$audit_dir/compose.sh.before"
if [[ -f "$release_override" ]]; then had_release=true; cp -p -- "$release_override" "$audit_dir/release.compose.before"; fi
assert_memory_headroom 'build' 512
say 'Build riêng tối đa 512 MiB RAM, không dùng thêm swap và 0,5 CPU; giữ 1024 MiB dự phòng, chưa dừng app.'
DOCKER_BUILDKIT=0 docker build --pull --memory=512m --memory-swap=512m --cpu-period=100000 --cpu-quota=50000 --cpu-shares=128 --file "$source_dir/deploy/Dockerfile.release" --tag "$new_image" "$source_dir" > "$audit_dir/build.log" 2>&1 || die "Build lỗi; app cũ vẫn chạy. Xem $audit_dir/build.log"
assert_memory_headroom 'đọc manifest' 512
docker run --rm --network none --memory=512m --memory-swap=512m --cpus=0.25 --entrypoint node "$new_image" --import tsx --input-type=module -e 'const{contentBank,vocabularyBank,placementBank}=await import("/app/server/data/index.ts");console.log(JSON.stringify({content:contentBank.map(x=>({...x,_id:x.id})),vocabulary:vocabularyBank.map(x=>({...x,_id:x.id})),placementItems:placementBank.map(x=>({...x,_id:x.id}))}));' > "$audit_dir/seed-manifest.json" 2> "$audit_dir/manifest.log" || die 'Không đọc được manifest học liệu trong image mới.'
python3 - "$audit_dir/seed-manifest.json" <<'PYMANIFEST'
import json,sys
x=json.load(open(sys.argv[1]));assert set(x)=={'content','vocabulary','placementItems'}
assert len(x['content'])==966 and len(x['vocabulary'])==648 and len(x['placementItems'])==480
assert sum(d['format']=='lesson' for d in x['content'])==810 and sum(d['format']=='full-mock' for d in x['content'])==156
for rows in x.values():assert len({d['_id'] for d in rows})==len(rows) and all(isinstance(d['_id'],str) and d['_id']==d['id'] and d['id'].startswith('fresh-') for d in rows)
PYMANIFEST
# UPGRADE_PROVIDER_PREFLIGHT_BEGIN
assert_memory_headroom 'kiểm tra cấu hình AI' 128
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777 --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory=128m --memory-swap=128m --cpus=0.25 --user 0:0 --volume "$audit_dir/credentials.json:/run/duo-credentials.json:ro" --entrypoint node "$new_image" --import tsx --input-type=module -e 'import{readFileSync}from"node:fs";const{unlockProviderConfig}=await import("/app/server/provider-config.ts");if(!unlockProviderConfig(JSON.parse(readFileSync("/run/duo-credentials.json","utf8"))))throw Error("Không mở được cấu hình AI bằng thông tin riêng của bản cài này.");console.log(JSON.stringify({openaiConfigurationVerified:true}));' > "$audit_dir/provider-config.json" 2> "$audit_dir/provider-config.log" || die "Không xác minh được cấu hình AI; app cũ vẫn chạy. Xem $audit_dir/provider-config.log"
# UPGRADE_PROVIDER_PREFLIGHT_END
verify_existing || die 'Hiện trạng project khác thay đổi trong lúc build; chưa chuyển app.'
[[ "$(service_id app)" == "$old_app_id" && "$(docker image inspect --format '{{.Id}}' "$old_image_ref")" == "$old_image" ]] || die 'App/image cũ đã thay đổi trong lúc build.'
cat > "$audit_dir/release.compose.new" <<EORELEASE
services:
  app:
    image: $new_image
    build:
      context: $source_dir
      dockerfile: deploy/Dockerfile.release
EORELEASE
chmod 600 "$audit_dir/release.compose.new"
python3 - "$audit_dir/release.compose.new" "$duo_env" <<'PYENVFILE'
import json,sys
with open(sys.argv[1],'a') as output:
 output.write('    env_file:\n      - '+json.dumps(sys.argv[2],ensure_ascii=False)+'\n')
PYENVFILE
docker compose "${base_args[@]}" -f "$audit_dir/release.compose.new" config --quiet || die 'Release override chưa hợp lệ; chưa dừng app.'
python3 - "$project" "$config_file" "$compose_file" "$domain_override" "$audit_dir/release.compose.new" "$audit_dir/credentials.json" "$app_memory_bytes" <<'PYNEWRELEASE' || die 'Release mới đổi cấu hình ngoài image/source và đăng nhập Duo; chưa dừng app.'
import json,re,subprocess,sys
project,env,base,domain,release,credentials,app_memory=sys.argv[1:]
args=['docker','compose','--project-name',project,'--env-file',env,'-f',base,'-f',domain]
def read(extra):
 x=subprocess.run(args+extra+['config','--format','json'],capture_output=True,text=True,timeout=30);assert x.returncode==0;return json.loads(x.stdout)
a,b=read([]),read(['-f',release])
assert a['services']['app']['build'].get('dockerfile','Dockerfile')=='Dockerfile'
assert b['services']['app']['build'].get('dockerfile')=='deploy/Dockerfile.release'
rendered_memory=b['services']['app'].get('mem_limit')
assert type(rendered_memory) is int or isinstance(rendered_memory,str) and re.fullmatch(r'[1-9][0-9]{0,12}',rendered_memory)
assert int(rendered_memory)==int(app_memory)
credentials=json.load(open(credentials));duo=b['services']['app']['environment']
# Compose escapes each literal dollar as $$ in its rendered config JSON.
assert duo.get('DUO_ENABLED')=='true' and json.loads(duo['DUO_ACCOUNTS_JSON'].replace('$$','$'))==credentials and not duo.get('DUO_CREDENTIALS_FILE')
for data in (a,b):
 app=data['services']['app'];app.pop('image',None);app['build'].pop('context',None)
 app['build'].pop('dockerfile',None)
 for key in ['DUO_ENABLED','DUO_ACCOUNTS_JSON','DUO_CREDENTIALS_FILE']:app.get('environment',{}).pop(key,None)
assert a==b
PYNEWRELEASE
# UPGRADE_RUNNER_BEGIN
run_upgrade_cli() {
  # The only privileged process is this short-lived CLI. It has no capabilities,
  # no ports, a read-only image and only its own private backup mount.
  local action="$1"
  assert_memory_headroom "CLI $action" 512
  local args=(run --rm --network "$database_network" --memory=512m --memory-swap=512m --cpus=0.5 --pids-limit=64
    --user 0:0 --cap-drop ALL --security-opt no-new-privileges:true --read-only
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m
    --env-file "$private_dir/app.env" --env-file "$audit_dir/upgrade-cli.env"
    -e MONGODB_URI=mongodb://mongo:27017/ielts_ai -e NODE_ENV=production -e IELTS_APP_OFFLINE=true)
  if [[ "$action" == verify ]]; then
    args+=(--mount "type=bind,src=$audit_dir/backup,dst=/backup,readonly")
  elif [[ "$action" == apply ]]; then
    args+=(--mount "type=bind,src=$audit_dir/backup,dst=/backup")
  elif [[ "$action" != inspect && "$action" != verify ]]; then return 2; fi
  args+=(--entrypoint node "$new_image" --import tsx /app/server/bank-upgrade-cli.ts "$action")
  if [[ "$action" == apply || "$action" == verify ]]; then args+=(/backup/bank); fi
  docker "${args[@]}"
}
# UPGRADE_RUNNER_END
say 'Bản build đạt. Đang kiểm tra chỉ đọc bộ fresh hiện có; app cũ vẫn chạy.'
run_upgrade_cli inspect > "$audit_dir/upgrade-inspect.json" 2> "$audit_dir/upgrade-inspect.log" || die 'Bộ fresh ban đầu chưa đầy đủ; không tự reset dữ liệu cũ. App vẫn chạy.'
python3 - "$audit_dir/upgrade-inspect.json" <<'PYUPGRADEINSPECT' || die 'Inspect không khớp database/bộ dữ liệu mới.'
import json,sys
x=json.load(open(sys.argv[1]));assert x['database']=='ielts_ai' and x['bankVersion']=='fresh-20261011-v3'
assert x['target']=={'content':966,'lessons':810,'mocks':156,'vocabulary':648,'placement':480}
for key,maximum in [('newContentIds',644),('newVocabularyIds',432),('newPlacementIds',320)]:
 assert isinstance(x[key],list) and 0<=len(x[key])<=maximum and len(set(x[key]))==len(x[key])
 assert all(isinstance(value,str) and value.startswith('fresh-x3-') for value in x[key])
PYUPGRADEINSPECT
assert_memory_headroom 'trước dừng app IELTS' 512
say 'Chỉ app IELTS tạm dừng. Sao lưu riêng rồi thêm bài luyện, đề, từ vựng và câu đầu vào; giữ nguyên mọi tài khoản, bài làm, lịch sử, tiến độ và ghi âm.'
app_stopped=true
docker compose "${old_args[@]}" stop --timeout 30 app > "$audit_dir/stop-old-app.log" 2>&1 || die 'Không dừng được riêng app IELTS.'
[[ "$(docker inspect --format '{{.State.Running}}' "$old_app_id")" == false && -z "$(service_id app)" ]] || die 'App chưa offline; không chạy updater.'
assert_memory_headroom 'chuẩn bị database và app mới' "$offline_job_mib"
# Switch only this project's future app image while it is stopped. Before the
# marker, a failure still restores the old files; after it, manual Compose up
# must use the new image and its fresh-bank startup guard, never the old seed.
cp -p -- "$source_dir/deploy/compose.sh" "$compose_wrapper"
cp -p -- "$audit_dir/release.compose.new" "$release_override"
chmod 600 "$release_override"
current_args=("${base_args[@]}" -f "$release_override")
bash "$compose_wrapper" validate || die 'Wrapper/live Compose không hợp lệ; thêm học liệu chưa bắt đầu.'
mkdir -m 700 "$audit_dir/backup"
# This persistent marker is deliberately written BEFORE any call that could
# mutate MongoDB. Even a backup-stage failure after this point stays offline.
assert_memory_headroom 'trước thay đổi database' "$offline_job_mib"
printf '%s\n' "$source_commit" > "$audit_dir/mutation-started"
mutation_started=true
run_upgrade_cli apply > "$audit_dir/upgrade-apply.json" 2> "$audit_dir/upgrade-apply.log" || die 'Thêm học liệu chưa hoàn tất; giữ app offline và backup riêng, không tự khôi phục image cũ.'
run_upgrade_cli verify > "$audit_dir/upgrade-verify.json" 2> "$audit_dir/upgrade-verify.log" || die 'Đối chiếu bảo toàn sau cập nhật chưa đạt; không khởi động app.'
python3 - "$audit_dir/upgrade-apply.json" "$audit_dir/upgrade-verify.json" "$audit_dir/backup/bank/receipt.json" <<'PYUPGRADEVERIFY' || die 'Receipt hoặc đối chiếu bảo toàn dữ liệu chưa đạt; giữ app offline.'
import json,sys
for path in sys.argv[1:3]:
 report=json.load(open(path))
 assert report['status']=='verified' and report['bankVersion']=='fresh-20261011-v3' and report['allPreviousDocumentsPreserved'] is True
 assert report['bank']=={'content':966,'lessons':810,'mocks':156,'vocabulary':648,'placement':480}
 assert 0<=report['newContentAdded']<=644 and 0<=report['newVocabularyAdded']<=432 and 0<=report['newPlacementItemsAdded']<=320 and report['retainedAccounts']>=2
receipt=json.load(open(sys.argv[3]))
assert receipt['database']=='ielts_ai' and receipt['state']=='complete' and receipt['bankVersion']=='fresh-20261011-v3' and receipt['backups']
assert all(isinstance(receipt[key],list) for key in ['newContentIds','newVocabularyIds','newPlacementIds'])
PYUPGRADEVERIFY
# Verify all old documents and reference additions while offline, before startup.
assert_memory_headroom 'khởi động app mới' "$app_memory_mib"
new_app_started=true
docker compose "${current_args[@]}" up -d --no-deps --no-build --wait --wait-timeout 240 app > "$audit_dir/up-new-app.log" 2>&1 || die 'App mới chưa healthy.'
new_app_id="$(service_id app)"
[[ "$new_app_id" =~ ^[a-f0-9]{64}$ && "$(docker inspect --format '{{.Config.Image}}' "$new_app_id")" == "$new_image" ]] || die 'App không chạy đúng image mới.'
docker inspect --format '{{json .NetworkSettings.Ports}}' "$new_app_id" | python3 -c 'import json,sys;assert json.load(sys.stdin).get("3001/tcp")==[{"HostIp":"127.0.0.1","HostPort":"19088"}]' || die 'Binding mới không còn loopback chính xác.'
[[ "$(docker inspect --format '{{range .Config.Env}}{{if eq (index (split . "=") 0) "APP_ORIGIN"}}{{println (index (split . "=") 1)}}{{end}}{{end}}' "$new_app_id")" == "$origin" ]] || die 'Origin bị thay đổi.'
curl_domain --fail "$origin/api/health" -o "$audit_dir/health.json"
python3 - "$audit_dir/health.json" <<'PYHEALTH'
import json,sys
x=json.load(open(sys.argv[1]));assert x['status']=='ok' and x['database']=='mongodb' and x['demoEnabled'] is False
targets={'lessons':810,'mocks':156,'vocabulary':648,'placement':480}
assert x.get('duoEnabled') is True and x.get('authMode')=='phone'
assert x.get('services',{}).get('openai') is True
assert x['bank'].get('version')=='fresh-20261011-v3'
assert all(type(x['bank'].get(name)) is int and x['bank'][name]>=count for name,count in targets.items())
PYHEALTH
curl_domain --fail "$origin/api/auth/me" -o "$audit_dir/auth.json"
python3 - "$audit_dir/auth.json" <<'PYAUTH'
import json,sys
assert json.load(open(sys.argv[1]))['user'] is None
PYAUTH
status="$(curl_domain -X POST -H "Origin: $origin" -H 'Content-Type: application/json' --data '{}' "$origin/api/auth/register" -o "$audit_dir/invalid-registration.json" -w '%{http_code}')"
[[ "$status" == 403 ]] || die 'Đăng ký tài khoản mới chưa bị từ chối.'
status="$(curl_domain -X POST -H 'Origin: https://example.invalid' -H 'Content-Type: application/json' --data '{}' "$origin/api/auth/register" -o "$audit_dir/wrong-origin.json" -w '%{http_code}')"
[[ "$status" == 403 ]] || die 'Origin khác chưa bị từ chối.'
status="$(curl_domain -X POST -H "Origin: $origin" -H 'Content-Type: application/json' --data '{"phone":"0390000003","password":"synthetic-denied-login"}' "$origin/api/auth/login" -o "$audit_dir/denied-login.json" -w '%{http_code}')"
[[ "$status" == 401 ]] || die 'Tài khoản ngoài danh sách chưa bị từ chối.'
status="$(curl_domain -X POST -H "Origin: $origin" -H 'Content-Type: application/json' --data '{"learner":1}' "$origin/api/auth/demo" -o "$audit_dir/denied-demo.json" -w '%{http_code}')"
[[ "$status" == 403 ]] || die 'Đăng nhập demo chưa bị từ chối.'
curl_domain --fail "$origin/" -o "$audit_dir/index.html"
asset="$(python3 - "$audit_dir/index.html" <<'PYASSET'
import re,sys
m=re.search(r'<script[^>]+src="(/assets/[a-zA-Z0-9._-]+\.js)"',open(sys.argv[1]).read());assert m;print(m.group(1))
PYASSET
)" || die 'Giao diện thiếu JavaScript build.'
curl_domain --fail "$origin$asset" -D "$audit_dir/asset.headers" -o "$audit_dir/app.js"
awk 'tolower($0)~/^content-type:.*(javascript|ecmascript)/{ok=1}END{exit !ok}' "$audit_dir/asset.headers" || die 'File frontend trả sai kiểu dữ liệu.'
[[ "$(wc -c < "$audit_dir/app.js")" -gt 100 ]] || die 'JavaScript trống.'
# Public files retain their paths when Vite copies them into dist. Verify the
# exact image bytes through the existing HTTPS gateway, not just HTTP 200: a
# missing font/image otherwise falls through to the SPA's index.html response.
python3 - "$audit_dir/index.html" "$source_dir/public" "$new_app_id" "$audit_dir/static-assets.tsv" <<'PYSTATICMANIFEST' || die 'Không đối chiếu được CSS, hình ảnh và font trong image mới.'
import hashlib,json,pathlib,re,subprocess,sys
from html.parser import HTMLParser
class Stylesheets(HTMLParser):
 def __init__(self):super().__init__();self.paths=[]
 def handle_starttag(self,tag,attrs):
  attributes=dict(attrs)
  if tag=='link' and 'stylesheet' in (attributes.get('rel') or '').lower().split():self.paths.append(attributes.get('href'))
parser=Stylesheets();parser.feed(pathlib.Path(sys.argv[1]).read_text())
paths=sorted(set(parser.paths));assert paths, 'Deployed HTML has no linked stylesheet'
mimes={'.css':'text/css','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'}
def validate(path):
 assert isinstance(path,str) and re.fullmatch(r'/(assets|fonts)/[A-Za-z0-9_./-]+',path)
 parts=pathlib.PurePosixPath(path);assert '..' not in parts.parts and str(parts)==path
 return parts.suffix.lower()
for path in paths:assert validate(path)=='.css' and path.startswith('/assets/')
expected={};public=pathlib.Path(sys.argv[2])
for folder in ['assets','fonts']:
 for file in sorted((public/folder).rglob('*')):
  if file.is_file() and file.suffix.lower() in ['.webp','.svg','.woff2']:
   assert not file.is_symlink()
   path='/'+file.relative_to(public).as_posix();validate(path)
   data=file.read_bytes();assert 0<len(data)<=16*1024*1024
   expected[path]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
paths=sorted(set(paths)|set(expected));assert 1<=len(paths)<=128
image_program=r'''
const fs=require("node:fs"),crypto=require("node:crypto"),path=require("node:path");
const root="/app/dist";
const rows=JSON.parse(process.argv[1]).map(url=>{
 const target=path.resolve(root,"."+url);
 if(!target.startsWith(root+"/")||fs.realpathSync(target)!==target)throw Error("Invalid static image path");
 const stat=fs.statSync(target);if(!stat.isFile()||stat.size<=0||stat.size>16*1024*1024)throw Error("Invalid static image file");
 const data=fs.readFileSync(target);return {path:url,sha256:crypto.createHash("sha256").update(data).digest("hex"),bytes:data.length};
});console.log(JSON.stringify(rows));
'''
result=subprocess.run(['docker','exec',sys.argv[3],'node','-e',image_program,json.dumps(paths)],capture_output=True,text=True,timeout=30)
assert result.returncode==0, 'Cannot read built static files from the new app'
rows=json.loads(result.stdout);assert isinstance(rows,list) and [row['path'] for row in rows]==paths
assert sum(row['bytes'] for row in rows)<=32*1024*1024
with open(sys.argv[4],'x') as output:
 for row in rows:
  assert re.fullmatch(r'[a-f0-9]{64}',row['sha256']) and 0<row['bytes']<=16*1024*1024
  if row['path'] in expected:assert {key:row[key] for key in ['sha256','bytes']}==expected[row['path']], 'Public static asset differs from source'
  output.write(f"{row['path']}\t{row['sha256']}\t{row['bytes']}\t{mimes[validate(row['path'])]}\n")
PYSTATICMANIFEST
static_index=0
while IFS=$'\t' read -r static_path static_sha static_bytes static_mime; do
  static_index=$((static_index + 1))
  curl_domain --fail --max-filesize 16777216 "$origin$static_path" -D "$audit_dir/static-$static_index.headers" -o "$audit_dir/static-$static_index.body" || die 'Không tải được CSS, hình ảnh hoặc font qua HTTPS.'
  python3 - "$audit_dir/static-$static_index.headers" "$audit_dir/static-$static_index.body" "$static_sha" "$static_bytes" "$static_mime" <<'PYSTATICCHECK' || die 'CSS, hình ảnh hoặc font trả sai kiểu dữ liệu/nội dung; chưa xác nhận cập nhật.'
import hashlib,pathlib,re,sys
headers=pathlib.Path(sys.argv[1]).read_text()
types=re.findall(r'^content-type:\s*([^\r\n]+)',headers,re.I|re.M)
assert types and types[-1].split(';')[0].strip().lower()==sys.argv[5], 'Static asset MIME mismatch'
data=pathlib.Path(sys.argv[2]).read_bytes()
assert len(data)==int(sys.argv[4]) and hashlib.sha256(data).hexdigest()==sys.argv[3], 'Static asset bytes differ from the deployed image'
PYSTATICCHECK
done < "$audit_dir/static-assets.tsv"
preserve_ip_endpoint || die 'Endpoint IP cũ chưa hoạt động sau cập nhật.'
verify_existing || die 'Container/cổng/cấu hình khác đã thay đổi trong lúc cập nhật.'
printf '%s\n' "$source_commit" > "$audit_dir/source.commit"
printf '%s\n' success > "$audit_dir/result"
say 'HOÀN TẤT: giữ nguyên tất cả tài khoản, bài làm, placement, lộ trình, ghi âm, từ đã lưu và phiên đăng nhập. Ngân hàng có 810 bài luyện, 156 đề mô phỏng, 648 từ vựng và 480 câu đầu vào cùng đáp án sau khi nộp.'
printf 'Website: %s\nImage riêng: %s\nNguồn mới: %s\nLog/backup riêng: %s\n' "$origin" "$new_image" "$source_dir" "$audit_dir"
say 'Không cần làm lại kiểm tra đầu vào. Backup riêng giữ trên VPS; MongoDB/proxy/website khác không bị thay thế. HTTPS đã kiểm tra tại server; chưa xác nhận truy cập Internet từ lệnh này.'

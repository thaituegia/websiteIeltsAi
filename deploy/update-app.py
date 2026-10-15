#!/usr/bin/env python3
"""Update only this installation's app when its bundled study bank is unchanged.

No migration/reset CLI, worker changes, database backup/restore, or shared
service restart is performed. An unhealthy replacement restores the previous
app image and Compose override; every check that can run online runs first.
"""
import copy
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request

GUARDS_SHA = '179cf2d406b60fe74a0ac9e0e33676fb6f2e54d3e9b52d1858405d3b3dea2812'
DIAGNOSTIC_SHA = '8ba0383c4c02303e27bd92591d6b58ea5c5987d7d3a88f5f99b30d0e79d06791'
LIVE_DIR = pathlib.Path('/opt/websiteIeltsAi-20261007T172235Z-7D7gnc')
PROJECT = 'website-ielts-ai-20261007172235-7d7gnc'
ORIGIN = 'https://sutonghanyu.vn'
BANK_PROGRAM = '''import{createHash}from"node:crypto";
const{contentBank,vocabularyBank,placementBank}=await import("/app/server/data/index.ts");
console.log(createHash("sha256").update(JSON.stringify([contentBank,vocabularyBank,placementBank])).digest("hex"));'''


def owned(path, directory=False, private=False):
    info = path.lstat()
    if (path.resolve(strict=True) != path or info.st_uid != 0 or
            not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) or
            (private and info.st_mode & 0o077)):
        raise RuntimeError('Đường dẫn triển khai bị chuyển hướng hoặc quyền không an toàn.')
    return info


def atomic_write(path, data):
    temporary = path.with_name(path.name + '.tmp-' + os.urandom(6).hex())
    try:
        with temporary.open('xb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def download(url, digest, path, limit):
    expected_host = urllib.parse.urlparse(url).hostname
    with urllib.request.urlopen(url, timeout=120) as response:
        actual = urllib.parse.urlparse(response.url)
        if response.status != 200 or actual.hostname != expected_host or actual.scheme != 'https':
            raise RuntimeError('Nguồn tải không đúng máy chủ HTTPS đã ghim.')
        data = response.read(limit + 1)
    if len(data) > limit or hashlib.sha256(data).hexdigest() != digest:
        raise RuntimeError('SHA256 nguồn không khớp; chưa chạy nguồn tải đó.')
    path.write_bytes(data)


def checked_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def extract_source(archive, destination, commit):
    with tarfile.open(archive, 'r:gz') as bundle:
        members = bundle.getmembers()
        if not members or len(members) > 100000 or sum(item.size for item in members) > 512 * 1024 * 1024:
            raise RuntimeError('Archive vượt giới hạn.')
        for item in members:
            parts = pathlib.PurePosixPath(item.name).parts
            if (not parts or parts[0] != 'websiteIeltsAi-' + commit or '..' in parts or
                    pathlib.PurePosixPath(item.name).is_absolute() or not (item.isdir() or item.isfile())):
                raise RuntimeError('Archive chứa đường dẫn/link không hợp lệ.')
        for item in members:
            parts = pathlib.PurePosixPath(item.name).parts[1:]
            if not parts:
                continue
            target = destination.joinpath(*parts)
            if item.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(item) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o644)
    for parent, directories, _ in os.walk(destination):
        for name in directories:
            pathlib.Path(parent, name).chmod(0o755)


def credentials(raw):
    if not isinstance(raw, str) or not 2 <= len(raw) <= 16384:
        raise RuntimeError('Cấu hình hai tài khoản không hợp lệ; không in thông tin riêng.')
    data = json.loads(raw)
    if not isinstance(data, dict) or set(data) != {'duoId', 'accounts'} or not isinstance(data['accounts'], list):
        raise RuntimeError('Cấu hình hai tài khoản không hợp lệ; không in thông tin riêng.')
    if not isinstance(data['duoId'], str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{2,79}', data['duoId']):
        raise RuntimeError('Cấu hình hai tài khoản không hợp lệ; không in thông tin riêng.')
    if len(data['accounts']) != 2:
        raise RuntimeError('Cần đúng hai tài khoản hiện tại.')
    for account in data['accounts']:
        if (not isinstance(account, dict) or set(account) != {'role', 'name', 'phone', 'passwordHash'} or
                account['role'] not in ('husband', 'wife') or not isinstance(account['name'], str) or
                not 2 <= len(account['name'].strip()) <= len(account['name']) <= 80 or
                re.search(r'[\x00-\x1f]', account['name']) or
                not isinstance(account['phone'], str) or not re.fullmatch(r'0[35789][0-9]{8}', account['phone']) or
                not isinstance(account['passwordHash'], str) or
                not re.fullmatch(r'scrypt:[a-f0-9]{32}:[a-f0-9]{128}', account['passwordHash'])):
            raise RuntimeError('Cấu hình hai tài khoản không hợp lệ; không in thông tin riêng.')
    if len({row['role'] for row in data['accounts']}) != 2 or len({row['phone'] for row in data['accounts']}) != 2:
        raise RuntimeError('Hai tài khoản bị lặp.')
    return data


def service(guards, name):
    identifiers = guards.command(['docker', 'ps', '-q', '--no-trunc', '--filter',
                                 'label=com.docker.compose.project=' + PROJECT, '--filter',
                                 'label=com.docker.compose.service=' + name]).split()
    if len(identifiers) != 1 or not re.fullmatch(r'[a-f0-9]{64}', identifiers[0]):
        raise RuntimeError('Không xác định được đúng container IELTS đang chạy.')
    row = guards.inspect(identifiers[0])
    guards.verify_container(row, PROJECT, name)
    if row['Id'] != identifiers[0] or not re.fullmatch(r'sha256:[a-f0-9]{64}', row['Image']):
        raise RuntimeError('Định danh container/image không hợp lệ.')
    return row


def network_identity(guards, rows):
    expected = {'app': {PROJECT + '_web', PROJECT + '_database'},
                'mongo': {PROJECT + '_database'}, 'proxy': {PROJECT + '_web'}}
    result = {}
    for name, row in rows.items():
        networks = row['NetworkSettings']['Networks']
        if set(networks) != expected[name]:
            raise RuntimeError('Mạng container không thuộc bản cài IELTS.')
        for network, value in networks.items():
            identifier = value.get('NetworkID', '')
            if not re.fullmatch(r'[a-f0-9]{64}', identifier) or result.get(network, identifier) != identifier:
                raise RuntimeError('Định danh mạng không hợp lệ.')
            result[network] = identifier
    for network, identifier in result.items():
        info = json.loads(guards.command(['docker', 'network', 'inspect', network]))
        kind = 'database' if network.endswith('_database') else 'web'
        if (len(info) != 1 or info[0].get('Id') != identifier or info[0].get('Name') != network or
                info[0].get('Internal') is not (kind == 'database') or
                (info[0].get('Labels') or {}).get('com.docker.compose.project') != PROJECT or
                (info[0].get('Labels') or {}).get('com.docker.compose.network') != kind):
            raise RuntimeError('Quyền sở hữu mạng không khớp.')
    return result


def compose_config(guards, base, override, unresolved=False):
    return json.loads(guards.command(base + (['-f', str(override)] if override else []) +
                                    ['config', '--format', 'json'] + (['--no-env-resolution'] if unresolved else [])))


def comparable_config(config):
    result = copy.deepcopy(config)
    app = result['services']['app']
    app.pop('image', None)
    app['build'].pop('context', None)
    app['build'].pop('dockerfile', None)
    return result


def config_environment(config):
    return {key: str(value).replace('$$', '$') for key, value in config['services']['app']['environment'].items()}


def validate_config(current, proposed, values, app_memory):
    if comparable_config(current) != comparable_config(proposed):
        raise RuntimeError('Compose mới thay đổi cấu hình ngoài image/source; chưa thay app.')
    if (int(current['services']['app'].get('mem_limit', 0)) != app_memory or
            int(proposed['services']['app'].get('mem_limit', 0)) != app_memory or app_memory <= 0):
        raise RuntimeError('Giới hạn RAM app không khớp bản đang chạy.')
    for config in (current, proposed):
        environment = config_environment(config)
        if any(values.get(key) != value for key, value in environment.items()):
            raise RuntimeError('Cấu hình Compose khác app đang chạy; chưa thay app.')
        if credentials(environment.get('DUO_ACCOUNTS_JSON')) != credentials(values.get('DUO_ACCOUNTS_JSON')):
            raise RuntimeError('Tài khoản khác app đang chạy; chưa thay app.')


def file_snapshot(paths):
    result = {}
    for path in paths:
        info = path.stat()
        result[str(path)] = (str(path.resolve(strict=True)), info.st_uid, info.st_gid,
                             info.st_mode, hashlib.sha256(path.read_bytes()).hexdigest())
    return result


def run_logged(args, audit, label, timeout=1800, environment=None):
    with (audit / (label + '.log')).open('xb') as output:
        result = subprocess.run(args, stdout=output, stderr=subprocess.STDOUT, timeout=timeout, env=environment)
    if result.returncode:
        raise RuntimeError('Bước ' + label + ' chưa đạt. Log riêng: ' + str(audit / (label + '.log')))


def image_bank(guards, image):
    guards.memory_headroom(512)
    result = guards.command(['docker', 'run', '--rm', '--network=none', '--memory=512m', '--memory-swap=512m',
                             '--cpus=0.5', '--pids-limit=64', '--read-only', '--cap-drop=ALL',
                             '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m',
                             '--security-opt=no-new-privileges:true', '--entrypoint=node', image,
                             '--import', 'tsx', '--input-type=module', '-e', BANK_PROGRAM], timeout=180)
    if not re.fullmatch(r'[a-f0-9]{64}\s*', result):
        raise RuntimeError('Không đọc được dấu vân tay học liệu trong image.')
    return result.strip()


def healthy(guards, diagnostic, expected_image=None):
    app = service(guards, 'app')
    if (app['State'].get('Health', {}).get('Status') != 'healthy' or
            (expected_image and app['Image'] != expected_image) or
            diagnostic.health().get('ok') is not True or diagnostic.health(tls=True).get('ok') is not True):
        raise RuntimeError('App chưa healthy trực tiếp và qua HTTPS hợp lệ.')
    return app


def deploy(guards, diagnostic, commit, archive_sha):
    owned(LIVE_DIR, directory=True)
    private = LIVE_DIR / '.local/deploy'
    owned(private, directory=True, private=True)
    if guards.LIVE_DIR != LIVE_DIR or diagnostic.LIVE_DIR != LIVE_DIR or guards.read_project(private / 'deploy.env') != PROJECT:
        raise RuntimeError('Không đúng bản cài IELTS đã xác minh.')
    lock_path = private / 'update.lock'
    if lock_path.exists() or lock_path.is_symlink():
        owned(lock_path, private=True)
    with os.fdopen(os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Project này đang có lượt cập nhật khác.') from None
        update_locked(guards, diagnostic, commit, archive_sha, private)


def update_locked(guards, diagnostic, commit, archive_sha, private):
    base_file, domain, release = LIVE_DIR / 'deploy/compose.yaml', private / 'domain.compose.yaml', private / 'release.compose.yaml'
    protected = [private / 'deploy.env', private / 'app.env', base_file, domain, LIVE_DIR / 'deploy/compose.sh',
                 LIVE_DIR / 'deploy/nginx.conf', private / 'tls/site.crt']
    for path in protected:
        owned(path, private=path in (private / 'deploy.env', private / 'app.env', domain))
    owned(release, private=True)
    base = ['docker', 'compose', '--project-name', PROJECT, '--env-file', str(private / 'deploy.env'),
            '-f', str(base_file), '-f', str(domain)]
    current = compose_config(guards, base, release)
    rows = {name: service(guards, name) for name in ('app', 'mongo', 'proxy')}
    original = rows['app']
    healthy(guards, diagnostic, original['Image'])
    networks = network_identity(guards, rows)
    values = guards.env_values(original['Config']['Env'])
    settings = credentials(values['DUO_ACCOUNTS_JSON'])
    old_image_ref = current['services']['app'].get('image')
    if not old_image_ref or guards.command(['docker', 'image', 'inspect', '--format', '{{.Id}}', old_image_ref]).strip() != original['Image']:
        raise RuntimeError('Image Compose hiện tại không khớp app đang chạy.')
    old_source = pathlib.Path(current['services']['app']['build']['context'])
    if old_source != LIVE_DIR and LIVE_DIR / '.local/releases' not in old_source.parents:
        raise RuntimeError('Build context hiện tại nằm ngoài source riêng của IELTS.')
    owned(old_source, directory=True)
    unresolved = compose_config(guards, base, release, unresolved=True)
    for entry in unresolved['services']['app'].get('env_file', []):
        path = pathlib.Path(entry['path'] if isinstance(entry, dict) else entry)
        if path != private / 'app.env' and path != old_source.parent / 'duo.env':
            raise RuntimeError('Env file hiện tại nằm ngoài cấu hình riêng đã xác minh.')
        owned(path, private=True)
        protected.append(path)
    guards.memory_headroom(512)
    if float(pathlib.Path('/proc/loadavg').read_text().split()[0]) >= (os.cpu_count() or 1) * 0.8:
        raise RuntimeError('Server đang bận; chưa build hoặc dừng app.')
    limits = guards.command(['docker', 'info', '--format', '{{.MemoryLimit}} {{.CPUCfsQuota}} {{.CPUCfsPeriod}} {{.SwapLimit}}']).strip()
    if limits != 'true true true true':
        raise RuntimeError('Docker thiếu giới hạn RAM/CPU/swap; chưa build.')
    docker_root = pathlib.Path(guards.command(['docker', 'info', '--format', '{{.DockerRootDir}}']).strip())
    if any(shutil.disk_usage(path).free < 8 * 1024 ** 3 for path in (LIVE_DIR, docker_root)):
        raise RuntimeError('Cần ít nhất 8 GiB trống tại nguồn và kho Docker.')
    guards.command(['nginx', '-t'])
    nginx_pid = guards.command(['systemctl', 'show', 'nginx.service', '--property=MainPID', '--value']).strip()
    if not re.fullmatch(r'[1-9][0-9]*', nginx_pid):
        raise RuntimeError('Gateway Nginx chưa hoạt động.')
    nginx_text = guards.command(['nginx', '-T'])
    nginx_paths = [pathlib.Path(path) for path in re.findall(r'(?m)^# configuration file (.+):\s*$', nginx_text)]
    if not nginx_paths:
        raise RuntimeError('Không xác định được các tệp gateway hiện tại.')
    protected.extend(nginx_paths)
    before_files = file_snapshot(protected)
    before_other = guards.running_snapshot(original['Id'])
    listeners = set(guards.listener_snapshot())
    release_bytes = release.read_bytes()
    parents = [private / 'app-updates', LIVE_DIR / '.local/releases']
    for path in parents:
        if not path.exists():
            path.mkdir(mode=0o700)
        owned(path, directory=True, private=True)
    stamp = commit[:12] + '-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + os.urandom(3).hex()
    audit, release_dir = parents[0] / stamp, parents[1] / stamp
    audit.mkdir(mode=0o700)
    release_dir.mkdir(mode=0o700)
    source = release_dir / 'source'
    source.mkdir(mode=0o700)
    (audit / 'release.compose.before').write_bytes(release_bytes)
    print('Đang tải và build app mới; app hiện tại vẫn phục vụ. Log riêng: ' + str(audit), flush=True)
    archive = audit / 'source.tar.gz'
    download('https://codeload.github.com/thaituegia/websiteIeltsAi/tar.gz/' + commit, archive_sha, archive, 128 * 1024 * 1024)
    extract_source(archive, source, commit)
    for path in (source / 'deploy/Dockerfile.release', source / '.dockerignore'):
        owned(path)
    duo_env = release_dir / 'duo.env'
    compact = json.dumps(settings, ensure_ascii=False, separators=(',', ':')).replace("'", "\\'")
    duo_env.write_text("DUO_ENABLED=true\nDUO_CREDENTIALS_FILE=''\nDUO_ACCOUNTS_JSON='" + compact + "'\n")
    image = PROJECT + '-app:release-' + stamp
    guards.memory_headroom(512)
    environment = dict(os.environ, DOCKER_BUILDKIT='0')
    run_logged(['docker', 'build', '--pull', '--memory=512m', '--memory-swap=512m', '--cpu-period=100000',
                '--cpu-quota=50000', '--cpu-shares=128', '--file', str(source / 'deploy/Dockerfile.release'),
                '--tag', image, str(source)], audit, 'build', environment=environment)
    image_id = guards.command(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]).strip()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id):
        raise RuntimeError('Image mới chưa có định danh bất biến; app cũ vẫn chạy.')
    if image_bank(guards, original['Image']) != image_bank(guards, image_id):
        raise RuntimeError('Học liệu khác bản đang chạy; chỉ updater học liệu mới được áp dụng, app cũ vẫn chạy.')
    candidate = audit / 'release.compose.new'
    candidate.write_text('services:\n  app:\n    image: ' + image + '\n    build:\n      context: ' + str(source) +
                         '\n      dockerfile: deploy/Dockerfile.release\n    env_file:\n      - ' + json.dumps(str(duo_env)) + '\n')
    proposed = compose_config(guards, base, candidate)
    validate_config(current, proposed, values, original['HostConfig']['Memory'])

    def unchanged(app_id):
        if (guards.running_snapshot(app_id) != before_other or not listeners.issubset(set(guards.listener_snapshot())) or
                file_snapshot(protected) != before_files or
                guards.command(['systemctl', 'show', 'nginx.service', '--property=MainPID', '--value']).strip() != nginx_pid):
            raise RuntimeError('Trạng thái project/cấu hình khác đã đổi đồng thời; cần kiểm tra log riêng.')

    unchanged(original['Id'])
    if release.read_bytes() != release_bytes or service(guards, 'app')['Id'] != original['Id']:
        raise RuntimeError('App/release thay đổi đồng thời; chưa thay app.')
    network_identity(guards, {name: service(guards, name) for name in ('app', 'mongo', 'proxy')})
    healthy(guards, diagnostic, original['Image'])
    # All expensive checks finish with the old app online. No RAM guard/CLI is
    # inserted after stopping it: compose replaces only the app as one action.
    guards.memory_headroom(max(512, (original['HostConfig']['Memory'] + 1048575) // 1048576))
    print('Kiểm tra đạt. Chỉ thay app IELTS; giữ nguyên học liệu, bài làm, audio và worker.', flush=True)
    atomic_write(release, candidate.read_bytes())
    switch = base + ['-f', str(release), 'up', '-d', '--no-deps', '--no-build', '--wait', '--wait-timeout', '240', 'app']
    try:
        run_logged(switch, audit, 'start-app', timeout=300)
        replacement = healthy(guards, diagnostic, image_id)
        if network_identity(guards, {**rows, 'app': replacement}) != networks:
            raise RuntimeError('Mạng app mới không khớp mạng ban đầu.')
        if guards.env_values(replacement['Config']['Env']) != values:
            # Base image metadata variables may change; only application-owned
            # resolved settings are authoritative, and must remain identical.
            new_values = guards.env_values(replacement['Config']['Env'])
            if any(new_values.get(key) != value for key, value in config_environment(current).items()):
                raise RuntimeError('Cấu hình app mới khác cấu hình cũ.')
        unchanged(replacement['Id'])
    except BaseException:
        # This path performs no data migration. Restore the actual immutable old
        # image through its original override, never a guessed release tag.
        try:
            if release.read_bytes() != candidate.read_bytes() or file_snapshot(protected) != before_files:
                raise RuntimeError('Cấu hình thay đổi đồng thời; không ghi đè để rollback.')
            if guards.command(['docker', 'image', 'inspect', '--format', '{{.Id}}', old_image_ref]).strip() != original['Image']:
                raise RuntimeError('Tag image cũ thay đổi; không rollback sang image khác.')
            atomic_write(release, release_bytes)
            run_logged(switch, audit, 'restore-app', timeout=300)
            restored = healthy(guards, diagnostic, original['Image'])
            unchanged(restored['Id'])
        except BaseException:
            raise RuntimeError('Cập nhật chưa đạt và chưa xác nhận phục hồi app cũ. Giữ log riêng: ' + str(audit)) from None
        raise RuntimeError('Cập nhật chưa đạt; đã phục hồi app cũ healthy. Log riêng: ' + str(audit)) from None
    (audit / 'complete.json').write_text(json.dumps({'status': 'verified', 'commit': commit, 'image': image_id,
                                                   'bankUnchanged': True, 'onlyAppReplaced': True}) + '\n')
    print('HOÀN TẤT: ' + ORIGIN + ' — app mới healthy; không chạy migration/reset hoặc tạo lại audio.', flush=True)


def main():
    if (os.geteuid() != 0 or len(sys.argv) != 3 or not re.fullmatch(r'[a-f0-9]{40}', sys.argv[1]) or
            not re.fullmatch(r'[a-f0-9]{64}', sys.argv[2])):
        raise RuntimeError('Chạy bằng root với commit đầy đủ và SHA256 archive.')
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='ielts-app-update-', dir='/tmp') as folder:
        folder = pathlib.Path(folder)
        modules = []
        for name, digest in (('set-duo-band-3.py', GUARDS_SHA), ('diagnose-listening.py', DIAGNOSTIC_SHA)):
            path = folder / name
            download('https://raw.githubusercontent.com/thaituegia/websiteIeltsAi/' + sys.argv[1] + '/deploy/' + name,
                     digest, path, 1024 * 1024)
            modules.append(checked_module(path, 'ielts_app_update_' + name.replace('-', '_').replace('.', '_')))
        deploy(*modules, *sys.argv[1:])


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        # Docker output, exceptions with commands, credentials and provider
        # configuration remain in private files, never terminal output.
        print(str(error) if isinstance(error, RuntimeError) else 'Cập nhật app chưa hoàn tất; kiểm tra log riêng.', file=sys.stderr)
        sys.exit(1)

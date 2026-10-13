#!/usr/bin/env python3
"""Assign this installation's two learners to band 3 without rebuilding the app."""
import datetime
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import time
import urllib.request

LIVE_DIR = pathlib.Path('/opt/websiteIeltsAi-20261007T172235Z-7D7gnc')
ORIGIN = 'https://sutonghanyu.vn'


def command(args, timeout=60):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Một lệnh kiểm tra hoặc thao tác IELTS không thành công; xem log riêng.')
    return result.stdout


def private_file(path):
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o077:
        raise RuntimeError('Tệp cấu hình riêng không an toàn.')


def read_project(path):
    private_file(path)
    matches = [line.split('=', 1)[1] for line in path.read_text().splitlines()
               if line.startswith('IELTS_COMPOSE_PROJECT=')]
    if len(matches) != 1 or not re.fullmatch(r'website-ielts-ai-[a-z0-9][a-z0-9_-]{0,47}', matches[0]):
        raise RuntimeError('Không xác định được đúng Compose project IELTS.')
    return matches[0]


def verify_container(row, project, service):
    labels = row['Config'].get('Labels') or {}
    if (labels.get('com.docker.compose.project') != project or
            labels.get('com.docker.compose.service') != service or
            labels.get('com.docker.compose.project.working_dir') != str(LIVE_DIR / 'deploy') or
            not row['State']['Running']):
        raise RuntimeError('Container không thuộc đúng ứng dụng IELTS đang chạy.')
    if service == 'app' and row['NetworkSettings']['Ports'].get('3001/tcp') != [
            {'HostIp': '127.0.0.1', 'HostPort': '19088'}]:
        raise RuntimeError('Cổng app không khớp bản cài IELTS.')


def env_values(entries):
    values = {}
    for entry in entries:
        key, separator, value = entry.partition('=')
        if not separator or key in values:
            raise RuntimeError('Cấu hình container bị lặp hoặc không hợp lệ.')
        values[key] = value
    if (values.get('MONGODB_URI') != 'mongodb://mongo:27017/ielts_ai' or
            values.get('APP_ORIGIN') != ORIGIN or values.get('DUO_ENABLED') != 'true' or
            values.get('DUO_CREDENTIALS_FILE') or not values.get('DUO_ACCOUNTS_JSON')):
        raise RuntimeError('Cấu hình MongoDB/Duo không khớp bản cài này.')
    return values


def memory_headroom(job_mib):
    values = re.findall(r'^MemAvailable:\s+(\d+)\s+kB$', pathlib.Path('/proc/meminfo').read_text(), re.M)
    if len(values) != 1 or int(values[0]) < (job_mib + 1024) * 1024:
        raise RuntimeError('RAM khả dụng chưa đủ cho thao tác và 1 GiB dự phòng; không tác động project khác.')


def inspect(identifier):
    rows = json.loads(command(['docker', 'inspect', identifier]))
    if len(rows) != 1:
        raise RuntimeError('Container không duy nhất.')
    return rows[0]


def running_snapshot(exclude):
    identifiers = command(['docker', 'ps', '-q', '--no-trunc']).split()
    rows = json.loads(command(['docker', 'inspect'] + identifiers)) if identifiers else []
    return {row['Id']: {'Image': row['Image'], 'RestartCount': row['RestartCount'],
                       'State': {key: row['State'][key] for key in ('Status', 'Running', 'StartedAt', 'Pid')},
                       'NetworkSettings': row['NetworkSettings']}
            for row in rows if row['Id'] != exclude}


def listener_snapshot():
    return sorted(tuple(line.split()[3:5]) for line in command(['ss', '-ltnH']).splitlines())


def say(message):
    print(message, flush=True)


def main():
    if len(sys.argv) != 3 or not re.fullmatch(r'[a-f0-9]{40}', sys.argv[1]) or not re.fullmatch(r'[a-f0-9]{64}', sys.argv[2]):
        raise RuntimeError('Cần commit và SHA256 đầy đủ của helper đã kiểm tra.')
    if os.geteuid() != 0 or LIVE_DIR.resolve(strict=True) != LIVE_DIR:
        raise RuntimeError('Chạy bằng root tại đúng VPS IELTS.')
    os.umask(0o077)
    private = LIVE_DIR / '.local/deploy'
    if private.resolve(strict=True) != private or private.stat().st_uid != 0 or private.stat().st_mode & 0o077:
        raise RuntimeError('Thư mục triển khai riêng bị chuyển hướng hoặc không an toàn.')
    project = read_project(private / 'deploy.env')
    rows = {}
    for service in ('app', 'mongo', 'proxy'):
        identifiers = command(['docker', 'ps', '-q', '--no-trunc', '--filter', f'label=com.docker.compose.project={project}',
                               '--filter', f'label=com.docker.compose.service={service}']).split()
        if len(identifiers) != 1:
            raise RuntimeError('Cần đúng một container cho từng service của IELTS.')
        rows[service] = inspect(identifiers[0])
        verify_container(rows[service], project, service)
    app = rows['app']
    values = env_values(app['Config']['Env'])
    networks = set(app['NetworkSettings']['Networks']) & set(rows['mongo']['NetworkSettings']['Networks'])
    if networks != {f'{project}_database'}:
        raise RuntimeError('Không xác định được mạng MongoDB riêng của IELTS.')
    network = next(iter(networks))
    if not json.loads(command(['docker', 'network', 'inspect', network]))[0]['Internal']:
        raise RuntimeError('Mạng dữ liệu không phải mạng nội bộ.')
    image = app['Image']
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        raise RuntimeError('Image app không có digest bất biến.')
    if not isinstance(app['HostConfig']['Memory'], int) or app['HostConfig']['Memory'] <= 0:
        raise RuntimeError('App hiện tại không có giới hạn RAM.')
    app_budget = max(256, (app['HostConfig']['Memory'] + 1048575) // 1048576)
    memory_headroom(256)
    command(['nginx', '-t'])
    nginx_master = command(['systemctl', 'show', 'nginx.service', '--property=MainPID', '--value']).strip()
    if not re.fullmatch(r'[1-9][0-9]*', nginx_master):
        raise RuntimeError('Gateway Nginx chưa hoạt động.')
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    audit_parent = private / 'band-3'
    if audit_parent.exists():
        if audit_parent.resolve() != audit_parent or audit_parent.stat().st_uid != 0 or audit_parent.stat().st_mode & 0o077:
            raise RuntimeError('Thư mục audit không an toàn.')
    else:
        audit_parent.mkdir(mode=0o700)
    audit = audit_parent / f'{timestamp}-{os.urandom(4).hex()}'
    audit.mkdir(mode=0o700)
    say('Đang kiểm tra hai tài khoản và lộ trình; chưa thay đổi dữ liệu.')
    say(f'Log riêng: {audit}')
    helper = audit / 'set-duo-band-3.mjs'
    url = f'https://raw.githubusercontent.com/thaituegia/websiteIeltsAi/{sys.argv[1]}/deploy/set-duo-band-3.mjs'
    with urllib.request.urlopen(url, timeout=60) as response:
        if response.status != 200 or not response.url.startswith('https://raw.githubusercontent.com/'):
            raise RuntimeError('Nguồn helper không đúng HTTPS GitHub đã ghim.')
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024 or hashlib.sha256(data).hexdigest() != sys.argv[2]:
        raise RuntimeError('SHA256 helper không khớp; chưa thay đổi app.')
    helper.write_bytes(data)
    credential_path = audit / 'credentials.json'
    credential_path.write_text(values['DUO_ACCOUNTS_JSON'])
    runner_env = audit / 'runner.env'
    retained = ['MONGODB_URI', 'DUO_GATE_INTERVAL', 'DUO_SESSIONS_PER_BAND', 'DUO_SESSIONS_BY_BAND',
                'DUO_PASS_PERCENT', 'DUO_STRICT_RETAKE_MODE']
    if any('\n' in values.get(key, '') or '\r' in values.get(key, '') for key in retained):
        raise RuntimeError('Cấu hình runtime không hợp lệ.')
    runner_env.write_text(''.join(f'{key}={values[key]}\n' for key in retained if key in values))
    backup = audit / 'backup'
    backup.mkdir(mode=0o700)

    def run_helper(action, label=None):
        label = label or action
        memory_headroom(256)
        args = ['docker', 'run', '--rm', '--network', network, '--memory=256m', '--memory-swap=256m',
                '--cpus=0.25', '--pids-limit=64', '--user=0:0', '--cap-drop=ALL',
                '--security-opt=no-new-privileges:true', '--read-only',
                '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m', '--env-file', str(runner_env),
                '-e', 'NODE_OPTIONS=--max-old-space-size=192', '-e', 'DUO_CREDENTIALS_FILE=/run/duo-credentials.json',
                '-e', 'IELTS_BAND_BACKUP_DIR=/backup/band', '-e', f'IELTS_APP_OFFLINE={str(not inspect(app["Id"])["State"]["Running"]).lower()}',
                '--mount', f'type=bind,src={helper},dst=/run/set-duo-band-3.mjs,readonly',
                '--mount', f'type=bind,src={credential_path},dst=/run/duo-credentials.json,readonly',
                '--mount', f'type=bind,src={backup},dst=/backup' + (',readonly' if action == 'verify' else ''),
                '--entrypoint=node', image, '--import', 'tsx', '/run/set-duo-band-3.mjs', action]
        with (audit / f'{label}.json').open('x') as output, (audit / f'{label}.log').open('x') as errors:
            result = subprocess.run(args, stdout=output, stderr=errors, timeout=600)
        if result.returncode:
            raise RuntimeError(f'Bước {action} chưa đạt. Log riêng: {audit / (label + ".log")}')
        return json.loads((audit / f'{label}.json').read_text())

    before = running_snapshot(app['Id'])
    listeners = listener_snapshot()
    preflight = run_helper('inspect')
    if preflight.get('alreadyAssigned'):
        say('Đã đúng trạng thái: cả hai band 3.0, lộ trình mở và Trang không cần test đầu vào. Không thay đổi thêm.')
        return
    memory_headroom(256)
    command(['docker', 'stop', '--time=60', app['Id']], timeout=90)
    try:
        memory_headroom(app_budget)
        say('Chỉ app IELTS tạm dừng. Đang sao lưu toàn bộ database rồi gán band 3.0; MongoDB và project khác giữ nguyên.')
        run_helper('apply')
        run_helper('verify')
    except BaseException:
        if not (backup / 'band/mutation-started.json').exists():
            memory_headroom(app_budget)
            command(['docker', 'start', app['Id']])
            say('Dừng trước khi ghi dữ liệu; app IELTS đã được khởi động lại.')
        else:
            say(f'Có thay đổi dữ liệu chưa xác minh xong; giữ backup và app tạm dừng để xử lý. Log: {audit}')
        raise
    memory_headroom(app_budget)
    command(['docker', 'start', app['Id']])
    until = time.monotonic() + 180
    while inspect(app['Id'])['State'].get('Health', {}).get('Status') != 'healthy':
        if time.monotonic() >= until or not inspect(app['Id'])['State']['Running']:
            raise RuntimeError(f'Band đã ghi; app chưa xác nhận healthy. Log: {audit}')
        time.sleep(2)
    with urllib.request.urlopen(ORIGIN + '/api/health', timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Chưa kiểm tra được HTTPS sau khi khởi động lại.')
    run_helper('verify', 'verify-live')
    if (running_snapshot(app['Id']) != before or listener_snapshot() != listeners or
            command(['systemctl', 'show', 'nginx.service', '--property=MainPID', '--value']).strip() != nginx_master):
        raise RuntimeError(f'Cần kiểm tra trạng thái project khác đã thay đổi đồng thời. Audit riêng: {audit}')
    say('HOÀN TẤT: cả hai band 3.0, mở lộ trình band 3, bỏ qua test đầu vào chưa làm của Trang. Không tạo điểm test giả.')
    say(f'Website: {ORIGIN}\nBackup/log riêng: {audit}\nTải lại trang để nhận band mới.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never print Docker stderr, runtime env, credentials or Mongo URI.
        print(str(error) if isinstance(error, RuntimeError) else 'Thao tác chưa hoàn tất; kiểm tra log riêng.', file=sys.stderr)
        sys.exit(1)

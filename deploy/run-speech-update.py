#!/usr/bin/env python3
"""Preserving website update plus a separate, bounded audio preparation worker."""
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.request

GUARDS_SHA = '179cf2d406b60fe74a0ac9e0e33676fb6f2e54d3e9b52d1858405d3b3dea2812'
UPDATE_ENTRY_SHA = 'cdfe535df91f950d83e3158527bbbd2cc58cd2a5a05e8275b11a452be068badb'
RESET_COMPAT_SHA = '7751527ca73606d49746818af9922401bae036aab23ce60d84ba1f552a3a5a2a'
UPDATER_SHA = '5400f1a934c03665e6ff5901c4c2cb36209003a60d65c778d2001c1567cda9fb'
DIAGNOSTIC_SHA = '8ba0383c4c02303e27bd92591d6b58ea5c5987d7d3a88f5f99b30d0e79d06791'


def download(commit, name, digest, folder):
    url = f'https://raw.githubusercontent.com/thaituegia/websiteIeltsAi/{commit}/deploy/{name}'
    with urllib.request.urlopen(url, timeout=60) as response:
        if response.status != 200 or not response.url.startswith('https://raw.githubusercontent.com/'):
            raise RuntimeError('Nguồn cập nhật không đúng HTTPS đã ghim.')
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024 or hashlib.sha256(data).hexdigest() != digest:
        raise RuntimeError('SHA256 nguồn không khớp; chưa chạy script đó.')
    path = folder / name
    path.write_bytes(data)
    return path


def checked_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def network_identity(row):
    networks = row['NetworkSettings']['Networks']
    if any(not re.fullmatch(r'[a-f0-9]{64}', value.get('NetworkID', '')) for value in networks.values()):
        raise RuntimeError('Không xác định được mạng container bất biến.')
    return {name: value['NetworkID'] for name, value in networks.items()}


def app_identity(app):
    return app['Id'], app['Image'], network_identity(app)


def owned_app(guards, project):
    identifiers = guards.command(['docker', 'ps', '-q', '--no-trunc', '--filter',
                                 f'label=com.docker.compose.project={project}', '--filter',
                                 'label=com.docker.compose.service=app']).split()
    if len(identifiers) != 1 or not re.fullmatch(r'[a-f0-9]{64}', identifiers[0]):
        raise RuntimeError('Không xác định được đúng app IELTS đang chạy.')
    app = guards.inspect(identifiers[0])
    guards.verify_container(app, project, 'app')
    if app['Id'] != identifiers[0] or not re.fullmatch(r'sha256:[a-f0-9]{64}', app['Image']):
        raise RuntimeError('App IELTS chưa có định danh/image bất biến.')
    expected = {f'{project}_web': False, f'{project}_database': True}
    identity = network_identity(app)
    if set(identity) != set(expected):
        raise RuntimeError('Mạng app IELTS không khớp bản cài.')
    for name, internal in expected.items():
        rows = json.loads(guards.command(['docker', 'network', 'inspect', name]))
        if (len(rows) != 1 or rows[0].get('Name') != name or rows[0].get('Id') != identity[name] or
                rows[0].get('Internal') is not internal):
            raise RuntimeError('Mạng app/dữ liệu không đúng phạm vi worker.')
    return app


def healthy_app(app, diagnostic):
    if (app['State'].get('Running') is not True or
            (app['State'].get('Health') or {}).get('Status') != 'healthy' or
            diagnostic.health().get('ok') is not True or diagnostic.health(tls=True).get('ok') is not True):
        raise RuntimeError('App IELTS chưa healthy trực tiếp và qua HTTPS hợp lệ; kiểm tra log riêng.')


def validate_worker(worker, app, guards, project, name):
    labels = worker['Config'].get('Labels') or {}
    if (not re.fullmatch(r'[a-f0-9]{64}', worker.get('Id', '')) or worker.get('Name') != '/' + name or
            labels.get('ielts.speech.project') != project or labels.get('ielts.speech.kind') != 'prewarm' or
            labels.get('ielts.speech.owner') != str(guards.LIVE_DIR) or
            not re.fullmatch(r'[a-f0-9]{40}', labels.get('ielts.speech.commit', '')) or
            worker.get('Image') != app['Image'] or network_identity(worker) != network_identity(app) or
            any((worker['NetworkSettings'].get('Ports') or {}).values()) or
            any((worker['HostConfig'].get('PortBindings') or {}).values()) or
            worker['HostConfig'].get('PublishAllPorts')):
        raise RuntimeError('Worker không khớp chủ sở hữu/image/mạng/cổng của app IELTS; không thao tác.')


def diagnostic_snapshot(diagnostic, phase, required=False):
    try:
        # No pause action: the pinned helper only inspects scoped, sanitized data.
        report = diagnostic.diagnose()
        if not isinstance(report, dict) or report.get('mode') != 'read-only':
            raise ValueError()
        print(f'Chẩn đoán Listening {phase} (chỉ đọc):', flush=True)
        print(json.dumps(report, ensure_ascii=True, sort_keys=True), flush=True)
    except Exception:
        if required:
            raise RuntimeError('Chẩn đoán Listening trước cập nhật chưa hoàn tất; chưa thay đổi worker/app.') from None
        print('Chẩn đoán Listening sau thao tác chưa hoàn tất; kiểm tra hiện trạng riêng, không in log thô.', file=sys.stderr)


def resume_previous_worker(guards, diagnostic, project, name, original_app, previous, stop_attempted):
    if not stop_attempted:
        return 'Worker cũ được giữ nguyên trạng thái trước thao tác.'
    attempted = False
    try:
        current = owned_app(guards, project)
        if app_identity(current) != app_identity(original_app):
            raise ValueError()
        healthy_app(current, diagnostic)
        worker = guards.inspect(previous['Id'])
        validate_worker(worker, current, guards, project, name)
        if worker['Id'] != previous['Id']:
            raise ValueError()
        if worker['State'].get('Running') or worker['State'].get('Restarting'):
            return 'Chưa xác nhận worker cũ đã dừng; không gửi lệnh khởi động lại.'
        guards.memory_headroom(384)
        latest_app = owned_app(guards, project)
        if (app_identity(latest_app) != app_identity(original_app) or
                (latest_app['State'].get('Health') or {}).get('Status') != 'healthy'):
            raise ValueError()
        validate_worker(worker, latest_app, guards, project, name)
        attempted = True
        guards.command(['docker', 'start', previous['Id']])
        worker = guards.inspect(previous['Id'])
        validate_worker(worker, current, guards, project, name)
        if worker['State'].get('Running') is not True:
            raise ValueError()
        latest_app = owned_app(guards, project)
        if app_identity(latest_app) != app_identity(original_app):
            raise ValueError()
        healthy_app(latest_app, diagnostic)
        return 'Đã khởi động lại đúng worker cũ với app cũ còn healthy.'
    except Exception:
        if attempted:
            return 'Chưa xác nhận khởi động lại worker cũ an toàn; kiểm tra hiện trạng và log riêng.'
        return 'Worker cũ không được tự khởi động lại: chưa xác nhận app/worker cũ bất biến và healthy; kiểm tra log riêng.'


def main():
    if os.geteuid() != 0 or len(sys.argv) != 3 or not re.fullmatch(r'[a-f0-9]{40}', sys.argv[1]) or not re.fullmatch(r'[a-f0-9]{64}', sys.argv[2]):
        raise RuntimeError('Chạy bằng root với commit và SHA256 archive đầy đủ.')
    commit, archive_sha = sys.argv[1:]
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='ielts-speech-update-', dir='/tmp') as scratch:
        scratch = pathlib.Path(scratch)
        # Import checked read-only deployment guards; its rank-assignment main is never run.
        guards_path = download(commit, 'set-duo-band-3.py', GUARDS_SHA, scratch)
        guards = checked_module(guards_path, 'ielts_deployment_guards')
        diagnostic_path = download(commit, 'diagnose-listening.py', DIAGNOSTIC_SHA, scratch)
        diagnostic = checked_module(diagnostic_path, 'ielts_listening_diagnostic')
        if diagnostic.LIVE_DIR != guards.LIVE_DIR:
            raise RuntimeError('Chẩn đoán và updater không thuộc cùng bản cài IELTS.')
        # Complete checked downloads before changing the old worker's state.
        entry = download(commit, 'run-exam-update.sh', UPDATE_ENTRY_SHA, scratch)
        project = guards.read_project(guards.LIVE_DIR / '.local/deploy/deploy.env')
        worker_name = 'ielts-speech-prewarm-' + hashlib.sha256(project.encode()).hexdigest()[:16]
        try:
            diagnostic_snapshot(diagnostic, 'trước cập nhật', required=True)
            update_and_worker(guards, diagnostic, project, worker_name, commit, archive_sha, entry)
        finally:
            diagnostic_snapshot(diagnostic, 'sau thao tác')


def update_and_worker(guards, diagnostic, project, worker_name, commit, archive_sha, entry):
    original_app = owned_app(guards, project)
    healthy_app(original_app, diagnostic)
    identifiers = guards.command(['docker', 'ps', '-aq', '--no-trunc', '--filter',
                                 f'name=^/{worker_name}$']).split()
    if len(identifiers) > 1 or any(not re.fullmatch(r'[a-f0-9]{64}', value) for value in identifiers):
        raise RuntimeError('Worker audio không duy nhất hoặc chưa có định danh bất biến.')
    previous, stop_attempted = None, False
    if identifiers:
        previous = guards.inspect(identifiers[0])
        if previous['Id'] != identifiers[0]:
            raise RuntimeError('Worker audio không khớp định danh đã chọn.')
        validate_worker(previous, original_app, guards, project, worker_name)
        # Recheck ownership immediately before stopping only the immutable ID.
        current = owned_app(guards, project)
        if app_identity(current) != app_identity(original_app):
            raise RuntimeError('App thay đổi đồng thời; chưa dừng worker cũ.')
        healthy_app(current, diagnostic)
        latest = guards.inspect(previous['Id'])
        validate_worker(latest, current, guards, project, worker_name)
        if latest['State'].get('Running') or latest['State'].get('Restarting'):
            # A timeout can occur after Docker already stopped the worker. Mark
            # the attempt before the command; recovery checks its actual state.
            stop_attempted = True
            try:
                guards.command(['docker', 'stop', '--time=30', previous['Id']], timeout=45)
                latest = guards.inspect(previous['Id'])
                validate_worker(latest, current, guards, project, worker_name)
                if latest['State'].get('Running') or latest['State'].get('Restarting'):
                    raise ValueError()
            except Exception:
                recovery = resume_previous_worker(guards, diagnostic, project, worker_name, original_app, previous, stop_attempted)
                raise RuntimeError('Chưa hoàn tất dừng/kiểm tra worker cũ; chưa chạy updater. ' + recovery) from None
    # Existing updater performs bounded build, ALL-data backup and preserving migration.
    # The reset hash is only its legacy positional compatibility argument, never executed.
    try:
        result = subprocess.run(['bash', str(entry), str(guards.LIVE_DIR), commit, archive_sha, RESET_COMPAT_SHA, UPDATER_SHA])
        if result.returncode:
            raise ValueError()
    except Exception:
        recovery = resume_previous_worker(guards, diagnostic, project, worker_name, original_app, previous, stop_attempted)
        raise RuntimeError('Cập nhật app chưa hoàn tất; chưa chạy worker mới. Giữ log/backup của updater. ' + recovery) from None
    app = owned_app(guards, project)
    healthy_app(app, diagnostic)
    values = guards.env_values(app['Config']['Env'])
    web, database = f'{project}_web', f'{project}_database'
    image = app['Image']
    guards.memory_headroom(384)
    runtime = guards.LIVE_DIR / '.local/deploy/speech-prewarm'
    if runtime.exists():
        if runtime.resolve() != runtime or runtime.stat().st_uid != 0 or runtime.stat().st_mode & 0o077:
            raise RuntimeError('Thư mục worker riêng không an toàn.')
    else:
        runtime.mkdir(mode=0o700)
    if previous:
        latest = guards.inspect(previous['Id'])
        validate_worker(latest, original_app, guards, project, worker_name)
        if latest['State'].get('Running') or latest['State'].get('Restarting'):
            raise RuntimeError('Worker cũ thay đổi đồng thời; chưa thay thế container.')
        guards.command(['docker', 'rm', previous['Id']])
    credentials = runtime / ('credentials-' + commit[:12] + '.json')
    environment = runtime / ('worker-' + commit[:12] + '.env')
    # Checked JSON/keys are private; no credential values enter command arguments/logs.
    retained = ['MONGODB_URI', 'IELTS_OPENAI_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY',
                'ELEVENLABS_VOICE_BRITISH', 'ELEVENLABS_VOICE_AMERICAN', 'ELEVENLABS_VOICE_AUSTRALIAN', 'ELEVENLABS_MODEL']
    if any('\n' in values.get(key, '') or '\r' in values.get(key, '') for key in retained):
        raise RuntimeError('Giá trị cấu hình worker không hợp lệ.')
    content = ''.join(f'{key}={values[key]}\n' for key in retained if key in values)
    content += 'APP_ORIGIN=https://sutonghanyu.vn\nNODE_ENV=production\nDUO_CREDENTIALS_FILE=/run/duo-credentials.json\n'
    for path, text in ((credentials, values['DUO_ACCOUNTS_JSON']), (environment, content)):
        if path.exists():
            guards.private_file(path)
            if path.read_text() != text:
                raise RuntimeError('Cấu hình worker đã có khác giá trị; giữ nguyên để kiểm tra.')
        else:
            with path.open('x') as output:
                output.write(text)
    other_before = guards.running_snapshot(app['Id'])
    listeners = guards.listener_snapshot()
    create = ['docker', 'create', '--name', worker_name, '--restart=unless-stopped', '--init', '--no-healthcheck',
              '--network', web, '--memory=384m', '--memory-swap=384m', '--cpus=0.25', '--pids-limit=64',
              '--user=0:0', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--read-only',
              '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m', '--env-file', str(environment),
              '--mount', f'type=bind,src={credentials},dst=/run/duo-credentials.json,readonly',
              '--label', f'ielts.speech.project={project}', '--label', 'ielts.speech.kind=prewarm',
              '--label', f'ielts.speech.owner={guards.LIVE_DIR}', '--label', f'ielts.speech.commit={commit}',
              '--log-opt=max-size=5m', '--log-opt=max-file=2', '--stop-timeout=30', '--entrypoint=node', image,
              '--import', 'tsx', '/app/server/speech-prewarm-cli.ts', '--watch', '--max-clips', '32',
              '--max-retries', '3', '--interval-seconds', '60']
    worker_id = guards.command(create).strip()
    if not re.fullmatch(r'[a-f0-9]{64}', worker_id):
        raise RuntimeError('Worker mới chưa có định danh bất biến; kiểm tra log riêng.')
    guards.command(['docker', 'network', 'connect', database, worker_id])
    guards.command(['docker', 'start', worker_id])
    worker = guards.inspect(worker_id)
    validate_worker(worker, app, guards, project, worker_name)
    if (not worker['State']['Running'] or worker['HostConfig']['Memory'] != 384 * 1048576 or
            worker['HostConfig']['MemorySwap'] != 384 * 1048576 or
            set(worker['NetworkSettings']['Networks']) != {web, database} or
            any(worker['NetworkSettings']['Ports'].values())):
        raise RuntimeError('Worker chưa xác nhận đúng giới hạn/mạng; kiểm tra log riêng.')
    current = owned_app(guards, project)
    if app_identity(current) != app_identity(app):
        raise RuntimeError('App thay đổi sau khi chạy worker; kiểm tra hiện trạng riêng.')
    healthy_app(current, diagnostic)
    after = guards.running_snapshot(app['Id'])
    after.pop(worker['Id'], None)
    if other_before != after or listeners != guards.listener_snapshot():
        raise RuntimeError('Có service khác thay đổi đồng thời; kiểm tra hiện trạng trước khi kết luận.')
    print('ĐÃ CẬP NHẬT APP VÀ KHỞI ĐỘNG TẠO AUDIO TRƯỚC.', flush=True)
    print('Các đoạn band thấp được chuẩn bị trước. Bài chỉ bắt đầu khi đủ audio; không tạo voice khi bấm nghe.', flush=True)
    print('Không reset tài khoản/band/tiến độ. Audio đã hoàn tất được dùng lại khi tiếp tục sau lỗi.', flush=True)
    print(f'Xem tiến độ: docker logs --tail 20 {worker_name}', flush=True)
    print('Website: https://sutonghanyu.vn', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Cập nhật/worker chưa hoàn tất; xem log riêng, không in thông tin tài khoản.', file=sys.stderr)
        sys.exit(1)

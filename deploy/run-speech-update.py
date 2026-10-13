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


def main():
    if os.geteuid() != 0 or len(sys.argv) != 3 or not re.fullmatch(r'[a-f0-9]{40}', sys.argv[1]) or not re.fullmatch(r'[a-f0-9]{64}', sys.argv[2]):
        raise RuntimeError('Chạy bằng root với commit và SHA256 archive đầy đủ.')
    commit, archive_sha = sys.argv[1:]
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='ielts-speech-update-', dir='/tmp') as scratch:
        scratch = pathlib.Path(scratch)
        # Import checked read-only deployment guards; its rank-assignment main is never run.
        guards_path = download(commit, 'set-duo-band-3.py', GUARDS_SHA, scratch)
        spec = importlib.util.spec_from_file_location('ielts_deployment_guards', guards_path)
        guards = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(guards)
        project = guards.read_project(guards.LIVE_DIR / '.local/deploy/deploy.env')
        worker_name = 'ielts-speech-prewarm-' + hashlib.sha256(project.encode()).hexdigest()[:16]
        previous = subprocess.run(['docker', 'inspect', worker_name], capture_output=True, text=True)
        if previous.returncode == 0:
            rows = json.loads(previous.stdout)
            if len(rows) != 1:
                raise RuntimeError('Worker audio không duy nhất.')
            labels = rows[0]['Config'].get('Labels') or {}
            if labels.get('ielts.speech.project') != project or labels.get('ielts.speech.kind') != 'prewarm' or labels.get('ielts.speech.owner') != str(guards.LIVE_DIR):
                raise RuntimeError('Tên worker thuộc container khác; không thao tác.')
            if rows[0]['State']['Running']:
                guards.command(['docker', 'stop', '--time=30', worker_name], timeout=45)
        entry = download(commit, 'run-exam-update.sh', UPDATE_ENTRY_SHA, scratch)
        # Existing updater performs bounded build, ALL-data backup and preserving migration.
        # The reset hash is only its legacy positional compatibility argument, never executed.
        result = subprocess.run(['bash', str(entry), str(guards.LIVE_DIR), commit, archive_sha, RESET_COMPAT_SHA, UPDATER_SHA])
        if result.returncode:
            raise RuntimeError('Cập nhật app chưa hoàn tất; chưa chạy worker mới. Giữ log/backup của updater.')
        identifiers = guards.command(['docker', 'ps', '-q', '--no-trunc', '--filter', f'label=com.docker.compose.project={project}',
                                      '--filter', 'label=com.docker.compose.service=app']).split()
        if len(identifiers) != 1:
            raise RuntimeError('Không xác định được đúng app IELTS sau cập nhật.')
        app = guards.inspect(identifiers[0])
        guards.verify_container(app, project, 'app')
        values = guards.env_values(app['Config']['Env'])
        web, database = f'{project}_web', f'{project}_database'
        if set(app['NetworkSettings']['Networks']) != {web, database}:
            raise RuntimeError('Mạng app IELTS không khớp bản cài.')
        for name, internal in ((web, False), (database, True)):
            if json.loads(guards.command(['docker', 'network', 'inspect', name]))[0]['Internal'] != internal:
                raise RuntimeError('Mạng app/dữ liệu không đúng phạm vi worker.')
        image = app['Image']
        if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
            raise RuntimeError('Image mới chưa có digest bất biến.')
        guards.memory_headroom(384)
        runtime = guards.LIVE_DIR / '.local/deploy/speech-prewarm'
        if runtime.exists():
            if runtime.resolve() != runtime or runtime.stat().st_uid != 0 or runtime.stat().st_mode & 0o077:
                raise RuntimeError('Thư mục worker riêng không an toàn.')
        else:
            runtime.mkdir(mode=0o700)
        if previous.returncode == 0:
            guards.command(['docker', 'rm', worker_name])
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
        guards.command(create)
        guards.command(['docker', 'network', 'connect', database, worker_name])
        guards.command(['docker', 'start', worker_name])
        worker = guards.inspect(worker_name)
        if (not worker['State']['Running'] or worker['HostConfig']['Memory'] != 384 * 1048576 or
                worker['HostConfig']['MemorySwap'] != 384 * 1048576 or
                set(worker['NetworkSettings']['Networks']) != {web, database} or
                any(worker['NetworkSettings']['Ports'].values())):
            raise RuntimeError('Worker chưa xác nhận đúng giới hạn/mạng; kiểm tra log riêng.')
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

#!/usr/bin/env python3
"""Scoped Listening diagnostics; only --pause-worker permits a mutation.

Does not read app/worker credentials, query learner collections, invoke speech
providers, import deployment helpers, or change app/Mongo/Nginx/proxy services.
"""
import argparse
import hashlib
import http.client
import json
import os
import pathlib
import re
import socket
import ssl
import stat
import subprocess
import sys
import time

LIVE_DIR = pathlib.Path('/opt/websiteIeltsAi-20261007T172235Z-7D7gnc')
DOMAIN = 'sutonghanyu.vn'
MAX_OUTPUT = 1024 * 1024
INSPECT_FORMAT = ('{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},'
                  '"Labels":{{json .Config.Labels}},"State":{{json .State}},'
                  '"RestartCount":{{json .RestartCount}},"Memory":{{json .HostConfig.Memory}},'
                  '"MemorySwap":{{json .HostConfig.MemorySwap}},"NanoCpus":{{json .HostConfig.NanoCpus}},'
                  '"CpuQuota":{{json .HostConfig.CpuQuota}},"CpuPeriod":{{json .HostConfig.CpuPeriod}},'
                  '"Networks":{{json .NetworkSettings.Networks}},"Ports":{{json .NetworkSettings.Ports}},'
                  '"ConfiguredPorts":{{json .HostConfig.PortBindings}}}')


class Refusal(RuntimeError):
    pass


def command(args, optional=False, include_stderr=False, timeout=20):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Refusal('Diagnostic command unavailable or timed out; no raw output printed.') from None
    if len(result.stdout) > MAX_OUTPUT or len(result.stderr) > MAX_OUTPUT:
        if optional:
            return None
        raise Refusal('Diagnostic command output exceeded its bound.')
    if result.returncode:
        if optional:
            return None
        raise Refusal('Diagnostic command failed; no raw output printed.')
    return result.stdout + ('\n' + result.stderr if include_stderr else '')


def owned(path, directory=False, private=False):
    try:
        metadata = path.lstat()
        if path.resolve(strict=True) != path or metadata.st_uid != 0:
            raise Refusal('Deployment path is redirected or not root owned.')
        if not (stat.S_ISDIR(metadata.st_mode) if directory else stat.S_ISREG(metadata.st_mode)):
            raise Refusal('Deployment path has an unexpected type.')
        if private and metadata.st_mode & 0o077:
            raise Refusal('Private deployment path permits group/other access.')
        return metadata
    except OSError:
        raise Refusal('Required deployment path is unavailable.') from None


def read_project():
    owned(LIVE_DIR, directory=True)
    private = LIVE_DIR / '.local/deploy'
    owned(private, directory=True, private=True)
    path = private / 'deploy.env'
    metadata = owned(path, private=True)
    if metadata.st_size > 65536:
        raise Refusal('Deployment selector file exceeds its bound.')
    # Only the selector is retained; other setting names/values are not output.
    matches = [line.partition('=')[2].rstrip('\r\n') for line in path.read_text().splitlines()
               if line.startswith('IELTS_COMPOSE_PROJECT=')]
    if len(matches) != 1 or not re.fullmatch(r'website-ielts-ai-[a-z0-9][a-z0-9_-]{0,47}', matches[0]):
        raise Refusal('Exact IELTS project selector is missing, duplicated or invalid.')
    return matches[0]


def inspect(identifier, optional=False):
    output = command(['docker', 'inspect', '--format', INSPECT_FORMAT, identifier], optional)
    if output is None:
        return None
    try:
        row = json.loads(output)
        if not isinstance(row, dict) or not re.fullmatch(r'[a-f0-9]{64}', row.get('Id', '')):
            raise ValueError()
        return row
    except (TypeError, ValueError):
        raise Refusal('Container diagnostic metadata is invalid.') from None


def containers(project):
    rows = {}
    for service in ('app', 'mongo', 'proxy'):
        ids = command(['docker', 'ps', '-aq', '--no-trunc', '--filter',
                       'label=com.docker.compose.project=' + project, '--filter',
                       'label=com.docker.compose.service=' + service]).split()
        if len(ids) != 1 or not re.fullmatch(r'[a-f0-9]{64}', ids[0]):
            raise Refusal('Expected exactly one owned container per IELTS service.')
        row = inspect(ids[0])
        labels = row.get('Labels') or {}
        if (labels.get('com.docker.compose.project') != project or
                labels.get('com.docker.compose.service') != service or
                labels.get('com.docker.compose.project.working_dir') != str(LIVE_DIR / 'deploy')):
            raise Refusal('Service ownership does not match this exact installation.')
        if service == 'app':
            expected = [{'HostIp': '127.0.0.1', 'HostPort': '19088'}]
            # Docker clears runtime bindings after an exit/OOM; the configured
            # binding still proves ownership and permits diagnosing that exit.
            configured = (row.get('ConfiguredPorts') or {}).get('3001/tcp')
            runtime = (row.get('Ports') or {}).get('3001/tcp')
            running = (row.get('State') or {}).get('Running') is True
            if configured != expected or (running and runtime != expected):
                raise Refusal('App loopback binding does not match this exact installation.')
        rows[service] = row
    name = 'ielts-speech-prewarm-' + hashlib.sha256(project.encode()).hexdigest()[:16]
    worker = inspect(name, optional=True)
    if worker:
        validate_worker(worker, rows['app'], project, name)
        rows['worker'] = worker
    return rows


def validate_worker(worker, app, project, name):
    labels = worker.get('Labels') or {}
    if (worker.get('Name') != '/' + name or
            labels.get('ielts.speech.project') != project or
            labels.get('ielts.speech.kind') != 'prewarm' or
            labels.get('ielts.speech.owner') != str(LIVE_DIR) or
            not re.fullmatch(r'[a-f0-9]{40}', labels.get('ielts.speech.commit', '')) or
            worker.get('Image') != app.get('Image') or
            set(worker.get('Networks', {})) != {project + '_web', project + '_database'} or
            any((worker.get('Ports') or {}).values()) or
            any((worker.get('ConfiguredPorts') or {}).values())):
        raise Refusal('Worker ownership/image/network/ports do not match; nothing stopped.')


def safe_state(row):
    state = row.get('State') or {}
    status = state.get('Status')
    if status not in ('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'):
        status = 'unknown'
    result = {'status': status, 'running': state.get('Running') is True,
              'oomKilled': state.get('OOMKilled') is True}
    for source, target in [('RestartCount', 'restarts'), ('Memory', 'memoryLimitBytes'),
                           ('MemorySwap', 'memoryPlusSwapLimitBytes'), ('NanoCpus', 'nanoCpus'),
                           ('CpuQuota', 'cpuQuota'), ('CpuPeriod', 'cpuPeriod')]:
        if type(row.get(source)) is int:
            result[target] = row[source]
    if type(state.get('ExitCode')) is int:
        result['exitCode'] = state['ExitCode']
    for key in ('StartedAt', 'FinishedAt'):
        value = state.get(key)
        if isinstance(value, str) and re.fullmatch(r'[0-9TZ:.+-]{1,40}', value):
            result[key] = value
    health = (state.get('Health') or {}).get('Status')
    if health in ('starting', 'healthy', 'unhealthy'):
        result['health'] = health
    return result


def usage(rows):
    output = command(['docker', 'stats', '--no-stream', '--format',
                      '{{json .}}'] + [row['Id'] for row in rows.values()], optional=True)
    if output is None:
        return {'available': False}
    result = {}
    by_id = {row['Id']: kind for kind, row in rows.items()}
    try:
        for line in output.splitlines():
            item = json.loads(line)
            identifier = item.get('ID', '')
            matches = [kind for key, kind in by_id.items() if key == identifier or
                       re.fullmatch(r'[a-f0-9]{12,64}', identifier) and key.startswith(identifier)]
            if len(matches) != 1:
                raise ValueError()
            values = {}
            for key in ('CPUPerc', 'MemUsage', 'MemPerc', 'PIDs'):
                value = item.get(key, '')
                if isinstance(value, str) and re.fullmatch(r'[0-9.% /A-Za-z]{1,64}', value):
                    values[key] = value
            result[matches[0]] = values
    except (TypeError, ValueError):
        return {'available': False}
    return result


class LocalTLS(http.client.HTTPSConnection):
    def connect(self):
        plain = socket.create_connection(('127.0.0.1', 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(plain, server_hostname=DOMAIN)
        except BaseException:
            plain.close()
            raise


def health(tls=False):
    started = time.monotonic()
    connection = LocalTLS(DOMAIN, timeout=5, context=ssl.create_default_context()) if tls else http.client.HTTPConnection('127.0.0.1', 19088, timeout=5)
    try:
        connection.request('GET', '/api/health', headers={'Host': DOMAIN, 'Connection': 'close'})
        response = connection.getresponse()
        body = response.read(16385)
        result = {'httpStatus': response.status}
        if len(body) <= 16384:
            try:
                data = json.loads(body)
                result['ok'] = response.status == 200 and data.get('status') == 'ok' and data.get('database') == 'mongodb'
            except (TypeError, ValueError, AttributeError):
                result['ok'] = False
        else:
            result['ok'] = False
    except ssl.SSLCertVerificationError:
        result = {'ok': False, 'failure': 'tls-verification'}
    except (OSError, http.client.HTTPException):
        result = {'ok': False, 'failure': 'connection-or-timeout'}
    finally:
        connection.close()
    result['elapsedMs'] = round((time.monotonic() - started) * 1000)
    return result


def classifications(text, gateway=False):
    patterns = ({'connection-refused': r'connect\(\) failed.*Connection refused',
                 'upstream-closed': r'upstream prematurely closed|recv\(\) failed.*upstream',
                 'upstream-timeout': r'upstream timed out',
                 'upstream-unreachable': r'no live upstreams|host not found in upstream'} if gateway else
                {'type-error': r'\bTypeError\b', 'range-error': r'\bRangeError\b',
                 'mongo-timeout': r'Mongo(?:OperationTimeout|NetworkTimeout|ServerSelection)Error|API failure: (?:Timed out|Server reported a timeout)',
                 'mongo-error': r'\bMongo\w*Error\b',
                 'out-of-memory': r'heap out of memory|allocation failed|\bOOM\b',
                 'api-failure': r'API failure:',
                 'worker-configuration': r'Speech pregeneration configuration is invalid',
                 'worker-incomplete': r'Speech pregeneration did not complete'})
    return {name: len(re.findall(pattern, text, re.I)) for name, pattern in patterns.items()}


def gateway_requests(text):
    # Report only route classes; URLs can include private attempt identifiers.
    groups = {'content-list': r'^/api/content(?:\?|$)',
              'content-readiness': r'^/api/content/[^/?]+/listening-audio/readiness(?:\?|$)',
              'attempt-audio': r'^/api/attempts/[^/?]+/listening-audio(?:\?|$)',
              'placement-readiness': r'^/api/placement/audio/readiness(?:\?|$)',
              'placement-audio': r'^/api/placement/[^/?]+/audio(?:\?|$)'}
    result = {name: 0 for name in groups}
    result['other'] = 0
    for url in re.findall(r'request: "(?:GET|POST|HEAD) (\S+) HTTP/', text):
        group = next((name for name, pattern in groups.items() if re.match(pattern, url)), 'other')
        result[group] += 1
    dates = re.findall(r'(?m)^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) ', text)
    return {'counts': result, 'lastErrorAtServerTime': dates[-1] if dates else None}


def log_summary(rows):
    result = {}
    for kind in ('app', 'worker'):
        if kind in rows:
            text = command(['docker', 'logs', '--tail', '120', '--since', '2h', rows[kind]['Id']],
                           optional=True, include_stderr=True)
            # Never emit raw text or provider/account values from either stream.
            result[kind] = classifications(text or '')
            if kind == 'worker':
                result['workerProgress'] = worker_progress(text or '')
    return result


def worker_progress(text):
    last = None
    for line in text.splitlines():
        try:
            row = json.loads(line)
            if not isinstance(row, dict) or row.get('state') not in ('pending', 'running', 'complete', 'paused', 'unconfigured'):
                continue
            if any(type(row.get(key)) is not int or not 0 <= row[key] <= 1_000_000 for key in ('total', 'ready', 'pending', 'failed')):
                continue
            last = {key: row[key] for key in ('state', 'total', 'ready', 'pending', 'failed')}
            if type(row.get('configured')) is bool:
                last['configured'] = row['configured']
            if row.get('lastErrorCode') in ('auth', 'quota', 'rate-limit', 'unavailable', 'invalid', 'storage', 'interrupted'):
                last['lastErrorCode'] = row['lastErrorCode']
        except (TypeError, ValueError):
            continue
    return last


def file_metadata():
    private = LIVE_DIR / '.local/deploy'
    result = {}
    for name in ('deploy.env', 'app.env', 'domain.compose.yaml', 'release.compose.yaml'):
        path = private / name
        try:
            metadata = owned(path, private=True)
            result[name] = {'bytes': metadata.st_size, 'mode': oct(stat.S_IMODE(metadata.st_mode)), 'uid': metadata.st_uid}
        except (Refusal, OSError):
            result[name] = {'ownedPrivateRegularFile': False}
    domain_dir = private / ('domain-' + hashlib.sha256(DOMAIN.encode()).hexdigest()[:12])
    try:
        owned(domain_dir, directory=True, private=True)
        path = domain_dir / 'https.error.log'
        owned(path)
        with path.open('rb') as source:
            source.seek(max(0, path.stat().st_size - 65536))
            text = source.read(65536).decode('utf8', errors='replace')
        result['gatewayErrorsLast64KiB'] = classifications(text, gateway=True)
        result['gatewayRequestsLast64KiB'] = gateway_requests(text)
    except (Refusal, OSError):
        result['gatewayErrorsLast64KiB'] = {'available': False}
    return result


def host_resources():
    result = {}
    try:
        text = pathlib.Path('/proc/meminfo').read_text()
        for key in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'):
            match = re.search(r'^' + key + r':\s+(\d+)\s+kB$', text, re.M)
            if match:
                result[key + 'KiB'] = int(match[1])
        result['cpuCount'] = os.cpu_count()
        result['loadAverage'] = list(os.getloadavg())
    except OSError:
        result['available'] = False
    return result


def diagnose(pause_worker=False):
    project = read_project()
    rows = containers(project)
    report = {'mode': 'pause-worker' if pause_worker else 'read-only',
              'containers': {kind: safe_state(row) for kind, row in rows.items()},
              'usage': usage(rows), 'host': host_resources(), 'files': file_metadata(),
              'logs': log_summary(rows),
              'health': {'directApp': health(), 'localDomainTLS': health(tls=True)}}
    if pause_worker:
        worker = rows.get('worker')
        if worker:
            # Revalidate immediately before stopping an immutable container ID.
            latest = inspect(worker['Id'])
            validate_worker(latest, inspect(rows['app']['Id']), project, worker['Name'][1:])
            if latest['State'].get('Running') or latest['State'].get('Restarting'):
                command(['docker', 'stop', '--time=30', worker['Id']], timeout=45)
            report['workerPause'] = {'stopped': not inspect(worker['Id'])['State'].get('Running'),
                                     'cacheAndContainerRetained': True}
            report['healthAfterPause'] = {'directApp': health(), 'localDomainTLS': health(tls=True)}
        else:
            report['workerPause'] = {'present': False, 'nothingChanged': True}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pause-worker', action='store_true', help='stop only the validated IELTS speech worker; retain cache/data/container')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise Refusal('Run on the exact IELTS host as root; no changes made.')
    print(json.dumps(diagnose(args.pause_worker), ensure_ascii=True, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Refusal as error:
        # Refusal messages above are fixed diagnostic text, never tool output.
        print('Listening diagnostics refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Raw subprocess, network, path and application exceptions can contain
        # account/provider details; keep every failure channel generic.
        print('Listening diagnostics refused or did not complete; no raw configuration/log values printed. Only an explicitly requested validated worker stop can change state.', file=sys.stderr)
        sys.exit(1)

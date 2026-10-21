#!/usr/bin/env python3
"""Read-only diagnostics for the exact IELTS installation's Writing path.

No app import/startup, database query, grading/generation request, credentials in
output, or service mutation. Model lookups test access, never billing quota.
"""
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

LIVE_DIR = pathlib.Path('/opt/websiteIeltsAi-20261007T172235Z-7D7gnc')
PROJECT = 'website-ielts-ai-20261007172235-7d7gnc'
DOMAIN = 'sutonghanyu.vn'
CODES = ('AI_PROVIDER_AUTH', 'AI_PROVIDER_QUOTA', 'AI_PROVIDER_RATE_LIMIT',
         'AI_PROVIDER_UNAVAILABLE', 'AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_NETWORK',
         'AI_MODEL_UNAVAILABLE', 'AI_RESPONSE_INVALID', 'AI_EVIDENCE_INVALID')
INSPECT = ('{"Id":{{json .Id}},"Image":{{json .Image}},"ImageRef":{{json .Config.Image}},"Labels":{{json .Config.Labels}},'
           '"State":{{json .State}},"RestartCount":{{json .RestartCount}},'
           '"ConfiguredPorts":{{json .HostConfig.PortBindings}},"Ports":{{json .NetworkSettings.Ports}}}')
PROVIDER_PROGRAM = r'''
const output = {configured:false, configuration:"unavailable", models:[], billingQuotaChecked:false, gradingCalled:false};
try {
  const {loadDuoCredentials} = await import("/app/server/duo-auth.ts");
  const {activateProviderConfig} = await import("/app/server/provider-config.ts");
  activateProviderConfig(loadDuoCredentials());
  const key = process.env.IELTS_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  output.configured = Boolean(key);
  output.configuration = key ? "available" : "missing-key";
  const models = [process.env.EXTRACTOR_MODEL?.trim() || "gpt-4o", process.env.SCORING_MODEL?.trim() || "gpt-4o"];
  if (models.some(model => !/^(?:gpt-|chatgpt-|o[1-9])[a-zA-Z0-9._:-]{1,96}$/.test(model))) {
    output.configuration = "invalid-model-name";
  } else if (key) for (const model of [...new Set(models)]) {
    const row = {model, roles:[...(models[0] === model ? ["extraction"] : []), ...(models[1] === model ? ["scoring"] : [])]};
    try {
      const response = await fetch("https://api.openai.com/v1/models/" + encodeURIComponent(model), {
        method:"GET", redirect:"error", headers:{Authorization:"Bearer " + key}, signal:AbortSignal.timeout(15000)
      });
      row.httpStatus = response.status;
      row.access = response.ok ? "available" : response.status === 401 || response.status === 403 ? "denied" : response.status === 404 ? "model-unavailable" : response.status === 429 ? "rate-or-quota" : "provider-error";
      await response.body?.cancel();
    } catch (error) { row.access = error?.name === "TimeoutError" ? "timeout" : "connection-failed"; }
    output.models.push(row);
  }
} catch {}
console.log(JSON.stringify(output));
'''


class Refusal(RuntimeError):
    pass


def command(args, timeout=20, stderr=False):
    try:
        row = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Refusal('Diagnostic command unavailable or timed out.') from None
    if row.returncode or len(row.stdout) > 1024 * 1024 or len(row.stderr) > 1024 * 1024:
        raise Refusal('Diagnostic command failed; raw output withheld.')
    return row.stdout + ('\n' + row.stderr if stderr else '')


def owned(path, directory=False):
    info = path.lstat()
    if (path.resolve(strict=True) != path or info.st_uid != 0 or
            not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))):
        raise Refusal('Deployment path ownership or file type is invalid.')
    return info


def app_container():
    owned(LIVE_DIR, directory=True)
    private = LIVE_DIR / '.local/deploy'
    if owned(private, directory=True).st_mode & 0o077:
        raise Refusal('Deployment metadata permissions are invalid.')
    config = private / 'deploy.env'
    if owned(config).st_mode & 0o077 or config.stat().st_size > 16384:
        raise Refusal('Deployment metadata permissions or size is invalid.')
    values = re.findall(r'^IELTS_COMPOSE_PROJECT=([^\r\n]+)\r?$', config.read_text(), re.M)
    if values != [PROJECT]:
        raise Refusal('Deployment project does not match this installation.')
    ids = command(['docker', 'ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + PROJECT,
                   '--filter', 'label=com.docker.compose.service=app']).split()
    if len(ids) != 1 or not re.fullmatch(r'[a-f0-9]{64}', ids[0]):
        raise Refusal('Expected exactly one owned IELTS app container.')
    row = json.loads(command(['docker', 'inspect', '--format', INSPECT, ids[0]]))
    labels = row.get('Labels') or {}
    binding = [{'HostIp': '127.0.0.1', 'HostPort': '19088'}]
    if (row.get('Id') != ids[0] or not re.fullmatch(r'sha256:[a-f0-9]{64}', row.get('Image', '')) or
            labels.get('com.docker.compose.project') != PROJECT or labels.get('com.docker.compose.service') != 'app' or
            labels.get('com.docker.compose.project.working_dir') != str(LIVE_DIR / 'deploy') or
            (row.get('ConfiguredPorts') or {}).get('3001/tcp') != binding or
            ((row.get('State') or {}).get('Running') and (row.get('Ports') or {}).get('3001/tcp') != binding)):
        raise Refusal('App ownership, image or loopback binding does not match.')
    return row


class LocalTLS(http.client.HTTPSConnection):
    def connect(self):
        plain = socket.create_connection(('127.0.0.1', 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(plain, server_hostname=DOMAIN)
        except BaseException:
            plain.close()
            raise


def health(tls=False):
    connection = LocalTLS(DOMAIN, timeout=5, context=ssl.create_default_context()) if tls else http.client.HTTPConnection('127.0.0.1', 19088, timeout=5)
    try:
        connection.request('GET', '/api/health', headers={'Host': DOMAIN, 'Connection': 'close'})
        response = connection.getresponse()
        body = response.read(16385)
        data = json.loads(body) if len(body) <= 16384 else {}
        return {'httpStatus': response.status, 'ok': response.status == 200 and data.get('status') == 'ok' and data.get('database') == 'mongodb'}
    except Exception:
        return {'ok': False, 'failure': 'connection-tls-or-response'}
    finally:
        connection.close()


def provider_summary(identifier):
    try:
        row = json.loads(command(['docker', 'exec', identifier, 'node', '--import', 'tsx', '--input-type=module', '-e', PROVIDER_PROGRAM], timeout=45))
        configuration = row.get('configuration')
        if configuration not in ('available', 'unavailable', 'missing-key', 'invalid-model-name') or type(row.get('configured')) is not bool:
            raise ValueError()
        models = []
        if not isinstance(row.get('models'), list) or len(row['models']) > 2:
            raise ValueError()
        for item in row['models']:
            if (not re.fullmatch(r'(?:gpt-|chatgpt-|o[1-9])[a-zA-Z0-9._:-]{1,96}', item.get('model', '')) or
                    item.get('access') not in ('available', 'denied', 'model-unavailable', 'rate-or-quota', 'provider-error', 'timeout', 'connection-failed') or
                    not isinstance(item.get('roles'), list) or not item['roles'] or any(role not in ('extraction', 'scoring') for role in item['roles'])):
                raise ValueError()
            clean = {name: item[name] for name in ('model', 'roles', 'access')}
            if 'httpStatus' in item:
                if type(item['httpStatus']) is not int or not 100 <= item['httpStatus'] <= 599:
                    raise ValueError()
                clean['httpStatus'] = item['httpStatus']
            models.append(clean)
        return {'configured': row['configured'], 'configuration': configuration, 'models': models, 'billingQuotaChecked': False, 'gradingCalled': False}
    except Exception:
        return {'configuration': 'diagnostic-unavailable', 'billingQuotaChecked': False, 'gradingCalled': False}


def diagnose():
    app = app_container()
    state = app.get('State') or {}
    report = {'mode': 'read-only', 'app': {'image': app['Image'], 'running': state.get('Running') is True,
              'oomKilled': state.get('OOMKilled') is True, 'restarts': app.get('RestartCount') if type(app.get('RestartCount')) is int else None},
              'health': {'direct': health(), 'domainTLS': health(tls=True)}}
    health_state = (state.get('Health') or {}).get('Status')
    if health_state in ('healthy', 'unhealthy', 'starting'):
        report['app']['health'] = health_state
    release = re.fullmatch(re.escape(PROJECT) + r'-app:release-([a-f0-9]{12})-[A-Za-z0-9_.-]{1,100}', app.get('ImageRef', ''))
    if release:
        report['app']['releaseCommitPrefix'] = release[1]
    try:
        text = command(['docker', 'logs', '--tail', '300', '--since', '24h', app['Id']], stderr=True)
        report['logsLast24hTail300'] = {'available': True, 'apiFailures': len(re.findall(r'API failure:', text)),
                                     'aiCodes': {code: len(re.findall(r'AI grading failure:[^\n]*\b' + code + r'\b', text)) for code in CODES}}
    except Refusal:
        report['logsLast24hTail300'] = {'available': False}
    report['openaiModelAccess'] = provider_summary(app['Id']) if state.get('Running') else {'configuration': 'app-not-running', 'billingQuotaChecked': False, 'gradingCalled': False}
    return report


if __name__ == '__main__':
    try:
        if os.geteuid() != 0 or len(sys.argv) != 1:
            raise Refusal('Run this read-only diagnostic as root without arguments.')
        print(json.dumps(diagnose(), ensure_ascii=True, sort_keys=True))
    except Exception as error:
        print(json.dumps({'mode': 'read-only', 'error': str(error) if isinstance(error, Refusal) else 'Diagnostic unavailable; raw details withheld.'}))
        sys.exit(1)

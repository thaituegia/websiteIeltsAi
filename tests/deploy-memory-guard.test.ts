import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repository = fileURLToPath(new URL("../", import.meta.url));
function parsedConfig(file: string) {
  const path = join(repository, file);
  const read = ts.readConfigFile(path, ts.sys.readFile); assert.equal(read.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, repository, undefined, path);
  assert.equal(parsed.errors.length, 0, ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
    getCurrentDirectory: () => repository, getCanonicalFileName: value => value, getNewLine: () => "\n",
  }));
  return parsed;
}
function releasePrograms() {
  const packageFile = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  const commands = String(packageFile.scripts["build:release"]).split("&&").map(value => value.trim().split(/\s+/));
  assert.equal(commands.length, 3); assert.deepEqual(commands[2], ["vite", "build"]);
  return commands.slice(0, 2).map(command => {
    assert.equal(command.length, 3); assert.deepEqual(command.slice(0, 2), ["tsc", "-p"]);
    return parsedConfig(command[2]!);
  });
}
test("split release typechecks preserve every compiler option from the complete strict program", () => {
  const normal = parsedConfig("tsconfig.json");
  const normalized = (options: ts.CompilerOptions) => {
    const { configFilePath: _configPath, ...effective } = options; return effective;
  };
  assert.equal(normal.options.strict, true); assert.equal(normal.options.noEmit, true);
  for (const program of releasePrograms()) assert.deepEqual(normalized(program.options), normalized(normal.options));
});
test("the sequential release pipeline checks exactly all production roots and confines its heap limit to build", () => {
  const normal = parsedConfig("tsconfig.json");
  const ignored = readFileSync(join(repository, ".dockerignore"), "utf8").split(/\r?\n/).map(value => value.trim());
  assert.ok(ignored.includes("tests"));
  const expected = normal.fileNames.filter(file => !relative(repository, file).startsWith("tests/")).sort();
  const checked = [...new Set(releasePrograms().flatMap(program => program.fileNames))].sort();
  assert.deepEqual(checked, expected);
  const stages = readFileSync(join(repository, "deploy/Dockerfile.release"), "utf8").split(/^FROM /m).slice(1);
  assert.equal(stages.length, 2); assert.match(stages[0]!, /^node:24-bookworm-slim AS build\n/);
  const buildInstructions = stages[0]!.split(/\r?\n/).filter(line => /^RUN |^ENV /.test(line));
  assert.ok(buildInstructions.some(line => /^ENV NODE_OPTIONS=--max-old-space-size=384$/.test(line)));
  assert.ok(buildInstructions.some(line => /^RUN npm run build:release\s*&&\s*npm prune --omit=dev\b/.test(line)));
  assert.match(stages[1]!, /^node:24-bookworm-slim\n/);
  assert.ok(!stages[1]!.split(/\r?\n/).some(line => /^ENV .*NODE_OPTIONS/.test(line)));
  const standard = readFileSync(join(repository, "Dockerfile"), "utf8");
  assert.ok(standard.split(/\r?\n/).some(line => /^RUN npm run build\s*&&/.test(line)));
});

const variants = [
  { name: "reset", prefix: "RESET", cli: "run_reset_cli", path: "../deploy/reset-bank.sh" },
  { name: "preserving upgrade", prefix: "UPGRADE", cli: "run_upgrade_cli", path: "../deploy/update-exams.sh" },
].map(value => ({ ...value, source: readFileSync(new URL(value.path, import.meta.url), "utf8") }));

function block(source: string, name: string) {
  const code = source.match(new RegExp(`# ${name}_BEGIN\\n([\\s\\S]*?)\\n# ${name}_END`))?.[1];
  assert.ok(code, `Missing production ${name} block`);
  return code;
}
function temporary<T>(run: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "ielts-deploy-memory-"));
  try { return run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
function meminfo(kib: number) { return `MemTotal: 8121344 kB\nMemAvailable: ${kib} kB\n`; }
// Only replace the external /proc input; execute the actual production awk
// program, Bash arithmetic, guards, CLI runners and failure handlers unchanged.
const memoryInput = `
die() { printf '%s\\n' "$*" >&2; exit 71; }
awk() {
  if [[ "$#" == 2 && "$2" == /proc/meminfo ]]; then command awk "$1" "$IELTS_TEST_MEMINFO";
  else command awk "$@"; fi
}`;
function memoryRun(source: string, input: string, job: string, extra = "") {
  return temporary(directory => {
    const fixture = join(directory, "meminfo"); writeFileSync(fixture, input);
    return spawnSync("bash", ["-c", `set -euo pipefail\n${memoryInput}\n${block(source, "IELTS_MEMORY_GUARD")}\nassert_memory_headroom 'synthetic phase' "$IELTS_TEST_JOB"\n${extra}`], {
      encoding: "utf8", env: { ...process.env, IELTS_TEST_MEMINFO: fixture, IELTS_TEST_JOB: job },
    });
  });
}
function callLine(source: string, phase: string) {
  const line = source.split("\n").find(value => value.startsWith(`assert_memory_headroom '${phase}' `));
  assert.ok(line, `Missing deployed memory recheck for ${phase}`);
  return line;
}
function releaseRun(source: string, kind: "PYNEWRELEASE" | "PYRELEASE", options: {
  limit?: unknown; baseDockerfile?: string | null; releaseDockerfile?: string | null;
} = {}) {
  return temporary(directory => {
    const verifier = source.match(new RegExp(`<<'${kind}'[^\\n]*\\n([\\s\\S]*?)\\n${kind}`))?.[1]; assert.ok(verifier);
    const credentialPath = join(directory, "identities.json"); const fixture = join(directory, "compose.json");
    const appEnv = join(directory, "app.env");
    const credentials = { duoId: "synthetic-memory-test-pair", accounts: [{ name: "Synthetic A" }, { name: "Synthetic B" }] };
    writeFileSync(credentialPath, JSON.stringify(credentials));
    const docker = join(directory, "docker");
    writeFileSync(docker, '#!/usr/bin/env python3\nimport json,os,pathlib,sys\nx=json.loads(pathlib.Path(os.environ["IELTS_TEST_COMPOSE"]).read_text())\nprint(json.dumps(x["after" if "release.yaml" in sys.argv else "before"]))\n'); chmodSync(docker, 0o700);
    const app = (dockerfile: string | null, context: string) => ({
      image: "synthetic-image", build: { context, ...(dockerfile === null ? {} : { dockerfile }) },
      mem_limit: Object.hasOwn(options, "limit") ? options.limit : 512 * 1048576,
      env_file: [appEnv], environment: { DUO_ENABLED: "true", DUO_CREDENTIALS_FILE: "", DUO_ACCOUNTS_JSON: JSON.stringify(credentials) },
    });
    writeFileSync(fixture, JSON.stringify({
      before: { services: { app: app(options.baseDockerfile === undefined ? "Dockerfile" : options.baseDockerfile, "/synthetic/base") } },
      after: { services: { app: app(options.releaseDockerfile === undefined ? "deploy/Dockerfile.release" : options.releaseDockerfile, "/synthetic/source") } },
    }));
    return spawnSync("python3", ["-c", verifier, "synthetic-project", "synthetic.env", "base.yaml", "domain.yaml", "release.yaml", ...(kind === "PYNEWRELEASE" ? [credentialPath, String(512 * 1048576)] : ["/synthetic/source", appEnv])], {
      encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, IELTS_TEST_COMPOSE: fixture },
    });
  });
}

for (const variant of variants) {
  const { source, name, prefix, cli } = variant;
  test(`${name}: bounded jobs keep a full 1 GiB reserve at exact RAM boundaries`, () => {
    for (const [job, requiredMib] of [[512, 1536], [768, 1792]] as const) {
      assert.equal(memoryRun(source, meminfo(requiredMib * 1024), String(job)).status, 0);
      const low = memoryRun(source, meminfo(requiredMib * 1024 - 1), String(job));
      assert.equal(low.status, 71); assert.match(low.stderr, new RegExp(`${requiredMib} MiB`));
      assert.match(low.stderr, /1024 MiB dự phòng/);
    }
    assert.equal(memoryRun(source, meminfo(1661 * 1024), "512").status, 0);
  });
  for (const [label, input] of [
    ["missing MemAvailable", "MemFree: 8121344 kB\n"],
    ["duplicate MemAvailable", "MemAvailable: 8121344 kB\nMemAvailable: 8121344 kB\n"],
    ["zero available memory", "MemAvailable: 0 kB\n"],
    ["negative available memory", "MemAvailable: -8121344 kB\n"],
    ["fractional reading", "MemAvailable: 8121344.5 kB\n"],
    ["wrong units", "MemAvailable: 8121344 MB\n"],
    ["missing units", "MemAvailable: 8121344\n"],
    ["nonnumeric reading", "MemAvailable: available kB\n"],
    ["integer overflow", "MemAvailable: 999999999999999999999999 kB\n"],
  ]) {
    test(`${name}: ${label} fails closed`, () => {
      const result = memoryRun(source, input!, "512", "printf job-started");
      assert.equal(result.status, 71); assert.equal(result.stdout, "");
    });
  }
  test(`${name}: invalid job budgets cannot weaken the guard`, () => {
    for (const job of ["0", "-1", "512m", "512.5", "", "999999999999999999999999"]) {
      const result = memoryRun(source, meminfo(8121344), job);
      assert.equal(result.status, 71); assert.match(result.stderr, /Giới hạn RAM/);
    }
  });
  test(`${name}: startup budget uses the actual bounded app cap and rounds partial MiB upward`, () => {
    for (const [bytes, appMib, offlineMib] of [
      [256 * 1048576, 256, 512], [512 * 1048576, 512, 512],
      [768 * 1048576, 768, 768], [768 * 1048576 + 1, 769, 769],
    ]) {
      const result = spawnSync("bash", ["-c", `set -euo pipefail\ndie() { exit 71; }\nold_app_id=synthetic-owned-app\ndocker() { [[ "$*" == 'inspect --format {{.HostConfig.Memory}} synthetic-owned-app' ]]; printf '%s' "$IELTS_TEST_CAP"; }\n${block(source, "IELTS_APP_MEMORY")}\nprintf '%s %s' "$app_memory_mib" "$offline_job_mib"`], {
        encoding: "utf8", env: { ...process.env, IELTS_TEST_CAP: String(bytes) },
      });
      assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, `${appMib} ${offlineMib}`);
    }
  });
  test(`${name}: missing, unbounded or malformed runtime limits reject before app stop`, () => {
    for (const cap of ["", "0", "-1", "512m", "1.5", "1099511627777", "536870912\n536870912"]) {
      const result = spawnSync("bash", ["-c", `set -euo pipefail\ndie() { exit 71; }\nold_app_id=synthetic-owned-app\ndocker() { printf '%s' "$IELTS_TEST_CAP"; }\n${block(source, "IELTS_APP_MEMORY")}\nprintf app-stopped`], {
        encoding: "utf8", env: { ...process.env, IELTS_TEST_CAP: cap },
      });
      assert.equal(result.status, 71); assert.equal(result.stdout, "");
    }
  });
  for (const action of ["inspect", "apply", "verify"]) {
    test(`${name}: low RAM prevents ${action} CLI from invoking Docker`, () => temporary(directory => {
      const fixture = join(directory, "meminfo"); const jobs = join(directory, "docker-called");
      writeFileSync(fixture, meminfo(1535 * 1024));
      const result = spawnSync("bash", ["-c", `set -euo pipefail\n${memoryInput}\n${block(source, "IELTS_MEMORY_GUARD")}\ndatabase_network=synthetic-private;private_dir=/private;audit_dir="$IELTS_TEST_AUDIT";new_image=synthetic-image\ndocker() { printf docker-called > "$IELTS_TEST_JOBS"; }\n${block(source, `${prefix}_RUNNER`)}\n${cli} "$IELTS_TEST_ACTION"`], {
        encoding: "utf8", env: { ...process.env, IELTS_TEST_MEMINFO: fixture, IELTS_TEST_JOBS: jobs, IELTS_TEST_AUDIT: directory, IELTS_TEST_ACTION: action },
      });
      assert.equal(result.status, 71); assert.equal(existsSync(jobs), false);
      assert.match(result.stderr, new RegExp(`CLI ${action}`));
    }));
  }
  test(`${name}: build and manifest rechecks reject RAM lost after a passing preflight`, () => {
    for (const phase of ["build", "đọc manifest"]) {
      const result = memoryRun(source, meminfo(1661 * 1024), "512", `printf 'MemAvailable: 1535 kB\\n' > "$IELTS_TEST_MEMINFO"\n${callLine(source, phase)}\nprintf phase-job-started`);
      assert.equal(result.status, 71); assert.equal(result.stdout, ""); assert.ok(result.stderr.includes(phase));
    }
  });
  test(`${name}: low RAM before the mutation boundary restores the old app without marking mutation`, () => temporary(directory => {
    const fixture = join(directory, "meminfo"); const restored = join(directory, "old-app-restored");
    writeFileSync(fixture, meminfo(1661 * 1024));
    const boundary = source.match(/assert_memory_headroom 'trước thay đổi database'[^\n]*\n([\s\S]*?)mutation_started=true/);
    assert.ok(boundary);
    const result = spawnSync("bash", ["-c", `set -euo pipefail\n${memoryInput}\n${block(source, "IELTS_MEMORY_GUARD")}\napp_stopped=true;new_app_started=false;mutation_started=false;baseline_ready=false;offline_job_mib=768;audit_dir="$IELTS_TEST_AUDIT";source_commit=synthetic-pinned-commit\nrestore_old_app() { printf restored > "$IELTS_TEST_RESTORED"; }\nverify_existing() { return 1; }\n${block(source, `${prefix}_FAILURE_HANDLER`)}\ntrap on_exit EXIT\n${callLine(source, "trước thay đổi database")}\n${boundary[1]}mutation_started=true\nprintf database-called`], {
      encoding: "utf8", env: { ...process.env, IELTS_TEST_MEMINFO: fixture, IELTS_TEST_RESTORED: restored, IELTS_TEST_AUDIT: directory },
    });
    assert.equal(result.status, 71); assert.equal(readFileSync(restored, "utf8"), "restored");
    assert.equal(existsSync(join(directory, "mutation-started")), false); assert.equal(result.stdout, "");
  }));
  test(`${name}: RAM lost after mutation keeps new data offline and never restores the old app`, () => temporary(directory => {
    const fixture = join(directory, "meminfo"); const restored = join(directory, "old-app-restored");
    writeFileSync(fixture, meminfo(1791 * 1024)); writeFileSync(join(directory, "mutation-started"), "synthetic-pinned-commit\n");
    const result = spawnSync("bash", ["-c", `set -euo pipefail\n${memoryInput}\n${block(source, "IELTS_MEMORY_GUARD")}\napp_stopped=true;new_app_started=false;mutation_started=true;baseline_ready=false;app_memory_mib=768;audit_dir="$IELTS_TEST_AUDIT"\nrestore_old_app() { printf restored > "$IELTS_TEST_RESTORED"; }\nverify_existing() { return 1; }\n${block(source, `${prefix}_FAILURE_HANDLER`)}\ntrap on_exit EXIT\n${callLine(source, "khởi động app mới")}\nprintf app-started`], {
      encoding: "utf8", env: { ...process.env, IELTS_TEST_MEMINFO: fixture, IELTS_TEST_RESTORED: restored, IELTS_TEST_AUDIT: directory },
    });
    assert.equal(result.status, 71); assert.equal(existsSync(restored), false); assert.equal(result.stdout, "");
    assert.equal(readFileSync(join(directory, "mutation-started"), "utf8"), "synthetic-pinned-commit\n");
    assert.match(result.stderr, /Không tự rollback/);
  }));
  test(`${name}: every destructive and startup phase has its guard in the deployed order`, () => {
    const at = (value: string) => { const index = source.indexOf(value); assert.ok(index >= 0, value); return index; };
    const build = 'DOCKER_BUILDKIT=0 docker build --pull --memory=512m --memory-swap=512m';
    assert.ok(at(callLine(source, "kiểm tra ban đầu")) < at('exec 9>'));
    assert.ok(at(callLine(source, "build")) < at(build));
    assert.ok(at(build) < at(callLine(source, "đọc manifest")));
    assert.ok(at(callLine(source, "đọc manifest")) < at('docker run --rm --network none --memory=512m'));
    assert.ok(at(callLine(source, "trước dừng app IELTS")) < at('app_stopped=true'));
    assert.ok(at('stop --timeout 30 app > "$audit_dir/stop-old-app.log"') < at(callLine(source, "chuẩn bị database và app mới")));
    assert.ok(at(callLine(source, "chuẩn bị database và app mới")) < at('cp -p -- "$source_dir/deploy/compose.sh" "$compose_wrapper"'));
    assert.ok(at(callLine(source, "trước thay đổi database")) < at('> "$audit_dir/mutation-started"'));
    assert.ok(at('> "$audit_dir/mutation-started"') < at(`${cli} apply >`));
    assert.ok(at(`${cli} verify >`) < at(callLine(source, "khởi động app mới")));
    assert.ok(at(callLine(source, "khởi động app mới")) < at('new_app_started=true'));
  });
  test(`${name}: release verification rejects a runtime cap different from the inspected app`, () => {
    for (const [limit, accepted] of [
      [512 * 1048576, true], ["536870912", true], [768 * 1048576, false], [0, false], ["512m", false], [null, false],
      ["00536870912", false], ["536870912.0", false], [" 536870912", false], ["536870912\n", false],
      ["٥٣٦٨٧٠٩١٢", false], [true, false], [false, false],
    ] as const) {
      const result: SpawnSyncReturns<string> = releaseRun(source, "PYNEWRELEASE", { limit });
      assert.equal(result.status === 0, accepted, result.stderr); assert.equal(result.stdout, "");
    }
  });
  test(`${name}: the published verifier accepts the actual Compose JSON memory format`, () => temporary(directory => {
    const verifier = source.match(/<<'PYNEWRELEASE'[^\n]*\n([\s\S]*?)\nPYNEWRELEASE/)?.[1]; assert.ok(verifier);
    const credentials = { duoId: "synthetic-compose-memory-pair", accounts: [{ name: "Synthetic A" }, { name: "Synthetic B" }] };
    const credentialPath = join(directory, "identities.json"); writeFileSync(credentialPath, JSON.stringify(credentials));
    const deployEnv = join(directory, "deploy.env"); writeFileSync(deployEnv, "# Synthetic test only\n");
    const base = join(directory, "base.yaml"), domain = join(directory, "domain.yaml"), release = join(directory, "release.yaml");
    writeFileSync(base, `services:\n  app:\n    image: synthetic-no-pull-image\n    build:\n      context: ${JSON.stringify(directory)}\n      dockerfile: Dockerfile\n    mem_limit: 512m\n    environment:\n      DUO_ENABLED: "true"\n      DUO_CREDENTIALS_FILE: ""\n      DUO_ACCOUNTS_JSON: ${JSON.stringify(JSON.stringify(credentials))}\n`);
    writeFileSync(domain, 'services:\n  app:\n    environment:\n      APP_ORIGIN: https://synthetic.invalid\n');
    writeFileSync(release, 'services:\n  app:\n    build:\n      dockerfile: deploy/Dockerfile.release\n');
    // Compose config performs no build, pull, container start, or service change.
    const rendered = spawnSync("docker", ["compose", "--project-name", "synthetic-memory-format", "--env-file", deployEnv, "-f", base, "-f", domain, "-f", release, "config", "--format", "json"], { encoding: "utf8" });
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.equal(Number(JSON.parse(rendered.stdout).services.app.mem_limit), 512 * 1048576);
    const result = spawnSync("python3", ["-c", verifier, "synthetic-memory-format", deployEnv, base, domain, release, credentialPath, String(512 * 1048576)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "");
  }));
  test(`${name}: a new release permits only the validated base and resource-bounded release Dockerfiles`, () => {
    for (const options of [{}, { baseDockerfile: null }]) {
      const accepted = releaseRun(source, "PYNEWRELEASE", options); assert.equal(accepted.status, 0, accepted.stderr);
    }
    for (const options of [
      { baseDockerfile: "Dockerfile.unexpected" }, { baseDockerfile: "" },
      { releaseDockerfile: "Dockerfile" }, { releaseDockerfile: "deploy/Dockerfile.unexpected" }, { releaseDockerfile: null },
    ]) {
      const result = releaseRun(source, "PYNEWRELEASE", options); assert.notEqual(result.status, 0, JSON.stringify(options));
    }
  });
  test(`${name}: existing releases accept both historical and bounded Dockerfiles but reject unexpected build files`, () => {
    for (const releaseDockerfile of ["Dockerfile", "deploy/Dockerfile.release", null]) {
      const result = releaseRun(source, "PYRELEASE", { releaseDockerfile }); assert.equal(result.status, 0, result.stderr);
    }
    const defaultBase = releaseRun(source, "PYRELEASE", { baseDockerfile: null }); assert.equal(defaultBase.status, 0, defaultBase.stderr);
    for (const options of [
      { baseDockerfile: "Dockerfile.unexpected" }, { baseDockerfile: "" },
      { releaseDockerfile: "deploy/Dockerfile.unexpected" }, { releaseDockerfile: "" },
    ]) {
      const result = releaseRun(source, "PYRELEASE", options); assert.notEqual(result.status, 0, JSON.stringify(options));
    }
  });
}

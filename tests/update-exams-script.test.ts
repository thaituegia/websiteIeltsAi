import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = readFileSync(new URL("../deploy/update-exams.sh", import.meta.url), "utf8");
function block(name: string) {
  const code = script.match(new RegExp(`# ${name}_BEGIN\\n([\\s\\S]*?)\\n# ${name}_END`))?.[1];
  assert.ok(code, `The deployed ${name} implementation must be testable`);
  return code;
}
function temporary<T>(run: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "ielts-exams-upgrade-wrapper-"));
  try { return run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
const fixtures = {
  duoId: "synthetic-reset-pair",
  accounts: [
    { role: "husband", name: "Synthetic O'Connell A", phone: "0390000071", passwordHash: `scrypt:${"a".repeat(32)}:${"b".repeat(128)}` },
    { role: "wife", name: "Synthetic Việt $ B", phone: "0390000072", passwordHash: `scrypt:${"c".repeat(32)}:${"d".repeat(128)}` },
  ],
};
test("exam upgrade wrapper is valid Bash and rejects an unpinned or incomplete invocation", () => {
  assert.equal(spawnSync("bash", ["-n", "deploy/update-exams.sh"], { encoding: "utf8" }).status, 0);
  for (const args of [[], ["/tmp", "main", "0".repeat(64)], ["/tmp", "0".repeat(40), "0".repeat(64), "--force"]]) {
    const result = spawnSync("bash", ["deploy/update-exams.sh", ...args], { encoding: "utf8" });
    assert.equal(result.status, 2); assert.match(result.stderr, /Usage:/);
  }
});

const credentialCode = script.match(/credential_validator="\$\(cat <<'PYCREDENTIAL'\n([\s\S]*?)\nPYCREDENTIAL/ )?.[1];
assert.ok(credentialCode);
test("private credential validation produces distinct Compose and Docker formats with identical identities", () => temporary(directory => {
  const paths = ["identity.json", "compose.env", "docker.env"].map(name => join(directory, name));
  const result = spawnSync("python3", ["-c", credentialCode, ...paths], { input: JSON.stringify(fixtures), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "");
  const persisted = JSON.parse(readFileSync(paths[0]!, "utf8")); assert.deepEqual(persisted, fixtures);
  const composeFile = join(directory, "compose.yaml");
  writeFileSync(composeFile, `services:\n  app:\n    image: synthetic-no-pull-image\n    env_file:\n      - ${JSON.stringify(paths[1])}\n`);
  // Parse with actual Compose: dotenv's parser does not implement Compose's
  // escaped-apostrophe handling and would wrongly reject a legitimate name.
  const rendered = spawnSync("docker", ["compose", "--project-name", "ielts-exams-upgrade-format-test", "-f", composeFile, "config", "--format", "json"], { cwd: directory, encoding: "utf8" });
  assert.equal(rendered.status, 0, rendered.stderr);
  const compose = JSON.parse(rendered.stdout).services.app.environment;
  assert.deepEqual(JSON.parse(compose.DUO_ACCOUNTS_JSON.replace(/\$\$/g, "$")), fixtures);
  // Docker's env-file reader retains all characters following the first '='.
  const docker = Object.fromEntries(readFileSync(paths[2]!, "utf8").trim().split("\n").map(line => {
    const separator = line.indexOf("="); return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  assert.equal(docker.DUO_ENABLED, "true"); assert.equal(docker.DUO_CREDENTIALS_FILE, "");
  assert.deepEqual(JSON.parse(docker.DUO_ACCOUNTS_JSON!), fixtures);
  for (const path of paths) assert.equal(statSync(path).mode & 0o777, 0o600);
}));
for (const [label, modify] of [
  ["duplicate phone", (value: typeof fixtures) => { value.accounts[1]!.phone = value.accounts[0]!.phone; }],
  ["duplicate role", (value: typeof fixtures) => { value.accounts[1]!.role = "husband"; }],
  ["plaintext password", (value: typeof fixtures) => { value.accounts[0]!.passwordHash = "synthetic-cleartext"; }],
  ["embedded newline", (value: typeof fixtures) => { value.accounts[0]!.name = "Synthetic\nDUO_ENABLED=false"; }],
] as const) {
  test(`credential validator refuses ${label} before writing any account configuration`, () => temporary(directory => {
    const value = structuredClone(fixtures); modify(value);
    const paths = ["identity.json", "compose.env", "docker.env"].map(name => join(directory, name));
    const result = spawnSync("python3", ["-c", credentialCode, ...paths], { input: JSON.stringify(value), encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
    for (const account of value.accounts) { assert.ok(!result.stderr.includes(account.phone)); assert.ok(!result.stderr.includes(account.passwordHash)); }
    for (const path of paths) assert.throws(() => statSync(path));
  }));
}

function networkFixture() {
  return {
    inspect: [
      { NetworkSettings: { Networks: { "website-ielts-ai-synthetic_database": {} } } },
      { NetworkSettings: { Networks: { "website-ielts-ai-synthetic_database": { Aliases: ["mongo"] } } } },
    ],
    network: [{ Internal: true, Labels: { "com.docker.compose.project": "website-ielts-ai-synthetic", "com.docker.compose.network": "database" }, Containers: { "synthetic-mongo": {}, "synthetic-app": {} } }],
  };
}
function networkRun(value: ReturnType<typeof networkFixture>) {
  return spawnSync("bash", ["-c", `set -euo pipefail
die() { exit 71; }
docker() {
  if [[ "$1" == inspect ]]; then printf '%s' "$IELTS_TEST_INSPECT";
  elif [[ "$1" == network && "$2" == inspect ]]; then printf '%s' "$IELTS_TEST_NETWORK";
  else return 72; fi
}
project=website-ielts-ai-synthetic;old_app_id=synthetic-app;mongo_id=synthetic-mongo
${block("UPGRADE_NETWORK")}
printf '%s' "$database_network"`], { encoding: "utf8", env: { ...process.env, IELTS_TEST_INSPECT: JSON.stringify(value.inspect), IELTS_TEST_NETWORK: JSON.stringify(value.network) } });
}
test("exam upgrade preflight accepts only the isolated database network shared by the verified app and Mongo", () => {
  const result = networkRun(networkFixture()); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "website-ielts-ai-synthetic_database");
});
for (const [label, modify] of [
  ["a non-internal network", (value: ReturnType<typeof networkFixture>) => { value.network[0]!.Internal = false; }],
  ["another project's network", (value: ReturnType<typeof networkFixture>) => { value.network[0]!.Labels["com.docker.compose.project"] = "unrelated-project"; }],
  ["a third connected container", (value: ReturnType<typeof networkFixture>) => { Object.assign(value.network[0]!.Containers, { "unrelated-container": {} }); }],
  ["an ambiguous Mongo network", (value: ReturnType<typeof networkFixture>) => { Object.assign(value.inspect[1]!.NetworkSettings.Networks, { "external-network": {} }); }],
  ["a missing Mongo alias", (value: ReturnType<typeof networkFixture>) => { value.inspect[1]!.NetworkSettings.Networks["website-ielts-ai-synthetic_database"].Aliases = []; }],
] as const) {
  test(`exam upgrade preflight rejects ${label} before any data operation`, () => {
    const value = networkFixture(); modify(value); assert.notEqual(networkRun(value).status, 0);
  });
}

test("exam upgrade CLI runner uses only the private Mongo network, exact database and bounded privileges", () => temporary(directory => {
  const output = join(directory, "args.bin");
  const result = spawnSync("bash", ["-c", `set -euo pipefail
database_network=website-ielts-ai-synthetic_database;private_dir=/private;duo_env=/private/duo.env;audit_dir=/private/audit;new_image=synthetic-pinned-image
docker() { printf '%s\\0' "$@" > "$IELTS_TEST_ARGS"; }
assert_memory_headroom() { assert_stub_budget="$2"; [[ "$assert_stub_budget" == 512 ]]; }
${block("UPGRADE_RUNNER")}
run_upgrade_cli apply`], { encoding: "utf8", env: { ...process.env, IELTS_TEST_ARGS: output } });
  assert.equal(result.status, 0, result.stderr);
  const args = readFileSync(output, "utf8").split("\0").filter(Boolean);
  for (const expected of ["--rm", "website-ielts-ai-synthetic_database", "--memory=512m", "--memory-swap=512m", "--cpus=0.5", "--pids-limit=64", "--read-only", "--cap-drop", "ALL", "no-new-privileges:true", "MONGODB_URI=mongodb://mongo:27017/ielts_ai", "IELTS_APP_OFFLINE=true", "type=bind,src=/private/audit/backup,dst=/backup", "synthetic-pinned-image", "/app/server/bank-upgrade-cli.ts", "apply", "/backup/bank", "/private/audit/upgrade-cli.env"]) assert.ok(args.includes(expected), expected);
  assert.ok(!args.includes("--privileged")); assert.ok(!args.some(x => x.includes("docker.sock"))); assert.ok(!args.includes("--publish"));
  assert.equal(args.filter(x => x === "--mount").length, 1);
}));
test("read-only CLI inspection cannot mount the backup or fall through to apply", () => temporary(directory => {
  const output = join(directory, "args.bin");
  const result = spawnSync("bash", ["-c", `set -euo pipefail
database_network=website-ielts-ai-synthetic_database;private_dir=/private;duo_env=/private/duo.env;audit_dir=/private/audit;new_image=synthetic-pinned-image
docker() { printf '%s\\0' "$@" > "$IELTS_TEST_ARGS"; }
assert_memory_headroom() { assert_stub_budget="$2"; [[ "$assert_stub_budget" == 512 ]]; }
${block("UPGRADE_RUNNER")}
run_upgrade_cli inspect`], { encoding: "utf8", env: { ...process.env, IELTS_TEST_ARGS: output } });
  assert.equal(result.status, 0, result.stderr);
  const args = readFileSync(output, "utf8").split("\0").filter(Boolean);
  assert.equal(args.at(-1), "inspect"); assert.ok(!args.includes("--mount")); assert.ok(!args.includes("apply"));
}));

test("verification mounts the proven backup read-only and passes its path without any HTTP ports", () => temporary(directory => {
  const output = join(directory, "args.bin");
  const result = spawnSync("bash", ["-c", `set -euo pipefail
database_network=website-ielts-ai-synthetic_database;private_dir=/private;audit_dir=/private/audit;new_image=synthetic-pinned-image
docker() { printf '%s\\0' "$@" > "$IELTS_TEST_ARGS"; }
assert_memory_headroom() { assert_stub_budget="$2"; [[ "$assert_stub_budget" == 512 ]]; }
${block("UPGRADE_RUNNER")}
run_upgrade_cli verify`], { encoding: "utf8", env: { ...process.env, IELTS_TEST_ARGS: output } });
  assert.equal(result.status, 0, result.stderr);
  const args = readFileSync(output, "utf8").split("\0").filter(Boolean);
  assert.ok(args.includes("type=bind,src=/private/audit/backup,dst=/backup,readonly"));
  assert.deepEqual(args.slice(-2), ["verify", "/backup/bank"]);
  assert.equal(args.some(value => value.startsWith("--publish") || value.includes("docker.sock")), false);
}));

const sameCredentialCode = script.match(/<<'PYSAMECREDENTIALS'[^\n]*\n([\s\S]*?)\nPYSAMECREDENTIALS/)?.[1];
assert.ok(sameCredentialCode);
function identityRun(environment: string[]) {
  return temporary(directory => {
    const config = join(directory, "identity.json"); writeFileSync(config, JSON.stringify(fixtures), { mode: 0o600 });
    const fakeDocker = join(directory, "docker");
    writeFileSync(fakeDocker, "#!/usr/bin/env python3\nimport os\nprint(os.environ['IELTS_SYNTHETIC_INSPECT'])\n"); chmodSync(fakeDocker, 0o700);
    return spawnSync("python3", ["-c", sameCredentialCode!, "synthetic-owned-app", config], { encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, IELTS_SYNTHETIC_INSPECT: JSON.stringify([{ State: { Running: true }, Config: { Env: environment } }]) } });
  });
}
const ownEnvironment = ["DUO_ENABLED=true", "DUO_CREDENTIALS_FILE=", `DUO_ACCOUNTS_JSON=${JSON.stringify(fixtures)}`];
test("preserving updater proves supplied identities and password hashes equal the currently running app", () => {
  const result = identityRun(ownEnvironment); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "");
});
for (const [label, environment] of [
  ["changed hash", ["DUO_ENABLED=true", "DUO_CREDENTIALS_FILE=", `DUO_ACCOUNTS_JSON=${JSON.stringify({ ...fixtures, accounts: fixtures.accounts.map((row, index) => index ? row : { ...row, passwordHash: `scrypt:${"e".repeat(32)}:${"f".repeat(128)}` }) })}`]],
  ["file-only private login config", [...ownEnvironment.filter(value => !value.startsWith("DUO_CREDENTIALS_FILE=")), "DUO_CREDENTIALS_FILE=/other/config.json"]],
  ["disabled Duo", ownEnvironment.map(value => value === "DUO_ENABLED=true" ? "DUO_ENABLED=false" : value)],
  ["duplicate credential env key", [...ownEnvironment, "DUO_ENABLED=true"]],
] as const) {
  test(`preserving updater rejects ${label} before stopping the app or seeding`, () => {
    const result = identityRun([...environment]); assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
    for (const row of fixtures.accounts) { assert.equal(result.stderr.includes(row.phone), false); assert.equal(result.stderr.includes(row.passwordHash), false); }
  });
}

function failureRun(mutationStarted: boolean, appStopped: boolean, newAppStarted = false) {
  return temporary(directory => {
    const marker = join(directory, "old-app-restored");
    const stoppedMarker = join(directory, "new-app-stopped");
    const result = spawnSync("bash", ["-c", `mutation_started=${mutationStarted};app_stopped=${appStopped};new_app_started=${newAppStarted};baseline_ready=false;audit_dir="$IELTS_TEST_AUDIT"
current_args=(--project-name website-ielts-ai-synthetic -f /private/validated-current-release.yaml)
docker() { printf '%s\\0' "$@" > "$IELTS_TEST_STOP_MARKER"; }
restore_old_app() { printf restored > "$IELTS_TEST_MARKER"; }
verify_existing() { return 1; }
${block("UPGRADE_FAILURE_HANDLER")}
false
on_exit`], { encoding: "utf8", env: { ...process.env, IELTS_TEST_MARKER: marker, IELTS_TEST_STOP_MARKER: stoppedMarker, IELTS_TEST_AUDIT: directory } });
    let restored = false; try { restored = readFileSync(marker, "utf8") === "restored"; } catch {}
    let stopped: string[] = []; try { stopped = readFileSync(stoppedMarker, "utf8").split("\0").filter(Boolean); } catch {}
    return { ...result, restored, stopped };
  });
}
test("a stopped old app can be restored only before upgrade mutation begins", () => {
  const result = failureRun(false, true); assert.equal(result.status, 1); assert.equal(result.restored, true);
});
test("any failure after the mutation marker blocks automatic restoration of the old image", () => {
  for (const stopped of [false, true]) {
    const result = failureRun(true, stopped); assert.equal(result.status, 1); assert.equal(result.restored, false); assert.match(result.stderr, /Không tự rollback/);
  }
});
test("a failed post-start check stops only the new IELTS app and never restores the old image", () => {
  const result = failureRun(true, true, true); assert.equal(result.status, 1); assert.equal(result.restored, false);
  assert.deepEqual(result.stopped, ["compose", "--project-name", "website-ielts-ai-synthetic", "-f", "/private/validated-current-release.yaml", "stop", "--timeout", "30", "app"]);
  assert.match(result.stderr, /Đã dừng riêng app IELTS mới/);
});
test("a build-stage failure leaves the running old application alone", () => {
  const result = failureRun(false, false); assert.equal(result.status, 1); assert.equal(result.restored, false);
});
test("the database-writing boundary is ordered after build and offline proof, before preserving upgrade, before new startup", () => {
  const at = (value: string) => { const index = script.indexOf(value); assert.ok(index >= 0, value); return index; };
  assert.ok(at("DOCKER_BUILDKIT=0 docker build --pull") < at("run_upgrade_cli inspect >"));
  assert.ok(at("run_upgrade_cli inspect >") < at('stop --timeout 30 app > "$audit_dir/stop-old-app.log"'));
  assert.ok(at("App chưa offline") < at('> "$audit_dir/mutation-started"'));
  assert.ok(at('stop --timeout 30 app > "$audit_dir/stop-old-app.log"') < at('cp -p -- "$source_dir/deploy/compose.sh" "$compose_wrapper"'));
  assert.ok(at('cp -p -- "$source_dir/deploy/compose.sh" "$compose_wrapper"') < at('> "$audit_dir/mutation-started"'));
  assert.ok(at('> "$audit_dir/mutation-started"') < at("run_upgrade_cli apply >"));
  assert.ok(at("run_upgrade_cli apply >") < at("run_upgrade_cli verify >"));
  assert.ok(at("run_upgrade_cli verify >") < at('new_app_started=true'));
  assert.ok(!script.includes("dropDatabase")); assert.ok(!script.includes("docker compose down")); assert.ok(!script.includes("systemctl restart"));
  assert.ok(at("if (( $# == 4 ))") < at('exec 9>'));
});

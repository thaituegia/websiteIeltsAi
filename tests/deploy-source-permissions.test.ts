import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const commit = "f".repeat(40);
const prefix = `websiteIeltsAi-${commit}`;
type Entry = {
  path: string;
  kind: "file" | "directory" | "symlink" | "hardlink" | "fifo";
  body?: string;
  link?: string;
};
const file = (path: string): Entry => ({ path: `${prefix}/${path}`, kind: "file", body: `public source for ${path}\n` });
const directory = (path: string): Entry => ({ path: `${prefix}/${path}`, kind: "directory" });
const archiveBuilder = `
import io,json,sys,tarfile
with tarfile.open(sys.argv[1], 'w:gz') as bundle:
 for entry in json.load(sys.stdin):
  member=tarfile.TarInfo(entry['path'])
  member.mode=0o777
  if entry['kind']=='file':
   data=entry.get('body','').encode()
   member.size=len(data)
   bundle.addfile(member,io.BytesIO(data))
  else:
   member.type={'directory':tarfile.DIRTYPE,'symlink':tarfile.SYMTYPE,'hardlink':tarfile.LNKTYPE,'fifo':tarfile.FIFOTYPE}[entry['kind']]
   member.linkname=entry.get('link','')
   bundle.addfile(member)
`;

function extractionCode(wrapper: string) {
  const script = readFileSync(new URL(`../deploy/${wrapper}`, import.meta.url), "utf8");
  const code = script.match(/<<'PYEXTRACT'\n([\s\S]*?)\nPYEXTRACT/)?.[1];
  assert.ok(code, "Run the real extraction implementation embedded in the deploy wrapper");
  return code;
}
function mode(path: string) { return statSync(path).mode & 0o7777; }
function privateSnapshot(paths: string[]) {
  return paths.map(path => {
    const stat = statSync(path);
    return { path, mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid,
      ...(stat.isFile() ? { sha256: createHash("sha256").update(readFileSync(path)).digest("hex") } : {}),
    };
  });
}
function withExtractedArchive(wrapper: string, entries: Entry[], inspect: (source: string, result: ReturnType<typeof spawnSync>) => void) {
  const temporary = mkdtempSync(join(tmpdir(), "ielts-source-permissions-"));
  try {
    const release = join(temporary, "release");
    const source = join(release, "source");
    const audit = join(temporary, "audit");
    const backup = join(audit, "backup");
    for (const path of [release, source, audit, backup]) mkdirSync(path, { mode: 0o700 });
    const credentials = join(release, "credentials.json");
    const backupData = join(backup, "collection.ejsonl");
    writeFileSync(credentials, "generic private credential fixture\n", { mode: 0o600 });
    writeFileSync(backupData, "generic private backup fixture\n", { mode: 0o600 });
    const protectedPaths = [temporary, release, source, audit, backup, credentials, backupData];
    const before = privateSnapshot(protectedPaths);
    const archive = join(temporary, "source.tar.gz");
    const built = spawnSync("python3", ["-c", archiveBuilder, archive], { encoding: "utf8", input: JSON.stringify(entries) });
    assert.equal(built.status, 0, built.stderr);
    // This is the operator wrapper's real umask, not the test runner's default.
    const result = spawnSync("python3", ["-c", `import os\nos.umask(0o077)\n${extractionCode(wrapper)}`, archive, source, commit], { encoding: "utf8" });
    inspect(source, result);
    assert.deepEqual(privateSnapshot(protectedPaths), before, "Public source normalization must preserve private ancestors, credentials and backups");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
function assertPublicSource(source: string, entries: Entry[]) {
  assert.equal(mode(source), 0o700, "The private build context root remains private");
  function visit(path: string) {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) {
        assert.equal(mode(child), 0o755, "Every public child must remain traversable after runtime COPY changes ownership");
        visit(child);
      } else assert.equal(mode(child), 0o644, "Only public source files receive read permission");
    }
  }
  visit(source);
  for (const entry of entries) if (entry.kind === "file") {
    const relative = entry.path.slice(prefix.length + 1);
    assert.equal(readFileSync(join(source, relative), "utf8"), entry.body, "Extraction preserves the source bytes");
  }
}

for (const wrapper of ["reset-bank.sh", "update-exams.sh"]) {
  const successful: Array<[string, Entry[]]> = [
    ["explicit public directories", [directory("server"), directory("server/data"), file("server/data/index.ts"), file("server/duo-auth.ts")]],
    ["implicit and deeply nested public parents", [file("server/data/exams/new-bank.ts"), file("shared/types.ts"), file("client/public/fonts/vietnamese.woff2")]],
    ["directory entries following files and repeated parents", [file("server/data/index.ts"), directory("server/data"), directory("server"), directory("server/data"), file("shared/content-visuals.ts")]],
  ];
  for (const [label, entries] of successful) {
    test(`${wrapper}: umask 077 preserves private files while normalizing ${label}`, () => {
      withExtractedArchive(wrapper, entries, (source, result) => {
        assert.equal(result.status, 0, String(result.stderr));
        assertPublicSource(source, entries);
      });
    });
  }
  const unsafe: Array<[string, Entry]> = [
    ["symlink", { path: `${prefix}/server/data`, kind: "symlink", link: "../../credentials.json" }],
    ["hardlink", { path: `${prefix}/server/data/index.ts`, kind: "hardlink", link: `${prefix}/credentials.json` }],
    ["parent traversal", { path: `${prefix}/../credentials.json`, kind: "file", body: "must never be written" }],
    ["nested parent traversal", { path: `${prefix}/server/../../credentials.json`, kind: "file", body: "must never be written" }],
    ["absolute path", { path: `/${prefix}/server/data/index.ts`, kind: "file", body: "must never be written" }],
    ["wrong archive prefix", { path: "another-project/server/data/index.ts", kind: "file", body: "must never be written" }],
    ["special FIFO", { path: `${prefix}/server/data/index.ts`, kind: "fifo" }],
  ];
  for (const [label, entry] of unsafe) {
    test(`${wrapper}: rejects a late ${label} before writing or chmodding any member`, () => {
      // A valid file comes first: incremental validation would incorrectly write it.
      withExtractedArchive(wrapper, [file("server/first-valid.ts"), entry], (source, result) => {
        assert.notEqual(result.status, 0);
        assert.deepEqual(readdirSync(source), [], "All archive members must pass validation before the first extraction write");
        assert.equal(mode(source), 0o700);
      });
    });
  }
}

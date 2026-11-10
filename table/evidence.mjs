import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, globSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const sha = (value) => createHash('sha256').update(value).digest('hex');
const fileHash = (file) => sha(readFileSync(file));
const text = (value) => JSON.stringify(value, null, 2) + '\n';
const runtime = () => ({
  path: process.execPath,
  version: process.version,
  harnessSha256: fileHash(new URL('./harness.mjs', import.meta.url)),
  statsSha256: fileHash(new URL('../lib/stats.mjs', import.meta.url)),
});

function git(cwd, ...args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch {
    return null;
  }
}

function configPath(directory, stopAt) {
  for (let current = directory; ; current = path.dirname(current)) {
    const file = path.join(current, 'gt.json');
    if (existsSync(file)) return file;
    if (current === stopAt || path.dirname(current) === current) return null;
  }
}

export function identity(adapter) {
  const directory = path.dirname(adapter);
  const gitRoot = git(directory, 'rev-parse', '--show-toplevel');
  const repository = gitRoot ? path.normalize(gitRoot) : null;
  const config = configPath(directory, repository);
  const patterns = config ? JSON.parse(readFileSync(config, 'utf8')).sources : ['*.mjs', '*.js', '*.json'];
  if (!Array.isArray(patterns) || !patterns.every((item) => typeof item === 'string')) throw new Error('gt.json needs source globs.');
  const root = config ? path.dirname(config) : directory;
  const files = new Set([adapter, ...(config ? [config] : [])]);
  for (const file of globSync(patterns, { cwd: root, withFileTypes: true })) {
    if (file.isFile()) files.add(path.resolve(file.parentPath, file.name));
  }
  const sources = [...files].sort().map((file) => [file, fileHash(file)]);
  return {
    adapter,
    git: repository ? { commit: git(repository, 'rev-parse', 'HEAD'), dirty: Boolean(git(repository, 'status', '--porcelain', '--', '.', ':(exclude).gt')) } : null,
    sourceSha256: sha(text(sources)),
    engine: runtime(),
  };
}

export function save(directory, report, evidence) {
  mkdirSync(directory, { recursive: true });
  const reportPath = path.join(directory, 'report.json');
  const stampPath = path.join(directory, 'stamp.json');
  const bytes = text(report);
  const stamp = text({ tool: '0.1.0', renderer: null, device: null, ...evidence, reportSha256: sha(bytes) });
  const key = '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(reportPath + key, bytes);
    writeFileSync(stampPath + key, stamp);
    renameSync(reportPath + key, reportPath);
    renameSync(stampPath + key, stampPath);
  } finally {
    rmSync(reportPath + key, { force: true });
    rmSync(stampPath + key, { force: true });
  }
  return reportPath;
}

export function freshReport(reportPath) {
  try {
    const stamp = JSON.parse(readFileSync(path.join(path.dirname(reportPath), 'stamp.json'), 'utf8'));
    const bytes = readFileSync(reportPath);
    const result = JSON.parse(bytes);
    if (stamp.tool !== '0.1.0' || result.type !== 'table-run' || stamp.reportSha256 !== sha(bytes) ||
        text(stamp.identity) !== text(identity(stamp.identity.adapter))) return null;
    return { report: result, identity: stamp.identity, sha256: stamp.reportSha256 };
  } catch {
    return null;
  }
}

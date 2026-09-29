import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';

if (!process.env.DATABASE_URL) throw new Error('缺少 DATABASE_URL；请使用 node --env-file=.env 运行');
const url = new URL(process.env.DATABASE_URL);
if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
  throw new Error('DATABASE_URL 必须是 PostgreSQL 连接地址');
}
const root = resolve(import.meta.dirname, '..');
const runtime = join(root, '.runtime');
const marker = join(runtime, 'maintenance');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const pending = join(root, 'backups', `${stamp}.partial`);
const target = pending.slice(0, -8);
const storage = resolve(root, process.env.STORAGE_DIR || './storage');
const args = ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', decodeURIComponent(url.pathname.slice(1))];
const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
if (url.searchParams.has('sslmode')) env.PGSSLMODE = url.searchParams.get('sslmode');

function run(command, extraArgs, capture = false) {
  const result = spawnSync(command, [...args, ...extraArgs], { env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 失败，退出码 ${result.status}`);
  return result.stdout;
}

mkdirSync(runtime, { recursive: true });
mkdirSync(join(root, 'backups'), { recursive: true });
const lock = openSync(marker, 'wx', 0o600);
try {
  closeSync(lock);
  writeFileSync(marker, new Date().toISOString());
  mkdirSync(pending);
  run('pg_dump', ['-Fc', '-f', join(pending, 'database.dump')]);
  const counts = run('psql', ['-v', 'ON_ERROR_STOP=1', '-tA', '-f', join(root, 'scripts', 'backup-counts.sql')], true).trim();
  JSON.parse(counts);
  writeFileSync(join(pending, 'counts.json'), `${counts}\n`);
  if (existsSync(storage)) cpSync(storage, join(pending, 'storage'), { recursive: true });
  renameSync(pending, target);
  console.log(`备份完成：${target}（数据库与图片需一起恢复）`);
} finally {
  rmSync(marker, { force: true });
}

// 备份脚本 — 本地 pg_dump + storage，可选 rclone 异地上传与 webhook 告警。
// 配置要求：预先执行 `rclone config` 配好 remote（如 cos:feibiao-backup），
// systemd timer 每日执行本脚本，每月做一次恢复演练。
// 环境变量：
//   BACKUP_REMOTE      — rclone remote 路径（如 cos:feibiao-backup），留空则不上传
//   BACKUP_RETENTION_DAYS — 远端保留天数，默认 30
//   ALERT_WEBHOOK      — 可选 webhook URL，备份成功/失败时 POST JSON 通知
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync, closeSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

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
const remote = process.env.BACKUP_REMOTE || '';
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS) || 30;
const webhook = process.env.ALERT_WEBHOOK || '';

function run(command, extraArgs, capture = false) {
  const result = spawnSync(command, [...args, ...extraArgs], { env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 失败，退出码 ${result.status}`);
  return result.stdout;
}

function runRclone(rcloneArgs) {
  const result = spawnSync('rclone', rcloneArgs, { encoding: 'utf8', stdio: 'inherit' });
  return result;
}

function alert(status, detail) {
  if (!webhook) return;
  try {
    spawnSync('node', ['-e', `require('https').request(${JSON.stringify(webhook)},{method:'POST',headers:{'Content-Type':'application/json'}},()=>{}).end(JSON.stringify(${JSON.stringify(JSON.stringify({ status, detail, stamp }))}))`], { encoding: 'utf8', stdio: 'ignore' });
  } catch {}
}

mkdirSync(runtime, { recursive: true });
mkdirSync(join(root, 'backups'), { recursive: true });
const lock = openSync(marker, 'wx', 0o600);
try {
  closeSync(lock);
  writeFileSync(marker, new Date().toISOString());
  await new Promise(r => setTimeout(r, 2000));
  mkdirSync(pending);
  run('pg_dump', ['-Fc', '-f', join(pending, 'database.dump')]);
  const counts = run('psql', ['-v', 'ON_ERROR_STOP=1', '-tA', '-f', join(root, 'scripts', 'backup-counts.sql')], true).trim();
  JSON.parse(counts);
  writeFileSync(join(pending, 'counts.json'), `${counts}\n`);
  if (existsSync(storage)) cpSync(storage, join(pending, 'storage'), { recursive: true });
  renameSync(pending, target);
  console.log(`备份完成：${target}（数据库与图片需一起恢复）`);
  if (remote) {
    const remoteTarget = `${remote}/${stamp}`;
    const r1 = runRclone(['copy', target, remoteTarget]);
    if (r1.error || r1.status !== 0) console.warn(`警告：rclone 上传失败（${r1.error?.message || '退出码 ' + r1.status}），本地备份已成功`);
    else console.log(`异地备份已上传：${remoteTarget}`);
    const r2 = runRclone(['delete', '--min-age', `${retentionDays}d`, remote]);
    if (r2.error || r2.status !== 0) console.warn(`警告：rclone 清理远端旧备份失败（${r2.error?.message || '退出码 ' + r2.status}）`);
  }
  alert('success', target);
} catch (e) {
  alert('failure', String(e.message || e));
  throw e;
} finally {
  rmSync(marker, { force: true });
}

# Linux 部署（单台服务器）

以 Ubuntu 云服务器、`/srv/feibiao` 项目目录、同机 PostgreSQL 和 Nginx 为例。项目的 Windows `.ps1` 脚本在 Linux 上不用；网页服务由 systemd 管理，数据库由操作系统管理。服务器准备好后，先把域名解析到服务器，并在腾讯云安全组开放 80、443；3000 和 5432 不对公网开放。

## 1. 安装运行环境

安装 Node.js 24、PostgreSQL、PostgreSQL 客户端、Nginx、Python 3 和 Certbot。Node.js 版本与本项目 README 一致；从 [Node.js 官方下载页](https://nodejs.org/en/download)获取适合服务器架构的 Linux 版本。PostgreSQL 可用 Ubuntu 包；如需指定 17 版，按 [PostgreSQL 官方 Ubuntu 安装说明](https://www.postgresql.org/download/linux/ubuntu/)添加其仓库。检查：

```bash
node --version
npm --version
psql --version
pg_dump --version
nginx -v
```

## 2. 建立独立账号和数据库

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin feibiao
sudo -u postgres createuser -P feibiao
sudo -u postgres createdb -O feibiao feibiao
sudo install -d -o feibiao -g feibiao /srv/feibiao
sudo -u feibiao -H git clone https://github.com/wutttttttt/feibiao.git /srv/feibiao
```

`createuser -P` 会提示输入数据库密码。若 `/srv/feibiao` 已有代码，就直接在该目录更新，不要再次克隆或覆盖 `.env`、`storage`、`backups`。这些目录及文件应归 `feibiao` 用户所有。

创建仅服务器可读的 `/srv/feibiao/.env`：

```bash
sudo install -m 600 -o feibiao -g feibiao /dev/null /srv/feibiao/.env
sudoedit /srv/feibiao/.env
```

内容示例（替换密码和密钥；密码含特殊字符时按 URL 规则编码）：

```dotenv
DATABASE_URL="postgresql://feibiao:数据库密码@127.0.0.1:5432/feibiao?schema=public"
SESSION_SECRET="至少32位的随机密钥"
STORAGE_DIR="/srv/feibiao/storage"
```

可用 `openssl rand -hex 32` 生成会话密钥。正式库不要运行 `npm run db:seed`：该命令会写入固定密码的演示账号和演示货。

## 3. 构建、迁移并创建正式老板账号

在 `/srv/feibiao` 中，以 `feibiao` 用户执行：

```bash
sudo -u feibiao -H sh -c 'cd /srv/feibiao && npm ci && npm run build && npm run db:migrate'
```

全新空库只执行一次正式账号初始化。密码不写入 `.env` 或命令历史，至少16位；脚本发现已有商家或用户会拒绝执行：

```bash
sudo -u feibiao -H bash
cd /srv/feibiao
read -rsp '正式老板密码：' BOOTSTRAP_OWNER_PASSWORD; echo
export BOOTSTRAP_OWNER_PASSWORD
BOOTSTRAP_MERCHANT_NAME='你的商家名' BOOTSTRAP_OWNER_LOGIN='你的登录账号' BOOTSTRAP_OWNER_NAME='老板姓名' npm run bootstrap:owner
unset BOOTSTRAP_OWNER_PASSWORD
exit
```

不要运行 `npm run db:seed`。初始化完成后安装并启动服务：

```bash
sudo cp /srv/feibiao/deploy/linux/feibiao.service /etc/systemd/system/feibiao.service
sudo systemctl daemon-reload
sudo systemctl enable --now feibiao
sudo systemctl status feibiao
curl -I http://127.0.0.1:3000/
```

systemd 示例假定 `npm` 可在 `/usr/local/bin` 或 `/usr/bin` 找到。如果 Node 安装在其他位置，按 `command -v npm` 调整 [服务文件](../deploy/linux/feibiao.service)里的 `PATH`。服务默认只监听 `127.0.0.1:3000`。

## 4. 反向代理和 HTTPS

把 [Nginx 示例](../deploy/linux/nginx.conf)的 `example.com` 改成实际域名，然后安装并检查：

```bash
sudo cp /srv/feibiao/deploy/linux/nginx.conf /etc/nginx/sites-available/feibiao
sudo ln -s /etc/nginx/sites-available/feibiao /etc/nginx/sites-enabled/feibiao
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d 你的域名
```

Ubuntu 若保留了默认站点，先移除 `/etc/nginx/sites-enabled/default` 的链接。确认 Certbot 已把 HTTP 重定向到 HTTPS，再通过正式域名登录。生产会话 Cookie 仅在 HTTPS 下发送；微信小程序也需要有效证书和已登记的 HTTPS 业务域名。`client_max_body_size 10m` 对应应用最大 8 MB 的图片上传。示例配置还会把登录限制为每个 IP 每分钟5次、短时最多突发5次，并添加基础安全响应头；不要让外网绕过 Nginx 直连3000端口。

## 5. 备份、更新和验收

备份命令会暂时阻止业务写入，生成数据库转储、业务表数量清单和图片副本：

```bash
sudo -u feibiao -H sh -c 'cd /srv/feibiao && node --env-file=.env scripts/backup.mjs'
```

备份保存在 `/srv/feibiao/backups/`，必须再复制到服务器外部并定期做独立恢复演练。恢复时数据库转储和同次备份的 `storage` 目录必须一起使用，不能直接覆盖正在运行的正式库。

同机恢复演练可先建独立数据库，再用某次备份的 `database.dump` 恢复，并把输出与该备份的 `counts.json` 比较；确认后删除演练库：

```bash
sudo -u postgres createdb -O feibiao feibiao_restore_check
sudo -u feibiao pg_restore --no-owner -d feibiao_restore_check /srv/feibiao/backups/备份时间/database.dump
sudo -u feibiao psql -d feibiao_restore_check -tA -f /srv/feibiao/scripts/backup-counts.sql
sudo -u postgres dropdb feibiao_restore_check
```

还要抽查同次备份 `storage` 中的图片能打开，并与原图片核对。恢复演练中的数据库不供业务系统使用。

更新时先备份，再拉取代码、安装锁定依赖、构建、迁移和重启：

```bash
sudo -u feibiao -H sh -c 'cd /srv/feibiao && git pull --ff-only && npm ci && npm run build && npm run db:migrate'
sudo systemctl restart feibiao
sudo journalctl -u feibiao -n 100 --no-pager
```

上线验收至少检查 HTTPS 登录、连续错误登录返回429、扫码/拍照上传与查看、借入借出和收款权限、图片备份及恢复。正式启用前确认货权与上游分账规则，并执行 `npm audit --omit=dev --audit-level=high`。

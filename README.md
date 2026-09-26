# 翠账：翡翠摊主管货与对账

面向单个瑞丽翡翠摊主的本地系统。货品一物一码，拿货、成交、交付与收付款分开记录；自有货和寄售货分别核算。界面在手机、电脑浏览器及原生微信小程序中使用。小程序源码与接入说明见 [微信小程序](./docs/微信小程序.md)，第三方打印机设置见 [标签打印](./docs/标签打印.md)。

## 本机首次启动（Windows PowerShell）

需要 Node.js 24、PostgreSQL 17 Windows 二进制包。将 [PostgreSQL 官方推荐的 EDB 二进制包](https://www.postgresql.org/download/windows/)解压到项目 `.runtime/postgres`，使 `.runtime/postgres/pgsql/bin/initdb.exe` 存在。下载包无需提交到源码。

```powershell
npm install
./scripts/init-db.ps1
npx prisma migrate deploy
npx prisma generate
npm run db:seed
npm run dev
```

打开 `http://127.0.0.1:3000`。首次初始化脚本在 `.env` 写入随机数据库密码与会话密钥；不要把 `.env` 发给别人。以后按顺序执行 `./scripts/start-db.ps1` 和 `./scripts/start-app.ps1`，即可在后台启动数据库与已构建的业务系统。停止时先执行 `./scripts/stop-app.ps1`，再执行 `./scripts/stop-db.ps1`。修改源码后先运行 `npm run build`；开发时也可用 `npm run dev` 交互运行。

| 演示账号 | 密码 | 权限 |
|---|---|---|
| `boss` | `DemoBoss2026!` | 老板，全部权限 |
| `staff` | `DemoStaff2026!` | 录货、拿货、盘点；不可查看成本及账务 |
| `cashier` | `DemoCash2026!` | 拿货、成交、收款；不可向上游付款 |

演示数据与真实数据应使用不同数据库和图片目录。导入正式数据前，请修改演示密码并新建独立数据库；不要把演示库当真实账本继续使用。`scripts/seed.ts` 可重复执行，不会重复创建50件演示货。两名演示员工只获授权访问“客户甲”；老板可在“我的 → 员工与权限”按客户授权。

## 日常使用

先在“我的”建立合作方和位置，再在“货品”录货、补照片。客户拿货时从“拿货单”选择多件货、记录实际接收人与应还时间；每件归还时验货，异常货自动进入待处理，老板可在“货品 → 异常货与货损”记录责任和处置。确认成交后到“往来账”登记收款并核销到具体货品；寄售货的上游应付单独显示，客户款收齐后才允许付款。

CSV/XLSX 导入先预览校验；CSV 文件请保存为 UTF-8。可用 [模板目录](./templates) 内的样例表头；样例行仅演示，导入前须修改。导出包含货品、拿货及按合作方的客户或上游对账 CSV。标签用本地条码库生成，无需联网。网页支持手机拍照、实时摄像头扫码、扫码枪及手工货号查询；本机 `127.0.0.1` 可请求摄像头权限，手机从局域网访问则需要 HTTPS。微信小程序使用微信扫码接口。

## 验证和备份

`./scripts/test.ps1` 会创建并使用独立的 `feicui_test` 数据库执行自动化测试，不改演示库。`./scripts/backup.ps1` 暂停写入，备份数据库和图片；`./scripts/verify-restore.ps1 -BackupDirectory <备份目录>` 恢复到独立数据库验证。详见 [备份恢复说明](./docs/备份恢复.md)。

业务规则和数据关系见 [数据库与业务规则](./docs/数据库与业务规则.md)，接口与页面见 [页面与接口](./docs/页面与接口.md)，已验证及限制见 [验收记录](./docs/验收记录.md)。

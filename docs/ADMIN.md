# CYword 管理控制台

入口：`https://cyword.chengyi.me/admin/`。管理后台与官网同属 `cyword` Pages 项目，但使用单独的页面入口、样式及服务端权限校验。页面包含数据总览、用户管理、资源监控和操作日志。

## 数据口径

- 注册与登录统计采用 `Asia/Shanghai` 日期。注册账号来自 D1 `users`，默认排除测试账号。
- 今日与近 7 日登录用户来自后台启用后的 `auth_events`，按账号去重；不代表学习活跃用户，离线学习无法被服务端观测。
- 历史云端进度只展示词书、修订号、更新时间和压缩数据大小，不读取或解压正文。客户端当前学习进度保存在本机。
- 资源指标通过 Cloudflare GraphQL Analytics API 获取。缺少授权、查询失败或窗口内没有数据时显示对应状态，不用 0 代替未知数据。Pages 函数执行异常与 HTTP 5xx 是不同口径；当前只展示前者。R2 操作次数不代表软件下载人数。邮件投递指标尚未接入。

## 生产配置

1. 先确认旧 `users` 与 `learning_progress` 表存在，再执行 `website/migrations/0002_admin.sql`。该迁移增加账号状态、凭证版本、测试标记、备注、管理员、认证事件和审计表，并将 `cyi907369@gmail.com` 设为唯一初始 Owner。
2. 在 Cloudflare Access 建立自托管应用 **CYword 管理控制台**，只保护 `cyword.chengyi.me/admin*`、`cyword.chengyi.me/api/admin*`、`cyword.pages.dev/admin*` 和 `cyword.pages.dev/api/admin*`。策略只允许 `cyi907369@gmail.com`。不要复用其他项目的管理员策略。
3. 将该 Access 应用的 Audience Tag 作为 Pages Production 加密 Secret `ACCESS_AUD`；`ACCESS_TEAM_DOMAIN` 已在 `website/wrangler.jsonc` 指向当前团队域。后端强制校验 Access JWT 签名、签发者、受众、有效期与 D1 管理员角色。缺少任一配置时管理入口拒绝访问。
4. 为资源页创建仅有 Analytics 读取权限的 API Token，并保存为 Pages Production 加密 Secret `CF_ANALYTICS_TOKEN`。`CF_ACCOUNT_ID` 与当前 Pages 函数脚本名 `CF_PAGES_SCRIPT_NAME` 已在 Wrangler 配置中；重新创建 Pages 项目时须更新脚本名。令牌缺失时用户功能仍可用，资源页会显示未接入。
5. 执行 `npm run deploy:site`。部署后验证 `/admin/`、`/admin/users`、`/api/admin/me` 的未授权请求被拒绝，并用 Owner 身份逐页检查真实数据。既要检查自定义域，也要检查 `cyword.pages.dev`。

管理员角色保存在 `admin_principals`：Owner 和 Operator 可查看并管理用户，Viewer 只能查看汇总和资源指标。账号封禁、解封及撤销凭证会增加 `token_version`，旧云端 JWT 随即失效；已经下载到设备上的离线词书与学习记录不会被远程删除。管理写操作要求同源请求、理由或有效备注，并和审计日志在 D1 事务中一起提交。

## 本地预览与验证

运行 `npm run dev:site`，打开 `http://127.0.0.1:5174/admin/`。Vite 只提供界面文件，不模拟 Cloudflare Access、D1 或 GraphQL API，所以直接访问会显示身份验证失败。运行 `npm run test:site:ui -- --grep "admin console"` 可使用隔离的模拟数据查看桌面和手机交互；测试截图位于 `.work/site-ui-results/`。接口与权限测试运行 `node --test tests/admin.test.mjs tests/auth.test.ts tests/sync-api.test.mjs`，官网构建运行 `npm run build:site`。

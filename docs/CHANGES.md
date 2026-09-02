# 变更记录

## 0.4.1 · 2026-09-02

- 修复正式环境在缺少邮件密钥时错误进入模拟发信、回显并自动填入验证码的问题；生产认证现在缺少 `RESEND_API_KEY` 或强随机 `JWT_SECRET` 时直接拒绝服务。
- Resend 发信人改为已隔离的 `login@auth.cyword.chengyi.me`，邮件发送失败会撤销不可用验证码，不再让用户进入无意义的重发冷却。
- 验证码邮件正文标题简化为 `CYword`，原绿色视觉替换为与客户端一致的陶土橙品牌色。
- 正式客户端拒绝服务端调试验证码字段；本地 Vite 开发环境仍保留明确隔离的模拟验证码流程。安装包继续只包含应用代码，不包含 Electron `userData` 中的邮箱、会话或学习进度。
- 恢复权威 Cloudflare DNS 中的 `cyword` 官网记录，并为专用 Resend 发信域补齐 DKIM 与退信跟踪记录；根域和 `www` 保持不变。

## 0.4.0 · 2026-09-02

- 新增邮箱验证码（OTP）免密注册与登录系统：接入 Cloudflare D1 存储用户基础信息与临时验证码，通过 Resend 发送验证码邮件，使用 Web Crypto HMAC-SHA256 签发 JWT 会话。
- 桌面客户端会话持久化存储在 `userData/session.json`，未登录时自动唤起登录弹窗，登录后在侧边栏底部展示用户邮箱并提供注销入口；背单词学习进度继续保存在本地 `userData/progress.json`。
- 后端新增 `/api/auth/send-code`、`/api/auth/verify-code` 和 `/api/auth/me` Pages Functions 路由，具备 60 秒重发冷却与 5 次错误尝试防暴力破解机制；本地开发环境内置自动回显模拟发信。

## 0.3.0 · 2026-09-01

- 桌面端更新源改为官网 generic provider：应用启动时读取 `https://cyword.chengyi.me/downloads/latest.yml`，安装器、blockmap 和更新清单都从官网 R2 流式下载；GitHub Release 保留为公开记录和旧版迁移备用入口。
- 推送与 `package.json` 一致的 `v0.3.0` 标签后，GitHub Actions 会先创建 GitHub Release，再把同一次 Windows NSIS 构建按内容哈希写入 R2，最后原子切换 `releases/current.json`，官网无需重新构建即可读取新版本。
- 官网当前发布文件为 `CYword-Setup-0.3.0.exe`，大小 `111773561` 字节，SHA-256 为 `4d319bc53f9903bbb57205db49cbe09d514c99e491c0a61f04027898a1f06b4e`。主下载地址为 `/downloads/latest`，GitHub v0.3.0 是备用地址；两者指向同一份正式构建产物。
- 官网 Pages Functions 新增只读下载协议（HEAD、单段 Range、续传和条件请求）以及 R2 词书接口；安装包和词书数据均不进入静态站点产物。

# 变更记录

## 0.4.0 · 2026-09-02

- 新增邮箱验证码（OTP）免密注册与登录系统：接入 Cloudflare D1 存储用户基础信息与临时验证码，通过 Resend 发送验证码邮件，使用 Web Crypto HMAC-SHA256 签发 JWT 会话。
- 桌面客户端会话持久化存储在 `userData/session.json`，未登录时自动唤起登录弹窗，登录后在侧边栏底部展示用户邮箱并提供注销入口；背单词学习进度继续保存在本地 `userData/progress.json`。
- 后端新增 `/api/auth/send-code`、`/api/auth/verify-code` 和 `/api/auth/me` Pages Functions 路由，具备 60 秒重发冷却与 5 次错误尝试防暴力破解机制；本地开发环境内置自动回显模拟发信。

## 0.3.0 · 2026-09-01

- 桌面端更新源改为官网 generic provider：应用启动时读取 `https://cyword.chengyi.me/downloads/latest.yml`，安装器、blockmap 和更新清单都从官网 R2 流式下载；GitHub Release 保留为公开记录和旧版迁移备用入口。
- 推送与 `package.json` 一致的 `v0.3.0` 标签后，GitHub Actions 会先创建 GitHub Release，再把同一次 Windows NSIS 构建按内容哈希写入 R2，最后原子切换 `releases/current.json`，官网无需重新构建即可读取新版本。
- 官网当前发布文件为 `CYword-Setup-0.3.0.exe`，大小 `111773561` 字节，SHA-256 为 `4d319bc53f9903bbb57205db49cbe09d514c99e491c0a61f04027898a1f06b4e`。主下载地址为 `/downloads/latest`，GitHub v0.3.0 是备用地址；两者指向同一份正式构建产物。
- 官网 Pages Functions 新增只读下载协议（HEAD、单段 Range、续传和条件请求）以及 R2 词书接口；安装包和词书数据均不进入静态站点产物。

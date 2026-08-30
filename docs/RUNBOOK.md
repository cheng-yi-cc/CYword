# 运行手册

## 环境与首次启动

推荐 Windows 10/11、Node.js 22 和 npm。进入仓库后执行：

```powershell
npm ci
npm run dev
```

`npm run dev` 会先校验六级规范表并生成 `data/`，随后启动 Vite 和 Electron。修改 CSV 后重新启动即可重新编译；不要直接编辑 `data/`。

## 常用检查

```powershell
npm run data:verify
npm test
npm run build:web
```

预期结果：数据校验报告 19 张表、5166 个唯一单词、0 个孤儿外键；自动测试全部通过；网页构建成功生成 `dist/`。

## 生成 Windows 安装包

```powershell
npm run dist
```

最终文件是 `release/CYword-Setup-<version>.exe`。0.2.0 版未配置代码签名，首次下载或安装时 Windows 可能显示 SmartScreen；发布前如有证书，应在构建环境配置签名，不要把证书或密码写入仓库。

## 标签自动构建

推送形如 `v0.2.0` 的标签会触发 `.github/workflows/build-tag.yml`。Windows runner 会检查标签与 `package.json` 版本一致，执行 `npm ci`、自动测试和 NSIS 打包，然后上传保留 30 天的安装程序构建产物。

```powershell
git tag -a v0.2.0 -m "CYword v0.2.0"
git push origin v0.2.0
```

该流程只生成 GitHub Actions artifact，不自动创建 GitHub Release。需要发布正式 Release 时应另行加入明确的发布步骤和写入权限。

## 选择另一本文书做数据验证

```powershell
$env:CYWORD_BOOK = "cet4"
npm run data:verify
npm run data:build
Remove-Item Env:CYWORD_BOOK
```

默认值始终是 `cet6`。0.2.0 版安装包只携带构建时选中的一本词书。

## 启动故障

- 双击无窗口：优先使用 NSIS 安装包，不再发布旧 portable 版本；查看任务管理器中是否已有单实例正在运行。
- 开发模式不启动：先单独运行 `npm run data:verify`，再检查 Node.js 版本和 `npm ci` 是否成功。
- 界面加载失败：桌面端会弹出错误框；重新运行 `npm run build` 可同时检查 TypeScript、Vite 和数据生成。
- 进度异常：先备份 Electron 用户数据目录中的 `progress.json`，再检查其 `version` 是否为 2。除非用户明确要求，不要删除进度文件。

## 发布前清单

1. `npm ci` 能在干净依赖环境完成。
2. `npm run data:verify`、`npm test`、`npm run build:web` 全部通过。
3. 安装包能安装、启动并读取 5166 词目录。
4. `release/` 只保留需要交付的安装程序；`data/`、`dist/` 和检查截图不提交。

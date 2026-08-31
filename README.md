# CYword

CYword 是一款 Windows 本地背单词应用。它先按真正词根组织单词，再把单词的音标、翻译、巧记、词根词缀积累、构词分析和例句集中展示；学习进度、熟练度和生词本都保存在本机。

0.2.1 版内置大学英语六级词书，包含 5166 个唯一单词。计划按“学习 3 天、集中复习 1 天”循环，共 40 天：30 个学习日、10 个复习日。复习日覆盖此前学过的全部唯一单词，并默认跳过“已掌握”。

Windows 安装程序首次安装时可选择目录；运行新版安装包会默认沿用旧目录并原位升级。桌面应用每次启动会静默检查公开的 GitHub Releases，发现新版后在右上角显示下载按钮，下载完成后由用户点击重启更新。

## 本地预览

建议使用 Node.js 24 LTS，与发布工作流一致。首次运行：

```powershell
npm ci
npm run dev
```

开发窗口会自动打开。桌面安装包由以下命令生成：

```powershell
npm run dist
```

安装程序输出到 `release/CYword-Setup-<version>.exe`。同目录的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，发布时必须一起上传。Windows 可能因安装包未签名而显示 SmartScreen 提示。

## 官网本地预览

官网位于 `website/`，与桌面应用分开运行，面向普通用户提供功能体验、下载和安装指南。已部署到 Cloudflare Pages，正式域名为 <https://cyword.chengyi.me/>。主下载通过同域 `/downloads/` 路径读取 R2 安装包，支持断点续传，GitHub 保留为备用入口。本地预览：

```powershell
npm run dev:site
```

浏览器访问 `http://127.0.0.1:5174/`。不需要启动 Electron，也不需要生成词书数据。页面里的学习体验使用少量独立示例，不会修改桌面端或浏览器版软件的学习进度。

```powershell
npm run build:site
npm run preview:site
```

官网独立构建到 `dist-site/`，构建预览地址为 `http://127.0.0.1:4174/`。下载按钮连接已经发布的 Windows 安装包；下载信息维护在 `website/src/release.ts`。结构、版本维护与检查方式见 [官网说明](docs/WEBSITE.md)。

下载接口测试和官网发布：

```powershell
npm run test:site:download
npm run deploy:site
```

测试只使用本地模拟 R2，不上传测试文件；部署需要已登录 Cloudflare，更新 Pages 的 `main` 生产环境。不要再用纯静态 ZIP 上传，以免漏掉下载函数和 R2 绑定。网站代码提交不会自动部署；桌面应用内更新仍使用 GitHub Releases。

## 校验与测试

```powershell
npm run data:verify
npm test
npm run build:web
```

`data:verify` 校验词书文件集合、每张表的行数、单词外键和六级核心统计；`test` 还会验证排课、累计复习和熟练度逻辑。

## 目录

- `books/cet6/`：六级词书清单和 19 张规范 CSV，是源数据。
- `scripts/`：词书校验与编译、官网下载测试和安装包校验上传脚本。
- `src/`：React 界面、排课与进度逻辑。
- `website/`：独立官网，含交互示例、软件下载、安装指南和常见问题。
- `electron/`：Windows 桌面外壳和本地文件读写。
- `tests/`：自动化测试。
- `data/`、`dist/`、`dist-site/`、`release/`：构建生成物，不提交到 Git。

更多说明见 [词书数据](docs/DATASETS.md)、[架构](docs/ARCHITECTURE.md) 和 [运行手册](docs/RUNBOOK.md)。

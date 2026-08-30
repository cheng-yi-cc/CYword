# CYword

CYword 是一款 Windows 本地背单词应用。它先按真正词根组织单词，再把单词的音标、翻译、巧记、词根词缀积累、构词分析和例句集中展示；学习进度、熟练度和生词本都保存在本机。

0.2.1 版内置大学英语六级词书，包含 5166 个唯一单词。计划按“学习 3 天、集中复习 1 天”循环，共 40 天：30 个学习日、10 个复习日。复习日覆盖此前学过的全部唯一单词，并默认跳过“已掌握”。

Windows 安装程序首次安装时可选择目录；运行新版安装包会默认沿用旧目录并原位升级。桌面应用每次启动会静默检查公开的 GitHub Releases，发现新版后在右上角显示下载按钮，下载完成后由用户点击重启更新。

## 本地预览

建议使用 Node.js 22。首次运行：

```powershell
npm ci
npm run dev
```

开发窗口会自动打开。桌面安装包由以下命令生成：

```powershell
npm run dist
```

安装程序输出到 `release/CYword-Setup-<version>.exe`。同目录的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，发布时必须一起上传。Windows 可能因安装包未签名而显示 SmartScreen 提示。

## 校验与测试

```powershell
npm run data:verify
npm test
npm run build:web
```

`data:verify` 校验词书文件集合、每张表的行数、单词外键和六级核心统计；`test` 还会验证排课、累计复习和熟练度逻辑。

## 目录

- `books/cet6/`：六级词书清单和 19 张规范 CSV，是源数据。
- `scripts/`：词书校验与应用运行时数据编译脚本。
- `src/`：React 界面、排课与进度逻辑。
- `electron/`：Windows 桌面外壳和本地文件读写。
- `tests/`：自动化测试。
- `data/`、`dist/`、`release/`：构建生成物，不提交到 Git。

更多说明见 [词书数据](docs/DATASETS.md)、[架构](docs/ARCHITECTURE.md) 和 [运行手册](docs/RUNBOOK.md)。

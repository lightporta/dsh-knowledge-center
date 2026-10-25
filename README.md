# dsh-knowledge-center

**知识中心 / Knowledge Center** — a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that distills workspace documents into reusable Markdown knowledge, renders it like VS Code in a sidebar panel and Settings, and lets permitted workspaces use it through agent tools.

一个 DeepSeek Harness 插件：阅读工作区文档，用当前默认模型提炼为可复用的 Markdown 知识，在侧边栏面板与 Settings 中以类 VS Code 的样式渲染，并允许被授权的工作区让模型通过工具检索、使用这些知识。

- 中文文档：[跳转](#中文)
- English documentation: [Jump](#english)

> Inspired by the workflow of Qoder / Qoder CN "Knowledge Center", "Knowledge Base", "Repo Wiki" and "Knowledge Cards". This is an independent community implementation; it is not affiliated with, endorsed by, or derived from Qoder, Alibaba or DeepSeek source code. Qoder's knowledge features are closed source.

---

## 中文

本轮可靠性修复与验证：[修复进度](docs/fixes-2026-10-25.md)。Host 更新后需重启 Harness，Client 更新后刷新页面。

### 简介

`dsh-knowledge-center` 面向一个很具体的问题：工作区里散落着需求、设计、规范、流程等 Markdown/TXT 文档，模型每次都要重新读取、重新理解。知识中心把这些文档**一次性提炼**为结构化的知识 Markdown，集中存放在本机知识库中；可以像 VS Code Markdown 预览一样浏览、检索、编辑、导出；在**被明确授权**的工作区里，模型可以主动调用这些知识。插件提供两个入口：左侧栏的**知识图标**（打开整页面板，Qoder 风格）与 **Settings → 知识中心**（同一功能的设置页）。

设计上参考了 Qoder CN 知识中心的交互模型：

| Qoder 知识中心 | 本插件对应实现 |
| --- | --- |
| 知识库（Knowledge Base），源文件可查看渲染后的 Markdown 或 Markdown 源码 | 「知识库」页签：多知识库、条目列表、渲染/源码切换、复制、下载、编辑保存 |
| Repo Wiki / Knowledge Card：从仓库/文档生成结构化 Markdown 知识 | 「生成知识」页签：扫描工作区文档 → 默认模型提炼 → 存入知识库，同一来源重复生成会更新 |
| 按用户 / 工作区作用域使用，Agent 在任务中自动检索 | 「权限与设置」页签：按工作区授权；模型工具 `knowledge_search` / `knowledge_read` / `knowledge_ingest` |
| 入口位于侧边栏「知识中心」 | 侧边栏知识图标（整页面板）+ Settings → 知识中心（设置页）。受 Harness 当前版本限制，Settings 左侧导航图标对第三方分区固定回退为齿轮，因此**带知识图标的入口是侧边栏面板** |

### 功能

- **双入口**
  - 左侧栏知识图标：打开整页「知识中心」面板（自定义书本/知识描边图标，跟随主题与选中态）。
  - Settings → 知识中心：同一套页签 UI 的设置页入口（该处导航图标受 Harness 硬编码限制显示为齿轮，详见 FAQ）。
- **从工作区提炼知识**
  - 扫描工作区中的 Markdown / TXT / CSV / HTML / PDF / Word / Excel / PowerPoint 等文档（完整支持列表见下一节）。
  - 逐篇调用 Harness 当前默认模型，生成结构化知识 Markdown：标题、摘要、核心要点、详细内容、适用场景、来源。
  - 长文档自动分段提炼再合并（最多 16 段，单篇最多约 192k 字符）。
  - 提炼自愈：模型输出被推理 token 占满而截断时，先放大输出预算重试，仍然截断才降级提炼调用的推理强度；因此 `reasoningEffort: max` 下也能产出完整笔记，agent 自身的推理强度不受影响。
  - 同一「工作区 + 来源相对路径」重复生成时**更新原条目**，不会重复创建。
- **知识库管理**
  - 支持多个知识库（Knowledge Base），作用域为「用户」或「工作区」；工作区知识库只在该工作区可用。
  - 条目支持搜索、渲染预览、Markdown 源码查看、复制、下载、在线编辑保存、删除；知识库支持删除（同时删除其条目）。
- **类 VS Code 的 Markdown 渲染**
  - 标题底边线、行内代码、代码块、引用、表格、任务列表、有序/无序列表、链接、分隔线等。
  - 容器、文字、边框、代码块等配色使用 Harness 主题令牌（`--dsw-alias-*`，个别装饰性元素如开关圆点/阴影使用中性色或令牌回退），自动适配明暗主题。
- **库级共享**
  - 共享库可在「权限与设置」中勾选可见的工作区；写入仍只发生在工作区库，共享与撤销只由 owner 操作，并留下 grant/revoke 审计。
- **按工作区授权**
  - 默认**所有工作区均未授权**；模型工具在未授权工作区会明确拒绝。
  - 每个工作区单独开关「允许模型调用」。
- **模型工具与提示词**
  - `knowledge_search` / `knowledge_read` / `knowledge_ingest` / `knowledge_ingest_attachment` 四个工具，带自动工具卡片；附件工具只处理当前会话 attach 的文件，且只能写入当前工作区库。
  - 向模型注入一节系统提示词，说明知识中心能力、权限边界，以及「被拒绝时不要重试、不要绕过」。

### 支持的文档格式

| 类别 | 扩展名 | 提取方式 |
| --- | --- | --- |
| 文本 / 标记 | `.md` `.markdown` `.mdx` `.txt` `.rst` `.csv` `.json` `.html` `.htm` `.xml` `.log` | UTF-8 直读；HTML 会去除脚本/样式并解码实体 |
| Word（现代） | `.docx` | 内置 OOXML 提取（ZIP + XML，Node 内建 zlib，无第三方依赖），保留段落、表格文本 |
| Excel（现代） | `.xlsx` | 内置 OOXML 提取，按工作表输出行文本（共享字符串、数字、布尔） |
| PowerPoint（现代） | `.pptx` | 内置 OOXML 提取，按幻灯片输出文本 |
| PDF | `.pdf` | 优先调用可解析到的 `pdftotext`（可用 `PDFTOTEXT_PATH` 覆盖路径）；否则使用内置 PDF 文本回退解析器（支持 Flate 压缩流与常见 ToUnicode 映射） |
| 旧版 Office | `.doc` `.xls` `.ppt` | 通过 Harness 内置的 LibreOffice `officeToPdf` 服务转为 PDF 后走 PDF 提取 |

说明：

- 文本文件上限 10 MiB，二进制文档上限 25 MiB；提取文本上限 40 万字符，随后仍受提炼预算（12k × 16 ≈ 192k 字符）约束。超出提炼预算的部分不送模型，并在 front matter 中标记 `truncated: true`：10 MiB 级文件可以被接受并提炼预算内的开头部分，而不是整篇逐段精读（那需要数百次模型调用）。
- 各格式提取所需的前置工具与硬性上限见 [docs/EXTRACTION.md](docs/EXTRACTION.md)。
- OOXML/PDF 解压预算为单项 16 MiB、累计 64 MiB；OOXML 忽略未使用的媒体资源。PDF 回退遇到冲突字体映射会明确报错，请使用 pdftotext。
- PDF 只提取**文本层**；扫描件/纯图片 PDF、Word/PPT 中嵌入图片里的文字不在本次范围（需要 OCR）。
- 旧版 `.doc/.xls/.ppt` 依赖 Harness profile 中启用的 `office-to-pdf`（桌面版默认随包提供）；若该服务不可用会给出明确错误。
- 不解析图片、音频、视频；Excel 图表、PPT 备注/图片中的文字不保证提取。

### 界面

插件提供两个入口，内容一致：

1. **左侧栏知识图标 → 整页面板**：自定义知识图标（打开的书本 + 知识星点），页面包含标题区与三个页签。
2. **Settings → 知识中心**：同样的三个页签；受 Harness 0.2.1-rc.3 的限制，Settings 左侧导航图标由内置 shell 按 section id 硬编码，第三方分区回退为齿轮（这是唯一无法由插件自定义的图标位置，见 FAQ）。

三个页签：

| 页签 | 内容 |
| --- | --- |
| 知识库 | 知识库筛选、搜索、新建知识库、条目列表、条目详情（渲染 / Markdown 源码 / 编辑）、复制、下载、删除 |
| 生成知识 | 选择工作区 → 扫描文档 → 勾选 → 选择目标知识库与语言 → 逐篇生成，显示进度与每条结果 |
| 权限与设置 | 每个工作区的模型调用开关、生成语言、默认模型、数据目录、工具名、条目统计 |

Markdown 预览采用与 VS Code Markdown 预览接近的排版：14px 正文、h1/h2 底边线、紧凑行内代码块、灰底代码围栏、表格斑马纹、引用左边框等。

### 环境要求

| 项目 | 要求 |
| --- | --- |
| DeepSeek Harness | 0.2.1-rc.3 及以上（在 Desktop profile 上验证；Web profile 同样适用） |
| Node.js | ≥ 20.3.0（由 Harness Host 进程提供，插件本身无第三方运行时依赖） |
| 操作系统 | macOS / Windows / Linux（见「跨平台支持」） |
| 模型 | 已在 Harness「Settings → 模型」中配置默认模型（提炼时使用 `agentDefaultModel`） |

### 安装

1. 克隆本仓库到任意本地目录：

   ```bash
   git clone https://github.com/<you>/dsh-knowledge-center.git
   ```

2. 在 Harness 会话中安装本地 bundle（推荐，由 Harness 的 Plugin Manager 完成 profile 安装与启用）：

   > 请使用 plugin_manager 的 install_bundle，把本地目录 `/绝对路径/dsh-knowledge-center` 安装到当前 profile。

   也可以在具备相应权限时直接调用 Harness 的 `plugin_manager` 工具：

   ```json
   { "action": "install_bundle", "target": "/absolute/path/to/dsh-knowledge-center" }
   ```

3. 安装完成后，在 **Settings** 左侧会出现 **知识中心**；若页面已打开但未出现，刷新一次 Harness 页面。

> **更新**：替换仓库文件后，`client.js` 的改动通常刷新页面即可生效；Host 代码（`index.js` / `lib/`）的改动请**重启 Harness**。Plugin Manager 中禁用再启用可在开发期临时重载，但按 Harness 官方语义，替换已安装包需要重启才能加载新的 JS 模块代际。
>
> **卸载**：在 Plugin Manager 中移除 `dsh-knowledge-center` bundle。知识数据不会被自动删除；如需彻底清理，请删除 `$DSH_HOME/knowledge-center/`（macOS/Linux 通常是 `~/.dsh/knowledge-center/`，Windows 通常是 `%USERPROFILE%\.dsh\knowledge-center\`）。

### 使用

1. 点击左侧栏的**知识图标**打开整页知识中心（或打开 **Settings → 知识中心**）。
2. 选择工作区，点击「扫描文档」，勾选需要提炼的文档，选择目标知识库与生成语言（简体中文 / English），点击「生成知识」。生成由默认模型逐篇完成，耗时取决于文档长度。
3. 切换到「知识库」页签浏览结果：点击条目查看渲染效果；可切换 Markdown 源码、复制、下载、编辑保存或删除。
4. 切换到「权限与设置」，为需要使用知识的工作区打开「允许模型调用」。
5. 在该工作区的会话中直接向模型提问，例如：

   > 请先检索知识中心里关于发布流程的笔记，再按其中的清单检查这次改动。

   模型会调用 `knowledge_search` 找到条目、用 `knowledge_read` 读取全文，并基于知识回答；只有被授权的工作区才能这样做。

### 模型工具

| 工具 | 用途 | 参数 | 权限 |
| --- | --- | --- | --- |
| `knowledge_search` | 检索知识：标题、摘要、来源、正文关键词；返回 id、标题、知识库、摘要、片段与可访问知识库列表 | `query`（可空，空则返回最近更新）、`limit`（1–50，默认 8）、`collectionId`（可选） | 需授权工作区 |
| `knowledge_read` | 读取一篇完整知识 Markdown | `id` | 需授权工作区 |
| `knowledge_ingest` | 在用户明确要求时，把工作区文档提炼进知识库（每次最多 3 个路径） | `paths`（工作区相对路径数组）、`collectionId`（可选）、`language`（`zh` / `en`） | 需授权工作区 |

模型只能在被授权工作区访问该工作区可见的知识：用户作用域知识库 + 该工作区作用域知识库。工具在未授权工作区会返回明确的权限提示，不会返回任何知识内容。

### 数据与 Markdown 格式

数据存放在 Harness 的**用户级**数据目录下（`$DSH_HOME`，同一台机器的所有 profile 共享；如需隔离可自行设置 `DSH_HOME`）：

```
$DSH_HOME/knowledge-center/
├── index.json          # 知识库、条目元数据、工作区授权、设置
└── entries/<uuid>.md   # 单篇知识：YAML front matter + Markdown 正文
```

单篇知识示例：

```markdown
---
id: "3f0c…"
title: "发布流程"
collectionId: "…"
collection: "项目知识库"
sources: ["docs/release.md"]
tags: []
summary: "发布前需要完成的检查项与审批流程。"
language: "zh"
createdAt: 1760000000000
updatedAt: 1760000000000
generator: "provider/model"
---

# 发布流程

> 一句话摘要。

## 核心要点
- …

## 详细内容
- …

## 适用场景
- …

## 来源
- `docs/release.md`
```

知识文件是纯 Markdown，可独立阅读、直接提交到 Git 共享，或交给其他工具处理。front matter **不包含机器绝对路径**：工作区路径只保存在本机 `index.json`，`sources` 使用工作区相对路径（统一为正斜杠；Windows/macOS 上按大小写不敏感去重），因此知识文件可安全地提交或分享。`index.json` 保存索引与权限，每次更新前会原子保存上一份有效索引至 `index.json.bak`。主索引缺失或损坏时会尝试恢复备份，并关闭全部工作区授权、显示恢复提示；备份可能早于最近一次操作。无法恢复且已有数据时会报错保留文件，不会静默重置为空库。此备份不包含知识正文，也不替代完整数据目录备份或版本历史。

### 权限与安全

- **RPC 仅本机 owner**：Settings 页面通过 Harness 浏览器连接调用 `POST /knowledge-center/<method>`；Host 使用 Harness 的连接鉴权（浏览器 Cookie / owner Peer）校验，未认证请求返回 401，非 owner 返回 403。
- **库级共享**
  - 共享库可在「权限与设置」中勾选可见的工作区；写入仍只发生在工作区库，共享与撤销只由 owner 操作，并留下 grant/revoke 审计。
- **按工作区授权**：默认全部关闭；模型工具只读取「用户作用域 + 当前工作区作用域」的知识。会话子目录归属最具体的已注册工作区，单独注册的嵌套工作区需独立授权，不继承父工作区的授权或专属知识库。
- **数据不离开本机**：知识文件只写入 `$DSH_HOME`，插件不包含任何云同步、遥测或外部上传逻辑；提炼调用的是用户在 Harness 中配置的模型服务。
- **不要把凭证、个人隐私、未授权共享的内容放进工作区文档或知识库**。知识文件以明文保存。
- 插件不存储 API Key；模型凭证完全由 Harness 自身管理。

### 架构

```text
浏览器侧 (client.js)                          Host 侧 (index.js)
┌─────────────────────────────┐              ┌──────────────────────────────────────┐
│ 侧边栏知识图标 / Settings 页 │  RPC (POST)  │ /knowledge-center/<method>           │
│ 三页签 UI + Markdown 渲染器  │ ───────────▶ │ owner 鉴权 → API 方法                 │
│ 通过 ctx.connection.rpc.call │ ◀─────────── │ 知识库存储 / 文档扫描 / LLM 提炼       │
└─────────────────────────────┘              │ Agent 工具 / 系统提示词               │
                                             └──────────────────────────────────────┘
                                                              │
                                                              ▼
                                             $DSH_HOME/knowledge-center/
                                             ├── index.json
                                             └── entries/<uuid>.md
```

- **Host 半**（`index.js` + `lib/paths.js` + `lib/text.js`）：知识库存储（JSON 索引 + Markdown 文件、原子写）、工作区文档扫描（通过 Harness 组合文件系统）、LLM 提炼流水线（单篇直出 / 长文 map-reduce，字符预算 192k）、权限判断、RPC 路由、模型工具与系统提示词。零第三方运行时依赖。
- **Client 半**（`client.js`）：一个浏览器 Cordis 插件，注册三个槽位——`sidebar.panellist`（左侧栏知识图标）、`main`（整页知识中心面板）与 `settings.section`（Settings 设置页）；自研 Markdown→React 渲染器；配色以 Harness 主题令牌为主（装饰性元素使用令牌回退）；通过 `ctx.connection.rpc.call` 调用 Host。
- **提炼流水线**：读取文档 →（长文档）分片提炼要点 → 合并为结构化知识 Markdown → 写入 front matter + 索引；同一来源按（工作区, 相对路径）更新已有条目。
- **工具注册**：`knowledge_search` / `knowledge_read` / `knowledge_ingest` 注册在 Harness Tool Registry，提示词章节说明能力与权限边界。

### 跨平台支持

插件不依赖任何 macOS 专有 API，Host 代码运行在 Harness 的 Node.js Host 进程中：

| 平台 | 支持 | 说明 |
| --- | --- | --- |
| macOS | ✅ | 已在本机完成端到端验证（安装、提炼、检索、RPC、Settings 注册） |
| Windows | ✅（设计目标） | 路径使用 `node:path` 的 win32 规则：盘符 / UNC 根、`\` 分隔符、大小写不敏感比较；数据目录由 `DSH_HOME` 或 `os.homedir()` 决定。CI 在 windows-latest 上运行语法与包清单检查；尚未在真机 Windows 上做完整 UI 端到端验证 |
| Linux | ✅（设计目标） | POSIX 路径规则与 macOS 相同；CI 在 ubuntu-latest 上运行语法与包清单检查；尚未在真机 Linux 上做完整 UI 端到端验证 |

跨平台逻辑集中在 `lib/paths.js`（`canonicalPath` / `comparisonKey` / `isSameOrInside` / `normalizeSourcePath` / `sourceKey` / `resolveDshHome`），并已按 `win32`、`darwin` 与 POSIX 规则分别验证（v1.2.0 前由随仓库测试覆盖）：Windows/macOS 按大小写不敏感比较，Linux 保持大小写敏感；来源路径统一为正斜杠后再去重。

### 已知限制

- 提取为尽力而为：PDF 只提取文本层（扫描件需 OCR）；旧版 Office 需要 LibreOffice 服务；复杂版式（分栏、表格合并、图表）只保留文本顺序，不保留视觉布局。损坏或上传不完整的 OOXML（无 ZIP 中央目录）会明确报错，需重新导出后再试。
- 检索为本地关键词 + 摘要匹配，**没有向量嵌入**；适合数百篇规模，不适合大规模语义检索。
- 提炼质量与速度取决于 Harness 中配置的默认模型；单篇超长文档只提炼前约 192k 字符，会在 front matter 中标记 `truncated: true`。
- 本机共享存储使用跨进程锁保护索引读改写，可协调同机多个 profile；不支持多人协作 / 云同步 / 知识正文版本历史。仅对确认退出的本机持锁进程自动回收锁，无法验证时超时并报错。
- Harness 0.2.1-rc.3 的 Settings 导航图标由内置 shell 硬编码，第三方 Settings 分区统一回退为齿轮；插件改用受支持的侧边栏知识图标作为主入口（见 FAQ）。
- 尚未包含自动化 UI 视觉回归测试；Windows/Linux 的 UI 端到端验证待补。

### 开发

```text
dsh-knowledge-center/
├── index.js                 # Host 半：存储、扫描、提炼、工具、RPC 路由
├── lib/paths.js             # 跨平台路径工具（POSIX / win32）
├── lib/text.js              # 提炼分片的字符预算
├── lib/extract.js           # 文档文本提取（DOCX/XLSX/PPTX/PDF/HTML 等）
├── client.js                # Client 半：侧边栏图标 + 整页面板 + Settings 页 + Markdown 渲染器
├── cordis.patch.yml         # DSH bundle patch（插入 Host row；Cordis = Harness 插件框架，与 Qoder 无关）
├── locale/                  # 插件清单显示标题/描述（en / zh）
├── scripts/                # 跨平台测试与语法检查入口
├── docs/VERIFICATION.md    # 验证方法、结果和边界
├── .github/workflows/ci.yml # 三平台 CI（语法 + JSON + 单测）
├── README.md
└── LICENSE
```

```bash
# 无构建步骤、无第三方运行时依赖
node --check index.js
node --check client.js
node --check lib/paths.js
node --check lib/text.js
node --check lib/extract.js
npm run check     # 语法检查合集
```

本地开发提示：

- 使用 Harness `plugin_manager` 的 `install_bundle` 把本目录安装到当前 profile；Host 代码（`index.js` / `lib/`）改动后请**重启 Harness**。Plugin Manager 的禁用/启用可作为开发期临时重载手段，实际行为以当前 Harness 版本为准。
- `client.js` 的变化会由页面侧 client HMR 轮询尝试热重载（是否即时取决于 Harness 版本与页面状态）；如未生效，刷新页面。
- 不修改用户 profile 的 `package.json`/`cordis.patch.yml` 进行手工安装；交给 Plugin Manager 管理。

### 测试与验证

测试是**本地资产**：`test/` 已在 `.gitignore` 中忽略，用例清单、运行方式与最近结果统一记录在 [test.md](test.md)；CI 执行 `npm run check`（语法 + 包清单/本地化校验）。发布前可用 `npm pack --dry-run` 核对文件清单。

测试方法、结果、已归档项目与尚未验证的范围统一记录在 [验证记录](docs/VERIFICATION.md)。

### 常见问题（FAQ）

**问：仓库里的 `cordis.patch.yml` 是 Qoder 的文件吗？**
不是。Cordis（`@deepseek-ai/cordis`）是 DeepSeek Harness 的插件框架；`cordis.patch.yml` 是 DSH 的 **bundle patch**，声明安装时要插入的 Host row（`id: knowledge-center` / `name: dsh-knowledge-center`），是插件安装与激活的必需文件。本仓库不包含任何 Qoder 代码。

**问：为什么 Settings 里「知识中心」前面的图标还是齿轮？**
Harness 0.2.1-rc.3 的 Settings 导航图标由内置 shell 按 section id 硬编码（`account`/`models`/`plugins`/`agent-presets`/`archived-sessions`），第三方 Settings 分区没有自定义 icon API，统一回退为齿轮。因此插件把定制的知识图标放在官方支持的**侧边栏面板入口**上；若未来 Harness 暴露 Settings section icon 字段，会切换过去。

**问：仓库里为什么没有测试文件了？**
v1.2.0 发布前在本机连续 3 轮 113/113 通过后，按要求移除了测试目录；`npm run check` 仍做语法与包清单/本地化校验，验证记录见 [验证记录](docs/VERIFICATION.md)。

**问：知识文件里会不会包含我的绝对路径？**
不会。front matter 不含 workspace 绝对路径，`sources` 是工作区相对路径；绝对路径只保存在本机 `index.json`。

**问：数据会被其他 profile 看到吗？**
会。数据位于用户级 `$DSH_HOME/knowledge-center`，同机所有 DSH profile 共享；需要隔离时可为 Harness 设置独立的 `DSH_HOME`。

### 致谢与参考

- 交互灵感：[Qoder Knowledge Base](https://docs.qoder.com/qoder/knowledge-base.md)、[Qoder Repo Wiki](https://docs.qoder.com/qoder/repo-wiki.md)、[Knowledge Card](https://docs.qoder.com/user-guide/knowledge-engine/knowledge-cards.md)。
- 同类开源思路：[llm-wiki](https://github.com/owenliang/llm-wiki)（Qoder Skill 形式的文档→知识 wiki，许可未声明，仅设计参考）、[deepwiki-open](https://github.com/AsyncFuncAI/deepwiki-open)（MIT）、[basic-memory](https://github.com/basicmachines-co/basic-memory)（AGPL-3.0）。
- 本仓库代码为独立实现，MIT 许可。

### 许可证

[MIT](LICENSE) © 2026 dsh-knowledge-center contributors

---

## English

Reliability changes and verification: [repair log](docs/fixes-2026-10-25.md). Restart Harness after Host changes and refresh the page after Client changes.

### Overview

`dsh-knowledge-center` solves a focused problem: requirements, designs, conventions and procedures are scattered across workspace documents, and a model re-reads and re-interprets them on every task. Knowledge Center distills those documents **once** into structured knowledge Markdown, keeps it in a local library, lets you browse, search, edit and export it with a VS Code-like Markdown preview, and lets **explicitly permitted** workspaces use it through agent tools. The plugin has two entry points: the **sidebar knowledge icon** (opens a full-page panel, Qoder-style) and **Settings → Knowledge Center** (the same UI as a settings page).

The interaction model is inspired by Qoder CN's knowledge features:

| Qoder Knowledge Center | This plugin |
| --- | --- |
| Knowledge Base with source files previewable as rendered Markdown or Markdown source | "Knowledge Base" tab: multiple libraries, entry list, rendered/source toggle, copy, download, edit and save |
| Repo Wiki / Knowledge Cards distilled from repositories and documents | "Generate" tab: scan workspace documents → distill with the default model → store into a library; re-generating a source updates the same entry |
| User / workspace scoped usage; the agent retrieves knowledge during tasks | "Access & Settings" tab: per-workspace grants; `knowledge_search` / `knowledge_read` / `knowledge_ingest` tools |
| Entry point in the sidebar "Knowledge Center" | Sidebar knowledge icon (full-page panel) + Settings → Knowledge Center. Harness 0.2.1-rc.3 hardcodes Settings nav icons and falls back to a gear for third-party sections, so the **custom knowledge icon lives on the supported sidebar panel entry** |

### Features

- **Two entry points**
  - Sidebar knowledge icon: opens the full-page Knowledge Center panel (custom open-book + spark outline glyph that follows the theme and selection state).
  - Settings → Knowledge Center: the same tabbed UI as a settings page (that nav icon is the Harness fallback gear; see FAQ).
- **Distill workspace documents**
  - Scans workspace documents including Markdown, TXT, CSV, HTML, PDF, Word, Excel and PowerPoint (full list in the next section).
  - Uses the Harness default model to produce a structured knowledge note: title, summary, key points, details, when to use it, sources.
  - Long documents are distilled in chunks and merged (up to 16 chunks, roughly 192k characters per document).
- Self-healing distillation: when a note is truncated because reasoning tokens consumed the output budget, the call is retried with a larger budget and only then with a bounded reasoning effort, so `reasoningEffort: max` still produces a complete note without changing the agent's own effort.
  - Re-generating the same workspace-relative source **updates** the existing note instead of duplicating it.
- **Knowledge library management**
  - Multiple knowledge bases with `user` or `workspace` scope; workspace-scoped libraries are only visible inside that workspace.
  - Entries support search, rendered preview, Markdown source view, copy, download, in-place edit and delete; libraries can be deleted (with their entries).
- **VS Code-like Markdown rendering**
  - Heading underlines, inline code, fenced code, quotes, tables, task lists, ordered/unordered lists, links, horizontal rules.
  - Container, text, border and code colors come from Harness theme tokens (`--dsw-alias-*`, with token fallbacks for a few decorative elements such as the switch knob/shadow), so light and dark themes work automatically.
- **Library-level sharing**
  - A shared library can be granted to selected workspaces in Access & Settings; writes still happen in the workspace library, and sharing/revocation are owner-only with a grant/revoke audit.
- **Per-workspace access control**
  - Every workspace is **denied by default**; model tools refuse to run without a grant.
  - One toggle per workspace ("Allow model access").
- **Model tools and prompt section**
  - `knowledge_search`, `knowledge_read`, `knowledge_ingest`, `knowledge_ingest_attachment`, each with a tool call card. The attachment tool only accepts files attached to the current conversation and writes to the current workspace library.
  - A system-prompt section explains the capability and the permission boundary, including "do not retry or bypass when access is denied".

### Supported document formats

| Category | Extensions | Extraction |
| --- | --- | --- |
| Text / markup | `.md` `.markdown` `.mdx` `.txt` `.rst` `.csv` `.json` `.html` `.htm` `.xml` `.log` | UTF-8 read; HTML drops scripts/styles and decodes entities |
| Word (modern) | `.docx` | Built-in OOXML extraction (ZIP + XML through Node's zlib, no third-party dependency); keeps paragraph and table text |
| Excel (modern) | `.xlsx` | Built-in OOXML extraction; one line per worksheet row (shared strings, numbers, booleans) |
| PowerPoint (modern) | `.pptx` | Built-in OOXML extraction; one section per slide |
| PDF | `.pdf` | Prefers a resolvable `pdftotext` binary (`PDFTOTEXT_PATH` overrides the path); otherwise a built-in fallback parser (Flate streams, common ToUnicode maps) |
| Legacy Office | `.doc` `.xls` `.ppt` | Converted to PDF by the Harness LibreOffice `officeToPdf` service, then extracted through the PDF pipeline |

Notes:

- Text documents are capped at 10 MiB and binary documents at 25 MiB; extracted text is capped at 400k characters and then bounded by the distillation budget (12k × 16 ≈ 192k characters). Content beyond the budget is not sent to the model and is marked `truncated: true` in the front matter: a 10 MiB file is accepted and distilled from the first part of the budget instead of being read end to end (which would need hundreds of model calls).
- Per-format extractor prerequisites and hard limits are listed in [docs/EXTRACTION.md](docs/EXTRACTION.md).
- OOXML/PDF decompression is capped at 16 MiB per entry/stream and 64 MiB in total. Unused OOXML media is skipped. Conflicting font mappings in the PDF fallback produce a clear error; use pdftotext for those files.
- PDF extraction reads the **text layer** only; scanned/image-only PDFs and text inside embedded images (Word/PPT) need OCR and are out of scope.
- Legacy `.doc/.xls/.ppt` require the `office-to-pdf` service enabled in the Harness profile (shipped with Desktop); a clear error is returned when it is unavailable.
- Images, audio and video are not parsed; Excel charts and text inside PPT notes/images are not guaranteed to be extracted.

### UI

The plugin contributes two entry points with the same content:

1. **Sidebar knowledge icon → full-page panel**: custom knowledge glyph (open book + knowledge spark), a heading area and three tabs.
2. **Settings → Knowledge Center**: the same three tabs. Harness 0.2.1-rc.3 hardcodes Settings nav icons by section id and falls back to a gear for third-party sections (the only icon slot a plugin cannot customize; see FAQ).

The three tabs:

| Tab | Contents |
| --- | --- |
| Knowledge Base | Library filter, search, create library, entry list, entry detail (rendered / Markdown source / editor), copy, download, delete |
| Generate | Pick workspace → scan documents → select → choose target library and language → distill one by one with progress and per-file results |
| Access & Settings | Per-workspace model-access switch, output language, default model, data directory, tool names, library statistics |

The preview closely follows VS Code's Markdown preview: 14px body text, underlined `h1`/`h2`, compact inline-code chips, muted fenced code blocks, zebra-striped tables and a left border on blockquotes.

### Requirements

| Item | Requirement |
| --- | --- |
| DeepSeek Harness | 0.2.1-rc.3 or newer (verified on a Desktop profile; the Web profile works the same way) |
| Node.js | ≥ 20.3.0, provided by the Harness Host process (the plugin has no third-party runtime dependencies) |
| OS | macOS / Windows / Linux (see "Cross-platform") |
| Model | A default model configured in Harness "Settings → Models" (`agentDefaultModel` is used for distillation) |

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/<you>/dsh-knowledge-center.git
   ```

2. Install the local bundle in a Harness session (recommended; the Plugin Manager owns profile installation and enabling):

   > Use plugin_manager install_bundle to install the local directory `/absolute/path/to/dsh-knowledge-center` into the current profile.

   Or, with sufficient permissions, call the Harness `plugin_manager` tool directly:

   ```json
   { "action": "install_bundle", "target": "/absolute/path/to/dsh-knowledge-center" }
   ```

3. The **sidebar** then shows the Knowledge Center icon (and **Settings** shows the Knowledge Center page). If the page was already open, refresh it once.

> **Upgrade**: after replacing the repository files, refresh the page for `client.js` changes; for Host changes (`index.js` / `lib/`) **restart Harness**. Disabling/enabling the plugin in Plugin Manager can temporarily reload during development, but per the Harness plugin contract a replaced installed package needs a restart to load a fresh JS module generation.
>
> **Uninstall**: remove the `dsh-knowledge-center` bundle in Plugin Manager. Knowledge data is not deleted automatically; remove `$DSH_HOME/knowledge-center/` (`~/.dsh/knowledge-center/` on macOS/Linux, `%USERPROFILE%\.dsh\knowledge-center\` on Windows) to purge it.

### Usage

1. Click the **knowledge icon in the sidebar** to open the full-page Knowledge Center (or open **Settings → Knowledge Center**).
2. Choose a workspace, click **Scan documents**, select files, choose the target library and language (简体中文 / English), then click **Generate**. The default model distills each document; duration depends on document length.
3. Open the **Knowledge Base** tab to browse the results: click an entry for the rendered preview, switch to Markdown source, copy, download, edit or delete.
4. Open **Access & Settings** and enable **Allow model access** for the workspaces that should use this knowledge.
5. In a session of that workspace, ask the model to use the knowledge, for example:

   > Search the Knowledge Center for our release process notes, then check this change against that checklist.

   The model calls `knowledge_search` to find entries and `knowledge_read` for the full note — only in granted workspaces.

### Model tools

| Tool | Purpose | Parameters | Permission |
| --- | --- | --- | --- |
| `knowledge_search` | Search knowledge by title, summary, source and body keywords; returns ids, titles, library, summary, snippet and the accessible library list | `query` (may be empty → newest notes), `limit` (1–50, default 8), `collectionId` (optional) | Granted workspace required |
| `knowledge_read` | Read one full knowledge Markdown note | `id` | Granted workspace required |
| `knowledge_ingest` | Distill workspace documents into the library when the user explicitly asks (max 3 paths per call) | `paths` (workspace-relative array), `collectionId` (optional), `language` (`zh` / `en`) | Granted workspace required |

A model can only access knowledge visible to the calling workspace: user-scoped libraries plus that workspace's libraries. Outside a grant, tools fail with an explicit permission message and return no knowledge content.

### Data and Markdown format

Data lives under the Harness **user-level** data directory (`$DSH_HOME`, shared by every profile on the machine; set `DSH_HOME` if you want isolation):

```
$DSH_HOME/knowledge-center/
├── index.json          # libraries, entry metadata, workspace grants, settings
└── entries/<uuid>.md   # one knowledge note: YAML front matter + Markdown body
```

Example note:

```markdown
---
id: "3f0c…"
title: "Release Process"
collectionId: "…"
collection: "Project Knowledge"
sources: ["docs/release.md"]
tags: []
summary: "Pre-release checks and the approval flow."
language: "en"
createdAt: 1760000000000
updatedAt: 1760000000000
generator: "provider/model"
---

# Release Process

> One-sentence summary.

## Key points
- …

## Details
- …

## When to use it
- …

## Sources
- `docs/release.md`
```

Knowledge files are plain Markdown: readable on their own, committable to Git, or consumable by other tools. The front matter **contains no machine-absolute paths**: the workspace path stays in the local `index.json`, while `sources` holds workspace-relative paths with forward slashes (deduplicated case-insensitively on Windows/macOS). Notes are therefore safe to commit or share. `index.json` stores the index and permissions; each update atomically preserves the previous valid index as `index.json.bak`. A missing or damaged primary can recover from that backup, disabling all workspace grants and showing a recovery notice. The backup may predate recent operations. Unrecoverable existing data is preserved with an error instead of silently resetting the library. This index backup does not include note bodies and does not replace a full-directory backup or revision history.

### Permissions and security

- **Owner-only RPC**: the Settings page calls `POST /knowledge-center/<method>` over the Harness browser connection; the Host validates it with Harness connection authentication (browser Cookie / owner Peer). Unauthenticated requests get 401, non-owner requests 403.
- **Per-workspace grants**: denied by default; model tools only read knowledge in the user scope plus the current workspace scope. Sessions in subdirectories belong to the most specific registered workspace. Separately registered nested workspaces require independent grants and do not inherit parent workspace libraries.
- **Data stays local**: knowledge files are written only under `$DSH_HOME`; the plugin contains no cloud sync, telemetry or external upload logic. Distillation uses the model service configured in Harness.
- **Never ingest credentials, personal data or content you are not allowed to share.** Knowledge files are stored in plaintext.
- The plugin stores no API keys; model credentials remain owned by Harness.

### Architecture

```text
Browser (client.js)                          Host (index.js)
┌─────────────────────────────┐              ┌──────────────────────────────────────┐
│ Sidebar icon / Settings page│  RPC (POST)  │ /knowledge-center/<method>           │
│ 3-tab UI + Markdown renderer│ ───────────▶ │ owner auth → API methods              │
│ ctx.connection.rpc.call     │ ◀─────────── │ library storage / scan / LLM distill  │
└─────────────────────────────┘              │ agent tools / system prompt           │
                                             └──────────────────────────────────────┘
                                                              │
                                                              ▼
                                             $DSH_HOME/knowledge-center/
                                             ├── index.json
                                             └── entries/<uuid>.md
```

- **Host half** (`index.js` + `lib/paths.js` + `lib/text.js`): library storage (JSON index + Markdown files, atomic writes), workspace document scanning through the composed Harness filesystem, LLM distillation (single-shot or map-reduce for long documents, 192k-character budget), permission checks, RPC route, agent tools and the system-prompt section. Zero third-party runtime dependencies.
- **Client half** (`client.js`): a browser Cordis plugin registering three slots — `sidebar.panellist` (sidebar knowledge icon), `main` (full-page Knowledge Center panel) and `settings.section` (Settings page); a self-contained Markdown-to-React renderer; theme-token-driven colors (with token fallbacks for decorative elements); Host calls through `ctx.connection.rpc.call`.
- **Distillation pipeline**: read document → (for long documents) distill chunk notes → merge into one structured Markdown note → write front matter + index; re-ingesting the same (workspace, relative path) updates the existing entry.
- **Tool registration**: `knowledge_search`, `knowledge_read`, `knowledge_ingest` register in the Harness Tool Registry; the prompt section explains the capability and permission boundary.

### Cross-platform

The plugin uses no macOS-specific API; the Host half runs in Harness's Node.js Host process:

| Platform | Support | Notes |
| --- | --- | --- |
| macOS | ✅ | End-to-end verified locally (install, distillation, retrieval, RPC, Settings registration) |
| Windows | ✅ (design target) | Paths use `node:path` win32 rules: drive/UNC roots, `\` separators, case-insensitive comparisons; the data directory comes from `DSH_HOME` or `os.homedir()`. CI runs syntax and manifest checks on windows-latest; full UI end-to-end verification on a real Windows machine is still pending |
| Linux | ✅ (design target) | POSIX path rules, identical to macOS; CI runs syntax and manifest checks on ubuntu-latest; full UI end-to-end verification on a real Linux machine is still pending |

All platform-sensitive logic is centralized in `lib/paths.js` (`canonicalPath`, `comparisonKey`, `isSameOrInside`, `normalizeSourcePath`, `sourceKey`, `resolveDshHome`) and validated for `win32`, `darwin` and POSIX rules explicitly (covered by the shipped tests before v1.2.0): Windows/macOS compare case-insensitively, Linux stays case-sensitive, and source paths are normalized to forward slashes before deduplication.

### Known limitations

- Extraction is best-effort: PDF reads the text layer only (scanned documents need OCR); legacy Office requires the LibreOffice service; complex layouts keep text order but not visual structure. Corrupted or incompletely uploaded OOXML (no ZIP central directory) fails with a clear error and must be re-exported.
- Retrieval is local keyword/summary matching with **no vector embeddings**; suitable for hundreds of notes, not for large-scale semantic search.
- Distillation quality and speed depend on the configured default model; very long documents are distilled from roughly the first 192k characters and marked `truncated: true` in the front matter.
- Local shared storage uses a cross-process lock for index updates across profiles on the same machine. No team collaboration, cloud sync or note-body revision history. Lock recovery requires a confirmed exited local owner; an unverifiable owner causes a timeout instead of stealing the lock.
- Harness 0.2.1-rc.3 hardcodes Settings nav icons; third-party Settings sections fall back to a gear, so the plugin uses the supported sidebar knowledge icon as its primary entry (see FAQ).
- No automated UI visual regression tests yet; Windows/Linux UI end-to-end verification is pending.

### Development

```text
dsh-knowledge-center/
├── index.js                 # Host half: storage, scanning, distillation, tools, RPC route
├── lib/paths.js             # cross-platform path helpers (POSIX / win32)
├── lib/text.js              # distillation chunk character budget
├── lib/extract.js           # document text extraction (DOCX/XLSX/PPTX/PDF/HTML, …)
├── client.js                # Client half: sidebar icon + full-page panel + Settings page + Markdown renderer
├── cordis.patch.yml         # DSH bundle patch (inserts the Host row; Cordis is Harness's plugin framework, unrelated to Qoder)
├── locale/                  # plugin inventory title/description (en / zh)
├── scripts/                # cross-platform test and syntax-check entry points
├── docs/VERIFICATION.md    # verification methods, results and limits
├── .github/workflows/ci.yml # three-platform CI (syntax + JSON + tests)
├── README.md
└── LICENSE
```

```bash
# No build step, no third-party runtime dependencies.
node --check index.js
node --check client.js
node --check lib/paths.js
node --check lib/text.js
node --check lib/extract.js
npm run check     # aggregated syntax checks
```

Development notes:

- Install this directory with Harness `plugin_manager` `install_bundle`. After Host code changes (`index.js` / `lib/`), **restart Harness**; disabling/enabling the plugin can temporarily reload during development, subject to the current Harness version.
- `client.js` changes are picked up by page-side client HMR polling and hot-reloaded when the version/page state allows; refresh the page if necessary.
- Do not hand-edit the user profile's `package.json` / `cordis.patch.yml` to install; let Plugin Manager own installation.

### Testing and verification

Tests are **local assets**: `test/` is git-ignored, and the inventory, how to run it and the latest results live in [test.md](test.md). CI runs `npm run check` (syntax, manifest and locale checks). Use `npm pack --dry-run` to inspect the release inventory.

Methods, results, archived checks and verification limits are recorded in the [verification log](docs/VERIFICATION.md).

### FAQ

**Q: Is `cordis.patch.yml` a Qoder file?**
No. Cordis (`@deepseek-ai/cordis`) is DeepSeek Harness's plugin framework; `cordis.patch.yml` is a DSH **bundle patch** that declares the Host row to insert (`id: knowledge-center` / `name: dsh-knowledge-center`). It is required for installation and activation. This repository contains no Qoder code.

**Q: Why is the Settings nav icon for Knowledge Center still a gear?**
Harness 0.2.1-rc.3 hardcodes Settings nav icons by section id (`account`/`models`/`plugins`/`agent-presets`/`archived-sessions`); third-party Settings sections have no icon API and fall back to a gear. The plugin therefore places its custom knowledge icon on the officially supported **sidebar panel entry**; if a future Harness exposes a Settings section icon field, we will switch.

**Q: Why are there no test files anymore?**
The suite passed 113/113 three times in a row before v1.2.0 and was then removed as requested; `npm run check` still validates syntax, manifest and locales, and the [verification log](docs/VERIFICATION.md) keeps the evidence.

**Q: Do knowledge files contain my absolute paths?**
No. The front matter has no absolute workspace path; `sources` are workspace-relative. Absolute paths stay in the local `index.json`.

**Q: Will other profiles on this machine see the data?**
Yes. Data lives in the user-level `$DSH_HOME/knowledge-center`, shared by every DSH profile; set a separate `DSH_HOME` if you need isolation.

### Acknowledgements

- Interaction inspiration: [Qoder Knowledge Base](https://docs.qoder.com/qoder/knowledge-base.md), [Qoder Repo Wiki](https://docs.qoder.com/qoder/repo-wiki.md), [Knowledge Card](https://docs.qoder.com/user-guide/knowledge-engine/knowledge-cards.md).
- Related open-source ideas: [llm-wiki](https://github.com/owenliang/llm-wiki) (a Qoder Skill that distills documents into a wiki; no declared license, design reference only), [deepwiki-open](https://github.com/AsyncFuncAI/deepwiki-open) (MIT), [basic-memory](https://github.com/basicmachines-co/basic-memory) (AGPL-3.0).
- This repository is an independent implementation under the MIT license.

### License

[MIT](LICENSE) © 2026 dsh-knowledge-center contributors

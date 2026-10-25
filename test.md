# 测试记录（本地资产）

本文件记录 dsh-knowledge-center 的测试策略、用例清单与最近结果。测试代码是**本地资产**：`test/` 已在 `.gitignore` 中忽略，不随仓库或 npm 包发布；结果统一写在这里。

## 策略

- 行为测试只在开发机本地运行，避免把本机绝对路径、临时数据和调试细节带进发布物。
- 发布门槛：`npm run check`（语法 + 包清单/本地化校验）由 CI 在 macOS / Ubuntu / Windows 三平台执行；行为测试在本地执行并在本文件留档。
- 测试使用真实临时目录、真实子进程与真实临时知识库，不读取也不写入真实知识库。

## 怎么跑

```powershell
$files = Get-ChildItem test -Filter '*.test.mjs' | ForEach-Object { $_.FullName }
node --test $files
```

## 当前用例（117 项）

| 文件 | 覆盖 | 用例数 |
| --- | --- | --- |
| `test/client-behavior.test.mjs` | 详情串页误删、旧响应与错误、编辑草稿、扫描与搜索竞态、共享刷新、恢复提示、键盘操作 | 21 |
| `test/extract.test.mjs` | DOCX/XLSX/PPTX/HTML/PDF 提取、解压预算、取消传播 | 27 |
| `test/host.test.mjs` | RPC、授权、生成、检索、预算阶梯与 max 兜底、截断回执、v1.3 版本门/迁移/S1 收口、**v1.4 会话附件提炼** | 21 |
| `test/lock.test.mjs` | 同进程与真实子进程互斥、锁释放、崩溃回收、Windows 注入回归 | 15 |
| `test/manifest.test.mjs` | 包入口、发布文件、bundle、locale、许可证一致性 | 6 |
| `test/paths.test.mjs` | win32/darwin/POSIX 路径规则、工作区边界、来源身份 | 11 |
| `test/store-recovery.test.mjs` | 备份、损坏/缺失索引恢复、重新授权、I/O 失败、防止静默清空 | 10 |
| `test/text.test.mjs` | 分片覆盖、字符预算、边界输入 | 6 |

## 最近结果

| 日期 | 环境 | 轮次 | 结果 |
| --- | --- | --- | --- |
| 2026-10-25 | Windows 11，Node.js 24.16.0 | 2 | 117/117 通过，0 失败/跳过/取消 |

v1.2.0 发布前同一套件在 Windows（Node.js 22.23.4 与 24.16.0）下连续 3 轮 113/113；v1.3.0 新增 3 项版本门与 S1 用例后为 116 项。

## v1.3.0（A 阶段：底座）

- **版本门**：`INDEX_VERSION = 2`；读到更高版本索引直接报 `KNOWLEDGE_INDEX_TOO_NEW` 并拒绝写入，不再静默改写。
- **迁移**：v1 索引首次读取时原地升级，保留 `index.v1-<ts>.json` 一次性副本并写 `migration-<ts>.json` 收据；备份恢复路径同样升级。
- **S1 收口**：模型工具 `knowledge_ingest` 只能写当前工作区库；写全局/他用库被拒绝并提示由 owner 在设置页迁移。owner RPC 行为不变。

## 真实模型证据（v1.2.0 起）

- 2026-10-25：宿主重启后以 `reasoningEffort: max` 提炼 35,895 字符 README，产物 `distillEffort: "max"`、`index: 1`、`maxTokens: 32000`、`finishReason: stop`，笔记 24,321 字符，`truncated: false`。

## 尚未覆盖

- 10MB 级 PDF/Office/文本的端到端提炼（工具路径受 600s 时长约束，建议走 UI 路径）。
- 对话附件提炼（B 阶段）与跨工作区共享（C 阶段）。
- 三平台 CI 的新提交结果（推送后确认）。

## v1.4.0（B 阶段：会话附件）

- 新增 `knowledge_ingest_attachment` 工具：从当前会话的 file 块收集附件（内容寻址 sha256），校验落在 `$DSH_HOME/attachments` 内，用同一套提取器（文本/PDF/OOXML）转文本后走现有提炼管线。
- 附件笔记的来源记为 `附件/<文件名>`，默认落当前工作区库；全局/共享仍只允许 owner 操作（S1 口径不变）。
- 附件大小沿用文档上限（文本 10 MiB / 二进制 25 MiB），超限明确报错。
- 新增用例：会话附件 → 笔记 → 来源与正文回读。

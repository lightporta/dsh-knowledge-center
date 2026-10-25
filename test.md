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

## 当前用例（118 项）

| 文件 | 覆盖 | 用例数 |
| --- | --- | --- |
| `test/client-behavior.test.mjs` | 详情串页误删、旧响应与错误、编辑草稿、扫描与搜索竞态、共享刷新、恢复提示、键盘操作 | 21 |
| `test/extract.test.mjs` | DOCX/XLSX/PPTX/HTML/PDF 提取、解压预算、取消传播 | 27 |
| `test/host.test.mjs` | RPC、授权、生成、检索、预算阶梯与 max 兜底、截断回执、版本门/迁移、S1 收口、会话附件提炼、**v1.5 库级共享与撤销** | 22 |
| `test/lock.test.mjs` | 同进程与真实子进程互斥、锁释放、崩溃回收、Windows 注入回归 | 15 |
| `test/manifest.test.mjs` | 包入口、发布文件、bundle、locale、许可证一致性 | 6 |
| `test/paths.test.mjs` | win32/darwin/POSIX 路径规则、工作区边界、来源身份 | 11 |
| `test/store-recovery.test.mjs` | 备份、损坏/缺失索引恢复、重新授权、I/O 失败、防止静默清空 | 10 |
| `test/text.test.mjs` | 分片覆盖、字符预算、边界输入 | 6 |

## 最近结果

| 日期 | 环境 | 轮次 | 结果 |
| --- | --- | --- | --- |
| 2026-10-25 | Windows 11，Node.js 24.16.0 | 1 | 118/118 通过，0 失败/跳过/取消 |

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
- v1.4.1：会话日志不暴露附件引用，工具改为显式 `path`（来自附件提示里的已保存路径），并保留按名称匹配的会话扫描作为兼容路径。

## 真实宿主附件端到端（v1.4.1，2026-10-25）

| 附件 | 源字符 | 笔记大小 | 回执 | 结果 |
| --- | --- | --- | --- | --- |
| 课堂资料-教师采访记录与总结表-20251121.docx（16 KB） | 324 | 3,020 字符 | distillEffort=max，truncated=false | 入库成功，来源 `附件/…docx` |
| 2020-VA2-期中.pdf（3.5 MB） | 16,686 | 14,378 字符 | distillEffort=max，truncated=false | 入库成功，来源 `附件/…pdf`（pdftotext 自动探测生效） |

- 检索：`knowledge_search("微积分 期中")` 命中 PDF 笔记（total=1，带摘要与片段）。
- 回读：`knowledge_read` 返回完整笔记（含公式、题目与解答）。
- 入口：v1.4.1 起使用附件提示里的显式保存路径；`realpath` 必须落在 `$DSH_HOME/attachments` 内。

## v1.5.0（C 阶段：库级共享）

- 数据模型 v3：集合新增 `scope: 'shared'` + `readers`（工作区路径列表）；`index.shares` 追加式记录 `grant/revoke`（时间、目标工作区、actor=owner）。
- 可见性收口在 `accessibleCollectionIds`：`user` 全局、`workspace` 本工作区、`shared` 需命中 readers；`permissions` 仍是外层总开关。
- owner-only RPC：`createCollection(scope:'shared')`、`setCollectionShare`、`listShares`；模型工具不能建共享库、不能改可见性，也不能写共享库。
- 迁移：`INDEX_VERSION=3`；旧库首次读取原地升级并留副本与收据（沿用 v1.3 机制）。
- 新增用例：A 建共享库并入库 → 授权 B → B 可检索/回读、C 不可见 → 撤销后 B 立即不可见 → 审计两条记录。

### v1.6.0（C 阶段 UI）

- 「权限与设置」新增「共享知识库」卡片：新建共享库、按工作区勾选/取消、显示已共享数量；调用 `createCollection(scope:shared)`、`setCollectionShare`、`listShares`。
- 共享与撤销均为 owner 操作；模型工具仍不能改可见性、不能写共享库。

## 真实宿主共享验收（v1.6.0，2026-10-25）

- 「权限与设置」出现「共享知识库」卡片；实测新建 `testshared`（scope=shared）并勾选两个工作区。
- `index.json`：readers = `D:\dsh-knowledge-center`、`D:\Edgefile\Photo_storage`；`permissions` 两者均为 true。
- 审计：4 条记录（grant Photo_storage → grant dsh-knowledge-center → revoke Photo_storage → grant Photo_storage），actor=owner。
- 未执行：浏览器内跨工作区检索断言（需要以 Photo_storage 为工作区开一个会话）；三平台 CI。

# 测试记录（开发仓库与 CI）

本文件记录 dsh-knowledge-center 的测试策略、当前用例清单与历史结果。`test/` 保留在开发仓库并由 CI 执行，不进入 npm 插件发布包；验证范围统一见 [验证记录](docs/VERIFICATION.md)。历史各版本的本地测试口径以对应日期为准。

## 策略

- 行为测试在开发机与 CI 使用隔离的临时目录运行，不把真实知识库、测试输出或本地归档带进发布物。
- 发布门槛：`npm run check`（语法、包清单、文档路径）与 `npm test` 均在 macOS / Ubuntu / Windows 三平台 CI 执行；发布前另检查 `npm pack --dry-run`。
- 测试使用真实临时目录、真实子进程与真实临时知识库，不读取也不写入真实知识库。

## 怎么跑

```bash
npm test
npm run check
```

## 当前用例（152 项，v1.8.4）

| 文件 | 覆盖 | 用例数 |
| --- | --- | --- |
| `test/client-behavior.test.mjs` | 详情串页、草稿、扫描/搜索、分享并发、移动回读与失败保护、恢复提示、键盘操作 | 29 |
| `test/extract.test.mjs` | DOCX/XLSX/PPTX/HTML/PDF 提取、解压预算、取消传播 | 27 |
| `test/host.test.mjs` | RPC、授权、生成、检索、预算阶梯与 max 兜底、截断回执、版本门/迁移、S1 收口、会话附件提炼、库级共享与撤销、共享库写入与移动、嵌套不继承/移动查重、**v1.8.1 搜索不泄露来源路径** | 26 |
| `test/lock.test.mjs` | 同进程与子进程互斥、Windows 访问错误、崩溃回收、获取期限与 owner unlink 重试 | 18 |
| `test/manifest.test.mjs` | 包入口、发布文件、bundle、locale、许可证一致性 | 6 |
| `test/paths.test.mjs` | win32/darwin/POSIX 路径规则、工作区边界、来源身份 | 11 |
| `test/store-recovery.test.mjs` | 备份、损坏/缺失索引恢复、重新授权、I/O 失败、防止静默清空、**v1.8 恢复时清空共享授权** | 11 |
| `test/text.test.mjs` | 分片覆盖、字符预算、边界输入 | 6 |
| `test/attachment.test.mjs` | 旧版 Office 附件转换、服务缺失与存储边界 | 3 |
| `test/sharing.test.mjs` | 移动元数据、并发、异常回滚、共享人数与平台成员匹配 | 11 |
| `test/check.test.mjs` | Windows/macOS/Linux 文档路径检测与可移植示例放行 | 4 |

## 最近结果

| 日期 | 环境 | 轮次 | 结果 |
| --- | --- | --- | --- |
| 2026-10-26 | macOS，Node.js 24.16.0，v1.8.4 | 发布前验证 | 152/152 通过，0 失败/跳过/取消；新提交 CI 尚未执行 |
| 2026-10-25 | Windows 11，Node.js 24.16.0 | 1 | 123/123 通过，0 失败/跳过/取消 |

v1.2.0 发布前同一套件在 Windows（Node.js 22.23.4 与 24.16.0）下连续 3 轮 113/113；v1.3.0 新增 3 项版本门与 S1 用例后为 116 项。

## v1.3.0（A 阶段：底座）

- **版本门**：`INDEX_VERSION = 2`；读到更高版本索引直接报 `KNOWLEDGE_INDEX_TOO_NEW` 并拒绝写入，不再静默改写。
- **迁移**：v1 索引首次读取时原地升级，保留 `index.v1-<ts>.json` 一次性副本并写 `migration-<ts>.json` 收据；备份恢复路径同样升级。
- **S1 收口**：模型工具 `knowledge_ingest` 只能写当前工作区库；写全局/他用库被拒绝并提示由 owner 在设置页迁移。owner RPC 行为不变。

## 真实模型证据（v1.2.0 起）

- 2026-10-25：宿主重启后以 `reasoningEffort: max` 提炼 35,895 字符 README，产物 `distillEffort: "max"`、`index: 1`、`maxTokens: 32000`、`finishReason: stop`，笔记 24,321 字符，`truncated: false`。

## 尚未覆盖

- v1.8.4 本地修复后的真实宿主 GUI 与旧版 Office 附件全流程。
- 大文件长任务的持续恢复，以及正文与索引的断电恢复事务。
- v1.8.3 基线三平台 CI 已通过；v1.8.4 新提交的三平台 CI 仍需推送后确认。
- B/C 阶段已有的历史实机证据见下文，不代替新修改的验收。

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
- `index.json`：readers = `<workspace-A>`、`<workspace-B>`；`permissions` 两者均为 true。
- 审计：4 条记录（grant Photo_storage → grant dsh-knowledge-center → revoke Photo_storage → grant Photo_storage），actor=owner。
- 未执行：浏览器内跨工作区检索断言（需要以 Photo_storage 为工作区开一个会话）；三平台 CI。

### v1.7.0（共享写入与移动）

- 修复实机验收发现的两个缺口：`scope:shared` 库从「生成知识」目标中被客户端过滤掉（无法写入）；工具错误提示指向 UI 中不存在的“移动”动作。
- 「生成知识」现在可选共享库作为目标（owner）；条目详情新增「移动到…」，由 owner 把一个条目迁移到另一个库（含共享库），解决同一来源跨库重复。
- 模型工具仍只能写当前工作区库；共享/撤销/移动都走 owner RPC。

### v1.7.1（编辑态互斥）

- 编辑中的笔记禁用「移动到…」下拉与按钮，悬停提示“先保存或取消编辑，再移动条目”；进入编辑时清空已选目标，避免“选了目标但按钮禁用、误以为已移动”的体验。

## v1.8.0（push 前 hardening）

- 测试回仓：`test/` 不再 gitignore，`npm test` 与 CI 恢复执行（三平台）。
- A2：备份恢复时清空所有 shared readers 与 shares，并写 `recovery.readersReset`（撤销不会被旧备份复活）。
- A3：共享可见性改为精确匹配，嵌套注册工作区不再继承父工作区的共享库。
- A4：`moveEntry` 拒绝目标库同源重复、同步重写笔记 front matter；客户端在打开/关闭详情时清空待移动目标并加 `isCurrentDetail` 守卫。
- B1：merge 输入上限 60k 字符，超出截断并标记 `truncated`。
- B2：附件来源改为内容寻址 `附件/<sha256前12>-<name>`，同名不同内容不再互相覆盖。
- B4：`setCollectionShare` 缺 `allowed` 时默认失败关闭。
- B6：`state().tools` 上报 4 个工具。
- A1：README/test.md/docs 已脱敏；`scripts/check.mjs` 增加本地绝对路径扫描。

## v1.8.1（隐私与标签）

- 模型侧 `knowledge_search` 结果不再包含来源 `workspacePath`（owner UI 仍保留），共享读者无法反推发布方工作区路径。
- 知识库列表的共享库标签从“工作区库”改为“共享库”（中英双语）。

## v1.8.2（UI 状态收口）

- 删除条目成功后提示不再被 `closeDetail()` 清空（先关闭详情，再提示）。
- 共享库卡片随知识库数量变化自动刷新，避免删除/新建知识库后列表陈旧。

## v1.8.3（共享删除警告 + 大附件实机）

- 共享库删除确认新增警告：“删除共享库？N 个工作区将立即失去访问”。当时 owner state 遗漏 readers，人数可能误报为 0；v1.8.4 补齐 `state().collections` 的 readers 与工作区 ID。
- 9 MB docx 实机（大媒体 + 75 字符正文）：入库成功，2252 字节笔记，`distillEffort=max`，`truncated=false`。
- 26 MiB PDF 实机：拒绝，错误 `Attachment is larger than 25 MiB`。
- 说明：当时宿主仍加载 v1.8.0 之前的代码，来源写作 `附件/big-9mb.docx`；重启后新附件使用 `附件/<sha12>-<name>`。

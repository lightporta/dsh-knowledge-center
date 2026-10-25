# 验证记录 / Verification

日期：2026-10-25。此文件集中保存发布前的验证方法、结果和边界；功能修复清单见 [修复记录](fixes-2026-10-25.md)。

## 验证环境与方法

- 上一轮（macOS 基线）：本机 macOS，Node.js 24.16.0。插件要求 Node.js 20.3.0 及以上。
- 本轮（Windows 锁修复）：本机 Windows 11（NT 10.0.26300，26H2），Node.js 24.16.0；另用与 CI 相同的 Node.js 22.23.4 复跑核心回归测试。
- `npm test`：执行 `test/*.test.mjs`，不把辅助模块计作测试。Host 测试使用独立临时数据目录；结束后清理，不读取或写入实际知识库。
- UI 行为测试使用持久 hooks 与 RPC 模拟环境，执行实际客户端组件的事件处理函数，验证请求乱序、操作对象、草稿和搜索状态；这不等同于浏览器视觉或真实 Harness 端到端测试。
- 并发锁测试启动真实 Node 子进程，验证多个写入者互斥、进程退出后的锁回收，以及活跃锁不被强行夺取。
- 文档提取测试使用内存构造的 ZIP、OOXML 和 PDF 样本，覆盖编码、单元格位置、页面顺序、解压预算及取消传播。
- `npm run check`：递归检查运行时模块、测试及脚本的 JS/MJS 语法。
- `npm pack --dry-run --json --ignore-scripts`：检查发布包的运行时依赖和文件清单。
- `git diff --check`：检查补丁格式。另检查 Git 可见文件中的本机绝对路径、临时输出及常见凭证格式。

## 本轮结果（macOS 基线轮次）

| 检查 | 本机结果 |
| --- | --- |
| 核心回归测试 | 102/102 通过，0 失败、跳过或取消 |
| JS/MJS 语法检查 | 18 个文件通过 |
| 补丁格式检查 | `git diff --check` 通过 |
| 发布包清单 | 14 个文件；运行时模块与文档齐全；不含测试、测试辅助环境、脚本、本地归档或 PNG 图标 |
| Git 忽略规则 | 本地归档已命中 `.gitignore`，不会被普通 `git add .` 加入 |
| Git 可见文件检查 | 30 个候选文件未检出机器绝对路径或常见凭证格式；8 处仓库相对链接有效 |

清理前的 106 项通过记录包含现已归档的 4 项接线测试；上一轮可重复运行的核心测试为 102 项，加入 Windows 锁回归后为 110 项。原始测试输出、语法检查输出及打包清单保存在被忽略的本地归档中，不作为仓库发布内容。

## Windows 锁修复复验

CI 在 Windows 上曾有 3 项 `test/lock.test.mjs` 失败：同进程并发竞争、真实子进程并发写入、持锁子进程退出后的锁回收。日志为候选目录 `rename` 与锁目录 `rmdir` 的 `EPERM`。

| 检查 | Windows 本机结果 |
| --- | --- |
| 基线复现 | 用 `e348e68` 的 `lib/lock.js` 跑同一测试文件，复现 `EPERM: operation not permitted, rename ...index.lock`，与 CI 日志一致 |
| 核心回归测试（Node.js 24.16.0） | 110/110 通过，0 失败、跳过或取消 |
| 核心回归测试（Node.js 22.23.4，与 CI 相同） | 110/110 通过，0 失败、跳过或取消 |
| 锁测试稳定性 | Node.js 22.23.4 下连跑 5 次均 15/15；Node.js 24.16.0 下连跑 3 次均 15/15 |
| JS/MJS 语法检查 | 18 个文件通过 |
| 补丁格式检查 | `git diff --check` 通过 |
| 发布包清单 | 14 个文件，与上一轮一致 |

修复内容见 [修复记录](fixes-2026-10-25.md) 的 Windows 文件锁一节。新增 8 项回归测试使用真实临时目录与真实 owner 文件，只在 `rename`、`rmdir`、`rm` 与 `process.kill` 处注入 Windows 访问错误，并检查实际目录、owner 身份、临界区进入次数、返回值与错误原因。

这些结果来自本机 Windows，不代表 GitHub Actions 新提交后的 CI 已通过；推送后仍需确认 macOS、Ubuntu、Windows 三个 job。

## 保留的核心回归测试

| 文件 | 覆盖范围 |
| --- | --- |
| `test/client-behavior.test.mjs` | 详情串页误删、旧响应与错误、编辑草稿、扫描与搜索竞态、共享刷新、恢复提示及键盘操作 |
| `test/host.test.mjs` | 正常请求与取消、工具输出时间、工作区隔离、来源去重、并发更新、删库竞态、完整输出及统一检索 |
| `test/store-recovery.test.mjs` | 备份、损坏/缺失索引恢复、重新授权、I/O 失败及防止静默清空 |
| `test/lock.test.mjs` | 同进程与真实子进程协调、锁释放、崩溃回收、超时与取消；8 项注入 Windows 访问错误的故障回归 |
| `test/extract.test.mjs` | DOCX/XLSX/PPTX/HTML/PDF 提取与资源预算 |
| `test/paths.test.mjs` | 跨平台路径、工作区边界及来源身份 |
| `test/text.test.mjs` | 分片、字符预算与截断边界 |
| `test/manifest.test.mjs` | 包入口、发布文件、bundle、locale 与许可证 |

这些测试保护已修复的实际故障，保留在开发仓库供 CI 运行；`test/`、测试辅助环境和 `scripts/` 不进入插件发布包。

## 已归档与删除

- 旧的 `test/client-bundle.test.mjs`：4 项插件接线、图标几何和页面外壳细节检查，已从测试目录移除，原文件保存在被 Git 忽略的本地归档中。
- 旧审查快照：包含机器绝对路径和修复前行号，已移入相同的本地归档，不提交 GitHub。
- 可选的 `icon.png`：原图已移入本地归档，同时移除包导出、发布清单及 PNG 校验。插件管理列表使用 Harness 默认图标；侧栏与页面标题的内联书本图标保留。
- 原有一次性复现脚本位于系统临时目录，本来就不属于本仓库；其问题与修复结果已合并到修复记录和核心回归测试。

删除旧接线测试后，侧栏和 main 槽位的独立注册检查不再作为单独测试执行。仍保留客户端行为测试及包入口检查；真实应用入口的确认属于下述待验证范围。

## 验证边界

- 本轮没有调用真实模型，没有重启 Harness，也没有写入生产知识数据。
- 尚未验证修复后的 Harness GUI 全流程、实际浏览器排版和视觉回归。
- Windows/Linux 的 CI 已配置。本轮只在 Windows 本机复验了锁修复：Linux 未在本机单独运行，最低 Node.js 版本也未单独运行；GitHub Actions 新提交后的三平台结果仍以远端 CI 为准。
- PDF 回退仍是受限解析器；冲突字体映射会明确报错，扫描件仍需 OCR。
- 索引备份不包含正文版本，不能替代完整数据目录备份。

## Reproduce

```bash
npm test
npm run check
npm pack --dry-run --json --ignore-scripts
git diff --check
```

Results here describe local automated checks. They do not certify real-model calls, GUI layout, remote CI success or live Linux behavior. Development tests and local archives are excluded from the plugin package.

## v1.2.0 发布验收（2026-10-25）

- 变更：提炼调用改为 32000 → 64000 输出预算阶梯，仍然截断才把这一次调用降为 `high`；实际生效的 `effort` 写入笔记 front matter（`distillEffort`）与条目元数据；`knowledge_read` 工具输出新增 `truncated` / `sourceChars` / `distillEffort`。文本文件上限 10 MiB，分片预算 16 段（约 192k 字符）。
- 回归：Windows 本机完整套件连续 3 轮 113/113 通过（Node.js 24.16.0）。
- 发布检查：`npm run check` 通过（7 个文件语法 + 包清单/本地化校验）；`npm pack --dry-run` 为 14 个文件，版本 1.2.0。
- 发版处理：按发布要求删除 `test/` 与 `scripts/test.mjs`，CI 保留语法与清单校验。
- 未验证：宿主重启后真实模型 `reasoningEffort: max` 的实跑、10 MiB 端到端、三平台 CI；这些仍需发布后由实机与 CI 确认。

## v1.3.0（A 阶段：底座）

- 版本门：`INDEX_VERSION = 2`；读到更高版本索引返回 `KNOWLEDGE_INDEX_TOO_NEW` 并拒绝写入，不静默改写。
- 迁移：v1 索引首次读取原地升级，保留 `index.v1-<ts>.json` 副本并写 `migration-<ts>.json` 收据；备份恢复路径同样升级。
- S1 收口：模型工具 `knowledge_ingest` 只能写当前工作区库；全局/他用库由 owner 在设置页迁移。owner RPC 行为不变。
- 测试：本地资产，`test/` 已被 `.gitignore` 忽略；用例与结果统一记录在 [test.md](../test.md)。v1.3.0 完整套件 116/116 连续 3 轮通过（Windows，Node.js 24.16.0）。
- 发布检查：`npm run check` 通过；`npm pack --dry-run` 为 15 个文件（新增 test.md），版本 1.3.0。
- 未验证：三平台 CI（推送后确认）、10MB 端到端、附件与共享（B/C 阶段）。

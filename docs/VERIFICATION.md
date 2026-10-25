# 验证记录 / Verification

日期：2026-10-25。此文件集中保存发布前的验证方法、结果和边界；功能修复清单见 [修复记录](fixes-2026-10-25.md)。

## 验证环境与方法

- 本机 macOS，Node.js 24.16.0。插件要求 Node.js 20.3.0 及以上。
- `npm test`：执行 `test/*.test.mjs`，不把辅助模块计作测试。Host 测试使用独立临时数据目录；结束后清理，不读取或写入实际知识库。
- UI 行为测试使用持久 hooks 与 RPC 模拟环境，执行实际客户端组件的事件处理函数，验证请求乱序、操作对象、草稿和搜索状态；这不等同于浏览器视觉或真实 Harness 端到端测试。
- 并发锁测试启动真实 Node 子进程，验证多个写入者互斥、进程退出后的锁回收，以及活跃锁不被强行夺取。
- 文档提取测试使用内存构造的 ZIP、OOXML 和 PDF 样本，覆盖编码、单元格位置、页面顺序、解压预算及取消传播。
- `npm run check`：递归检查运行时模块、测试及脚本的 JS/MJS 语法。
- `npm pack --dry-run --json --ignore-scripts`：检查发布包的运行时依赖和文件清单。
- `git diff --check`：检查补丁格式。另检查 Git 可见文件中的本机绝对路径、临时输出及常见凭证格式。

## 本轮结果

| 检查 | 本机结果 |
| --- | --- |
| 核心回归测试 | 102/102 通过，0 失败、跳过或取消 |
| JS/MJS 语法检查 | 18 个文件通过 |
| 补丁格式检查 | `git diff --check` 通过 |
| 发布包清单 | 14 个文件；运行时模块与文档齐全；不含测试、测试辅助环境、脚本、本地归档或 PNG 图标 |
| Git 忽略规则 | 本地归档已命中 `.gitignore`，不会被普通 `git add .` 加入 |
| Git 可见文件检查 | 30 个候选文件未检出机器绝对路径或常见凭证格式；8 处仓库相对链接有效 |

清理前的 106 项通过记录包含现已归档的 4 项接线测试；当前可重复运行的核心测试为 102 项。原始测试输出、语法检查输出及打包清单保存在被忽略的本地归档中，不作为仓库发布内容。

## 保留的核心回归测试

| 文件 | 覆盖范围 |
| --- | --- |
| `test/client-behavior.test.mjs` | 详情串页误删、旧响应与错误、编辑草稿、扫描与搜索竞态、共享刷新、恢复提示及键盘操作 |
| `test/host.test.mjs` | 正常请求与取消、工具输出时间、工作区隔离、来源去重、并发更新、删库竞态、完整输出及统一检索 |
| `test/store-recovery.test.mjs` | 备份、损坏/缺失索引恢复、重新授权、I/O 失败及防止静默清空 |
| `test/lock.test.mjs` | 同进程与真实子进程协调、锁释放、崩溃回收、超时与取消 |
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
- Windows/Linux 的 CI 已配置，但没有将本机结果当作这两个平台的实际通过结果；最低 Node.js 版本也未在本机单独运行。
- PDF 回退仍是受限解析器；冲突字体映射会明确报错，扫描件仍需 OCR。
- 索引备份不包含正文版本，不能替代完整数据目录备份。

## Reproduce

```bash
npm test
npm run check
npm pack --dry-run --json --ignore-scripts
git diff --check
```

Results here describe local automated checks. They do not certify real-model calls, GUI layout, remote CI success or live Windows/Linux behavior. Development tests and local archives are excluded from the plugin package.

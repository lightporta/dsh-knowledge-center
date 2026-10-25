# 文档提取前置条件

本文件列出每类文档被解析为知识笔记时使用的提取器、所需前置工具与硬性上限。插件自身零第三方运行时依赖，只有 PDF 与旧版 Office 可能依赖外部工具。

## 总览

| 类型 | 扩展名 | 提取方式 | 前置工具 | 备注 |
| --- | --- | --- | --- | --- |
| 文本 / 标记 | `.md` `.markdown` `.mdx` `.txt` `.rst` `.csv` `.json` `.html` `.htm` `.xml` `.log` | 内置 UTF-8 直读；HTML 去脚本/样式并解码实体 | 无 | 上限 10 MiB / 文件 |
| Word（现代） | `.docx` | 内置 OOXML：ZIP + XML（Node 内建 zlib） | 无 | 上限 25 MiB / 文件 |
| Excel（现代） | `.xlsx` | 内置 OOXML，按工作表输出行文本 | 无 | 上限 25 MiB / 文件 |
| PowerPoint（现代） | `.pptx` | 内置 OOXML，按幻灯片输出文本 | 无 | 上限 25 MiB / 文件 |
| PDF | `.pdf` | 优先 `pdftotext`；否则内置回退解析器（Flate + ToUnicode） | **pdftotext**（Poppler）；无它时仅能处理简单 PDF | 上限 25 MiB / 文件 |
| 旧版 Office | `.doc` `.xls` `.ppt` | 经 Harness 的 `officeToPdf`（LibreOffice）转 PDF 后走 PDF 管线 | **LibreOffice 服务**（桌面版默认随包） | 上限 25 MiB / 文件 |
| 其他 | 图片 / 音频 / 视频 / 未知扩展名 | 不支持 | — | 扫描件 PDF 需要 OCR，不在范围 |

## PDF：pdftotext 的解析顺序

1. 环境变量 `PDFTOTEXT_PATH`（显式指定，优先级最高）。
2. Harness 的 subprocess 服务（等价于在宿主 PATH 中查找 `pdftotext`）。
3. Windows 常见安装位置自动探测：
   - winget Poppler：`%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_*\poppler-*\Library\bin\pdftotext.exe`
   - Git 自带：`C:\Program Files\Git\mingw64\bin\pdftotext.exe`
4. 都找不到时使用内置回退解析器；遇到冲突字体映射会明确报错并提示安装 pdftotext，不会产出半成品。

本机当前探测结果（2026-10-25）：winget Poppler `poppler-25.07.0` 可用，同一份 PDF 提取 7,734 字符；Git 自带副本也存在。

## 旧版 Office

`.doc/.xls/.ppt` 不在本仓库内解析，必须由 Harness profile 中的 `office-to-pdf` 服务（LibreOffice）转换。服务不可用时会返回明确错误，而不是静默失败。

## 硬性上限

- 文本文件 10 MiB；二进制文档 25 MiB（超限在读取前拒绝）。
- 提取文本上限 40 万字符；OOXML/PDF 解压预算为单项 16 MiB、累计 64 MiB。
- 提炼预算为 12k 字符 × 16 段（约 192k 字符），超出部分不送模型并在 front matter 标记 `truncated: true`。
- 附件（对话 attach）走同一套提取器；来源身份为内容寻址的 `sha256`，字节存放在 `$DSH_HOME/attachments/v1/files/` 下。

## 无外部工具时的能力边界

- PDF：内置回退解析器只覆盖 Flate 压缩流与常见 ToUnicode 映射；扫描件、冲突字体、加密 PDF 需要 `pdftotext` 或专用工具。
- 旧版 Office：没有 LibreOffice 服务就无法解析。
- OOXML：无需外部工具，但依赖文件本身是合法 ZIP + XML；损坏文件会报解压或 XML 错误。

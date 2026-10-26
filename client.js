window.__ModuleLoader__.load({
  id: 'dsh-knowledge-center',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const NS = 'knowledge-center'
    const CHANNEL = '/knowledge-center'
    let sectionSequence = 0

    // ──────────────────────────────────────────────────────────────────────
    // Locale dictionaries (the Host half carries its own inventory metadata)
    // ──────────────────────────────────────────────────────────────────────

    const ZH = {
      nav: '知识中心',
      title: '知识中心',
      subtitle: '从工作区文档提炼可复用的知识 Markdown；在授权的工作区中，模型可通过工具检索和使用这些知识。',
      tabLibrary: '知识库',
      tabGenerate: '生成知识',
      tabAccess: '权限与设置',
      searchPlaceholder: '搜索标题、摘要、来源或正文…',
      searching: '正在检索知识…',
      searchResultCount: '找到 {total} 条匹配，显示 {count} 条。',
      allCollections: '全部知识库',
      newLibrary: '新建知识库',
      refresh: '刷新',
      loading: '加载中…',
      retry: '重试',
      emptyLibrary: '知识库还是空的。到「生成知识」标签页选择工作区文档，生成第一篇知识。',
      emptySearch: '没有匹配的知识。',
      entryCount: '{count} 条知识',
      back: '返回列表',
      rendered: '渲染',
      sourceMode: 'Markdown 源码',
      copy: '复制',
      copied: '已复制',
      download: '下载',
      edit: '编辑',
      save: '保存',
      cancel: '取消',
      delete: '删除',
      confirmDelete: '确认删除',
      deleteEntryTitle: '删除这条知识？',
      deleteCollectionTitle: '删除该知识库及其全部知识？',
      deleteSharedWarning: '删除共享库？{count} 个工作区将立即失去访问。',
      updatedAt: '更新于 {time}',
      collection: '知识库',
      sources: '来源',
      createLibraryName: '知识库名称',
      createLibraryScope: '生效范围',
      scopeUser: '用户（所有已授权工作区可用）',
      scopeShared: '共享库',
      scopeWorkspace: '工作区（仅该工作区可用）',
      create: '创建',
      chooseWorkspace: '选择工作区',
      noWorkspaces: '还没有注册的工作区。请先在侧边栏打开一个工作区。',
      scan: '扫描文档',
      scanning: '扫描中…',
      rescan: '重新扫描',
      selectAll: '全选',
      clearSelection: '清空',
      filesFound: '找到 {count} 个可提炼文档',
      noFiles: '该工作区没有找到可提炼的文档（支持 Markdown、TXT、CSV、HTML、PDF、Word、Excel、PowerPoint 等）。',
      selectedCount: '已选 {count} 个',
      generate: '生成知识（{count}）',
      generating: '正在提炼…',
      cancelGeneration: '取消生成',
      progress: '进度 {done}/{total}',
      workspace: '工作区',
      targetLibrary: '目标知识库',
      language: '知识语言',
      langZh: '简体中文',
      langEn: 'English',
      generateHint: '生成由当前默认模型逐篇提炼；支持 Markdown/TXT/CSV/HTML/PDF/Word/Excel/PPT 等文档（PDF 优先用 pdftotext，旧版 Office 经 LibreOffice 转 PDF）。同一来源重复生成会更新已有知识，不会重复创建。',
      generationDone: '生成完成：成功 {ok}，失败 {fail}。',
      generationCancelled: '已取消。',
      accessTitle: '模型调用权限',
      accessHint: '只有在这里打开的工作区，模型才能通过 knowledge_search / knowledge_read 使用知识库；关闭后模型看不到该工作区的知识。',
      accessOn: '允许模型调用',
      allowed: '已授权',
      denied: '未授权',
      noWorkspacesAccess: '没有可配置的工作区。',
      dataDir: '数据目录',
      defaultModel: '默认模型',
      modelTools: '模型工具',
      stats: '统计',
      entryTotal: '{count} 条知识',
      collectionTotal: '{count} 个知识库',
      aboutTitle: '关于',
      aboutText: '知识中心把工作区文档提炼为带元数据的 Markdown 知识文件，存放在本机数据目录中；Markdown 预览采用类 VS Code 的排版。',
      copyPath: '复制路径',
      permissionUpdated: '权限已更新',
      shareTitle: '共享知识库',
      shareHint: '共享库只对「已勾选且已开启模型权限」的工作区可见；owner 可以在「生成知识」里直接写入共享库，或把已有条目移动到共享库。共享与撤销只在这里操作，并留下审计。',
      shareEmpty: '还没有共享知识库',
      shareCreatePlaceholder: '新共享库名称',
      shareCreate: '新建共享库',
      shareCreated: '共享库已创建',
      shareGranted: '已共享给该工作区',
      shareRevoked: '已取消共享',
      moveTo: '移动到…',
      move: '移动',
      entryMoved: '条目已移动',
      moveWhileEditing: '先保存或取消编辑，再移动条目',
      errorPrefix: '操作失败：',
      noModel: '未检测到默认模型，请先在「设置 → 模型」中配置。',
      editHint: '编辑完整 Markdown 源码后保存；front matter 中的 title / summary / sources 会同步到索引。',
      loadingEntry: '正在加载知识…',
      scanTruncatedHint: '文档数量达到扫描上限，仅列出前 {count} 个。',
      truncatedHint: '源文档较长，仅提炼了前 {chars} 个字符。',
      libraryCreated: '知识库已创建',
      entryDeleted: '知识已删除',
      entrySaved: '知识已保存',
      settingSaved: '设置已保存',
      unsavedChanges: '这条知识有未保存的修改。',
      draftPreview: '未保存的草稿预览',
      saveAndBack: '保存并返回',
      discardChanges: '放弃修改',
      keepEditing: '继续编辑',
      scanWorkspaceChanged: '工作区或扫描结果已改变，请重新扫描后再生成。',
      storageRecovered: '知识索引已从备份恢复，备份可能早于最近操作，知识库内容可能回退。所有工作区的模型调用授权已关闭，共享库授权也已清空，请到「权限与设置」重新授权。',
      collectionDeleted: '知识库已删除',
      permissionDeniedHint: '模型工具在未授权的工作区会被拒绝。',
    }

    const EN = {
      nav: 'Knowledge Center',
      title: 'Knowledge Center',
      subtitle: 'Distill reusable knowledge Markdown from workspace documents; in permitted workspaces the model can search and use it through tools.',
      tabLibrary: 'Knowledge Base',
      tabGenerate: 'Generate',
      tabAccess: 'Access & Settings',
      searchPlaceholder: 'Search titles, summaries, sources, or content…',
      searching: 'Searching knowledge…',
      searchResultCount: '{total} matches, showing {count}.',
      allCollections: 'All knowledge bases',
      newLibrary: 'New knowledge base',
      refresh: 'Refresh',
      loading: 'Loading…',
      retry: 'Retry',
      emptyLibrary: 'The library is empty. Open the Generate tab, pick workspace documents, and generate the first note.',
      emptySearch: 'No matching knowledge.',
      entryCount: '{count} notes',
      back: 'Back to list',
      rendered: 'Rendered',
      sourceMode: 'Markdown source',
      copy: 'Copy',
      copied: 'Copied',
      download: 'Download',
      edit: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      confirmDelete: 'Confirm delete',
      deleteEntryTitle: 'Delete this note?',
      deleteCollectionTitle: 'Delete this knowledge base and all its notes?',
      deleteSharedWarning: 'Delete this shared library? {count} workspace(s) lose access immediately.',
      updatedAt: 'Updated {time}',
      collection: 'Knowledge base',
      sources: 'Sources',
      createLibraryName: 'Knowledge base name',
      createLibraryScope: 'Effective scope',
      scopeUser: 'User (usable from every permitted workspace)',
      scopeShared: 'Shared library',
      scopeWorkspace: 'Workspace (only inside that workspace)',
      create: 'Create',
      chooseWorkspace: 'Choose workspace',
      noWorkspaces: 'No registered workspace yet. Open a workspace in the sidebar first.',
      scan: 'Scan documents',
      scanning: 'Scanning…',
      rescan: 'Rescan',
      selectAll: 'Select all',
      clearSelection: 'Clear',
      filesFound: '{count} distillable documents found',
      noFiles: 'No distillable documents were found (Markdown, TXT, CSV, HTML, PDF, Word, Excel, PowerPoint and similar are supported).',
      selectedCount: '{count} selected',
      generate: 'Generate {count} notes',
      generating: 'Distilling…',
      cancelGeneration: 'Cancel generation',
      progress: 'Progress {done}/{total}',
      workspace: 'Workspace',
      targetLibrary: 'Target knowledge base',
      language: 'Language',
      langZh: '简体中文',
      langEn: 'English',
      generateHint: 'Each document is distilled by the current default model. Supported formats: Markdown/TXT/CSV/HTML/PDF/Word/Excel/PowerPoint (PDF prefers pdftotext; legacy Office converts through LibreOffice). Re-generating the same source updates the existing note instead of duplicating it.',
      generationDone: 'Finished: {ok} succeeded, {fail} failed.',
      generationCancelled: 'Cancelled.',
      accessTitle: 'Model access',
      accessHint: 'Models can use knowledge_search / knowledge_read only in workspaces enabled here. When disabled, the model sees none of that workspace knowledge.',
      accessOn: 'Allow model access',
      allowed: 'Allowed',
      denied: 'Denied',
      noWorkspacesAccess: 'No workspace to configure.',
      dataDir: 'Data directory',
      defaultModel: 'Default model',
      modelTools: 'Model tools',
      stats: 'Statistics',
      entryTotal: '{count} notes',
      collectionTotal: '{count} knowledge bases',
      aboutTitle: 'About',
      aboutText: 'Knowledge Center distills workspace documents into Markdown knowledge files with metadata under the local data directory; the preview is laid out like VS Code Markdown preview.',
      copyPath: 'Copy path',
      permissionUpdated: 'Access updated',
      shareTitle: 'Shared knowledge bases',
      shareHint: 'A shared library is visible only to ticked workspaces that also have model access enabled. The owner can generate notes straight into a shared library or move existing notes into it. Sharing and revocation are owner actions on this page and are audited.',
      shareEmpty: 'No shared knowledge base yet',
      shareCreatePlaceholder: 'New shared library name',
      shareCreate: 'Create shared library',
      shareCreated: 'Shared library created',
      shareGranted: 'Shared with this workspace',
      shareRevoked: 'Sharing revoked',
      moveTo: 'Move to…',
      move: 'Move',
      entryMoved: 'Note moved',
      moveWhileEditing: 'Save or discard the edit before moving the note',
      errorPrefix: 'Failed: ',
      noModel: 'No default model detected. Configure one in Settings → Models.',
      editHint: 'Edit the complete Markdown source and save; title / summary / sources from the front matter are synced into the index.',
      loadingEntry: 'Loading note…',
      scanTruncatedHint: 'The scan hit its limit; only the first {count} documents are listed.',
      truncatedHint: 'The source document was long; only the first {chars} characters were distilled.',
      libraryCreated: 'Knowledge base created',
      entryDeleted: 'Note deleted',
      entrySaved: 'Note saved',
      settingSaved: 'Settings saved',
      unsavedChanges: 'This note has unsaved changes.',
      draftPreview: 'Preview of the unsaved draft',
      saveAndBack: 'Save and return',
      discardChanges: 'Discard changes',
      keepEditing: 'Keep editing',
      scanWorkspaceChanged: 'The workspace or scan has changed. Scan again before generating.',
      storageRecovered: 'The knowledge index was restored from a backup. The backup may predate recent changes, so library contents may have reverted. Model access has been disabled for all workspaces. Shared-library grants were also cleared. Re-enable model access and library sharing in Access & Settings.',
      collectionDeleted: 'Knowledge base deleted',
      permissionDeniedHint: 'Model tools are refused in workspaces without a grant.',
    }

    function tr(t, key, params) {
      let text = t(key)
      if (typeof text !== 'string') text = key
      if (params !== undefined) {
        for (const [name, value] of Object.entries(params)) {
          text = text.split(`{${name}}`).join(String(value))
        }
      }
      return text
    }

    function errorMessage(error) {
      if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
      return String(error)
    }

    async function callRpc(ctx, method, params, signal) {
      const connection = ctx.get('connection')
      if (connection === undefined || connection === null || connection.rpc === undefined) {
        throw new Error('Knowledge Center requires the Web connection service.')
      }
      const result = await connection.rpc.call(CHANNEL, method, params ?? {}, signal)
      if (result === null || typeof result !== 'object' || result.ok !== true) {
        const failure = result !== null && typeof result === 'object' ? result.error : undefined
        throw new Error(failure !== null && typeof failure === 'object' && typeof failure.message === 'string'
          ? failure.message
          : 'Knowledge Center request failed.')
      }
      return result.value
    }

    function formatDate(value) {
      const numeric = Number(value)
      const time = Number.isFinite(numeric) ? numeric : Date.parse(String(value))
      if (!Number.isFinite(time) || time <= 0) return '-'
      try {
        return new Date(time).toLocaleString()
      } catch {
        return new Date(time).toISOString()
      }
    }

    function formatBytes(bytes) {
      const size = Number(bytes)
      if (!Number.isFinite(size) || size <= 0) return '0 B'
      if (size < 1024) return `${size} B`
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
      return `${(size / (1024 * 1024)).toFixed(1)} MiB`
    }

    async function copyText(text) {
      if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text)
        return
      }
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand('copy')
      } finally {
        area.remove()
      }
    }

    function downloadText(filename, text) {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Markdown renderer — GitHub/VS Code-flavoured subset, rendered as React
    // ──────────────────────────────────────────────────────────────────────

    function safeHref(raw) {
      const value = String(raw).trim().split(/\s+/)[0]
      if (/^(https?:|mailto:|#)/i.test(value)) return value
      return undefined
    }

    function renderMarkdown(markdown) {
      const h = React.createElement
      const source = String(markdown ?? '').replace(/\r\n?/g, '\n')
      const lines = source.split('\n')

      function linkNode(label, rawHref, key) {
        const href = safeHref(rawHref)
        if (href === undefined) {
          return h('span', { key, className: 'kc-md-linkish', title: String(rawHref) }, renderInline(label, `${key}-t`))
        }
        return h('a', { key, href, target: '_blank', rel: 'noreferrer noopener' }, renderInline(label, `${key}-a`))
      }

      function imageNode(alt, rawHref, key) {
        const href = safeHref(rawHref)
        const label = alt !== undefined && alt.length > 0 ? alt : String(rawHref)
        if (href === undefined) return h('span', { key, className: 'kc-md-image' }, `[image] ${label}`)
        return h('a', { key, href, target: '_blank', rel: 'noreferrer noopener', className: 'kc-md-image' }, `[image] ${label}`)
      }

      function inlineTokenToNode(token, key) {
        const first = token.charCodeAt(0)
        if (first === 96) return h('code', { key, className: 'kc-inline-code' }, token.slice(1, -1))
        if (token.startsWith('**') || token.startsWith('__')) {
          return h('strong', { key }, renderInline(token.slice(2, -2), `${key}-s`))
        }
        if (token.startsWith('~~')) return h('del', { key }, renderInline(token.slice(2, -2), `${key}-d`))
        if (token.startsWith('![')) {
          const match = /^!\[([^\]]*)\]\(([^)\n]+)\)$/.exec(token)
          if (match !== null) return imageNode(match[1], match[2], key)
        }
        if (token.startsWith('[')) {
          const match = /^\[([^\]]+)\]\(([^)\n]+)\)$/.exec(token)
          if (match !== null) return linkNode(match[1], match[2], key)
        }
        if (/^https?:/i.test(token)) return linkNode(token, token, key)
        if (token.startsWith('*') || token.startsWith('_')) {
          return h('em', { key }, renderInline(token.slice(1, -1), `${key}-e`))
        }
        return token
      }

      function renderInline(text, keyPrefix) {
        if (typeof text !== 'string' || text.length === 0) return []
        const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|!\[[^\]\n]*\]\([^)\n]+\)|\[[^\]\n]+\]\([^)\n]+\)|https?:\/\/[^\s<>()]+|\*[^*\n]+\*|_[^_\n]+_)/g
        const nodes = []
        let cursor = 0
        let match
        let index = 0
        while ((match = pattern.exec(text)) !== null) {
          if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
          nodes.push(inlineTokenToNode(match[0], `${keyPrefix}-i${index++}`))
          cursor = match.index + match[0].length
        }
        if (cursor < text.length) nodes.push(text.slice(cursor))
        return nodes
      }

      function isTableStart(index) {
        if (index + 1 >= lines.length) return false
        const header = lines[index].trim()
        const separator = lines[index + 1].trim()
        if (!header.includes('|') || !separator.includes('|')) return false
        return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(separator)
      }

      function splitTableRow(line) {
        let value = line.trim()
        if (value.startsWith('|')) value = value.slice(1)
        if (value.endsWith('|')) value = value.slice(0, -1)
        return value.split('|').map((cell) => cell.trim())
      }

      function startsBlock(line) {
        if (line.trim().length === 0) return true
        return /^#{1,6}\s/.test(line)
          || /^>\s?/.test(line)
          || /^\s*(```|~~~)/.test(line)
          || /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)
          || /^(\s*)([-*+]|\d+[.)])\s+/.test(line)
          || /^\s*\|.*\|\s*$/.test(line)
      }

      const blocks = []
      let index = 0
      let keySeed = 0
      const nextKey = () => `kc-b${keySeed++}`

      while (index < lines.length) {
        const line = lines[index]
        if (line.trim().length === 0) {
          index++
          continue
        }
        const fence = /^\s*(```+|~~~+)\s*([A-Za-z0-9_+.#-]*)\s*$/.exec(line)
        if (fence !== null) {
          const marker = fence[1][0]
          const language = fence[2]
          const buffer = []
          index++
          while (index < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[index])) {
            buffer.push(lines[index])
            index++
          }
          index++
          blocks.push(h('pre', { key: nextKey(), className: 'kc-md-pre' },
            h('code', { className: language.length > 0 ? `kc-md-code kc-lang-${language}` : 'kc-md-code' }, buffer.join('\n'))))
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading !== null) {
          const level = heading[1].length
          const tag = `h${level}`
          blocks.push(h(tag, { key: nextKey(), className: `kc-md-heading kc-md-h${level}` }, renderInline(heading[2].trim(), nextKey())))
          index++
          continue
        }
        if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
          blocks.push(h('hr', { key: nextKey(), className: 'kc-md-hr' }))
          index++
          continue
        }
        if (/^>\s?/.test(line)) {
          const quoted = []
          while (index < lines.length && /^>\s?/.test(lines[index])) {
            quoted.push(lines[index].replace(/^>\s?/, ''))
            index++
          }
          blocks.push(h('blockquote', { key: nextKey(), className: 'kc-md-quote' }, renderMarkdown(quoted.join('\n'))))
          continue
        }
        if (isTableStart(index)) {
          const headerCells = splitTableRow(lines[index])
          const rows = []
          index += 2
          while (index < lines.length && lines[index].trim().length > 0 && lines[index].trim().includes('|')) {
            rows.push(splitTableRow(lines[index]))
            index++
          }
          blocks.push(h('div', { key: nextKey(), className: 'kc-table-wrap' },
            h('table', { className: 'kc-md-table' },
              h('thead', null, h('tr', null, headerCells.map((cell, cellIndex) =>
                h('th', { key: `th${cellIndex}` }, renderInline(cell, `th${cellIndex}`))))),
              h('tbody', null, rows.map((row, rowIndex) =>
                h('tr', { key: `tr${rowIndex}` }, headerCells.map((_, cellIndex) =>
                  h('td', { key: `td${cellIndex}` }, renderInline(row[cellIndex] ?? '', `td${rowIndex}-${cellIndex}`)))))))))
          continue
        }
        if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
          const ordered = /^\s*\d/.test(line)
          const items = []
          while (index < lines.length) {
            const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index])
            if (item === null) {
              if (items.length > 0 && /^\s{2,}\S/.test(lines[index])) {
                items[items.length - 1].text += `\n${lines[index].trim()}`
                index++
                continue
              }
              break
            }
            let text = item[2]
            index++
            while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[index])) {
              text += `\n${lines[index].trim()}`
              index++
            }
            items.push({ text, ordered })
          }
          const listKey = nextKey()
          blocks.push(h(ordered ? 'ol' : 'ul', { key: listKey, className: 'kc-md-list' },
            items.map((item, itemIndex) => {
              const task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(item.text)
              if (task !== null) {
                return h('li', { key: `${listKey}-${itemIndex}`, className: 'kc-task-item' },
                  h('input', { type: 'checkbox', checked: task[1].toLowerCase() === 'x', disabled: true, readOnly: true }),
                  h('span', null, renderInline(task[2].replace(/\n/g, ' '), `${listKey}-${itemIndex}`)))
              }
              return h('li', { key: `${listKey}-${itemIndex}` }, renderInline(item.text.replace(/\n/g, ' '), `${listKey}-${itemIndex}`))
            })))
          continue
        }
        const paragraph = []
        while (index < lines.length && lines[index].trim().length > 0 && !startsBlock(lines[index])) {
          paragraph.push(lines[index].trim())
          index++
        }
        if (paragraph.length === 0) {
          // Unknown block-start line: consume one line so the loop always advances.
          paragraph.push(lines[index].trim())
          index++
        }
        blocks.push(h('p', { key: nextKey(), className: 'kc-md-p' }, renderInline(paragraph.join(' '), nextKey())))
      }
      return h('div', { className: 'kc-md' }, blocks)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Styles — theme tokens only (fallbacks cover missing tokens)
    // ──────────────────────────────────────────────────────────────────────

    const CSS = `
.kc-root{display:flex;flex-direction:column;gap:14px;height:100%;min-height:460px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.kc-page{width:100%;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);display:flex;overflow:hidden;font-size:14px;line-height:1.6}
.kc-page-content{box-sizing:border-box;flex:1;min-width:0;height:100%;max-width:1100px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 28px;display:flex;flex-direction:column;min-height:0}
.kc-page-heading{flex:none;display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;padding-top:28px}
[data-platform=darwin] .kc-page-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.kc-page-heading-icon{flex:none;display:flex;margin-top:3px;color:var(--dsw-alias-brand-primary)}
.kc-page-heading-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.kc-page-heading h1{margin:0;font-size:20px;font-weight:500;line-height:28px}
.kc-page-subtitle{font-size:12px;line-height:18px;max-width:760px}
.kc-page-body{flex:1;min-height:0;display:flex;flex-direction:column}
.kc-page-body .kc-root{height:100%;min-height:0;flex:1}
.kc-header{display:flex;flex-direction:column;gap:4px;flex:none}
.kc-title{font-size:16px;font-weight:600;line-height:24px}
.kc-subtitle{font-size:12px;line-height:18px;max-width:720px}
.kc-muted{color:var(--dsw-alias-label-secondary)}
.kc-tabs{display:flex;gap:4px;border-bottom:.5px solid var(--dsw-alias-border-l2);padding-bottom:8px;flex:none}
.kc-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;padding:5px 12px;border-radius:6px;cursor:pointer;font-family:inherit}
.kc-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.kc-tab-active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500}
.kc-tab:focus-visible,.kc-btn:focus-visible,.kc-input:focus-visible,.kc-switch:focus-visible,.kc-entry:focus-visible,.kc-segmented button:focus-visible,.kc-editor:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.kc-panes{flex:1;min-height:0;display:flex;flex-direction:column}
.kc-pane{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;overflow:hidden}
.kc-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none}
.kc-toolbar-spacer{flex:1}
.kc-input{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);padding:5px 9px;font-size:12px;line-height:18px;font-family:inherit;min-height:30px}
.kc-input::placeholder{color:var(--dsw-alias-label-secondary)}
.kc-select{cursor:pointer;max-width:240px}
.kc-search{flex:1;min-width:160px;max-width:360px}
.kc-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;padding:5px 11px;cursor:pointer;font-family:inherit;min-height:30px;white-space:nowrap}
.kc-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.kc-btn:disabled{opacity:.5;cursor:default}
.kc-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:500}
.kc-btn-primary:hover{filter:brightness(1.06);background:var(--dsw-alias-brand-primary)}
.kc-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.kc-btn-danger:hover{background:var(--dsw-alias-bg-layer-2)}
.kc-btn-small{padding:3px 8px;min-height:24px;font-size:11px;line-height:16px}
.kc-icon-btn{padding:4px 8px;min-width:30px;justify-content:center}
.kc-scroll{overflow:auto;min-height:0;flex:1;display:flex;flex-direction:column;gap:8px}
.kc-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.kc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kc-row-between{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.kc-field{display:flex;flex-direction:column;gap:4px;min-width:180px}
.kc-field-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.kc-list{display:flex;flex-direction:column;gap:6px}
.kc-entry{appearance:none;text-align:left;font-family:inherit;display:flex;flex-direction:column;gap:3px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;cursor:pointer;color:var(--dsw-alias-label-primary);width:100%}
.kc-entry:hover{background:var(--dsw-alias-bg-layer-2)}
.kc-entry-title{font-size:13px;font-weight:500;line-height:20px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kc-entry-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);display:flex;gap:10px;flex-wrap:wrap}
.kc-entry-summary{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.kc-badge{display:inline-flex;align-items:center;font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:999px;padding:0 8px;white-space:nowrap}
.kc-badge-brand{color:var(--dsw-alias-brand-primary)}
.kc-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:36px 16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;border:.5px dashed var(--dsw-alias-border-l2);border-radius:8px}
.kc-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;word-break:break-word}
.kc-warn{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
.kc-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}
.kc-detail{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1}
.kc-detail-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none}
.kc-detail-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}
.kc-detail-title{margin:0;font-size:18px;line-height:26px;font-weight:600}
.kc-detail-meta{font-size:11px;line-height:16px;display:flex;gap:10px;flex-wrap:wrap}
.kc-segmented{display:inline-flex;border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;overflow:hidden}
.kc-segmented button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;padding:4px 9px;cursor:pointer;font-family:inherit}
.kc-segmented button[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500}
.kc-source{box-sizing:border-box;margin:0;padding:14px 16px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:19px;white-space:pre-wrap;word-break:break-word;overflow:auto;flex:1;min-height:0}
.kc-editor{box-sizing:border-box;width:100%;flex:1;min-height:260px;resize:vertical;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:19px;outline:none}
.kc-doclist{display:flex;flex-direction:column;gap:4px;max-height:280px;overflow:auto;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px;background:var(--dsw-alias-bg-layer-1)}
.kc-doc{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:5px;font-size:12px;line-height:18px}
.kc-doc:hover{background:var(--dsw-alias-bg-layer-2)}
.kc-doc-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kc-doc-size{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary)}
.kc-progress{display:flex;flex-direction:column;gap:5px}
.kc-progress-bar{height:5px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.kc-progress-fill{height:100%;background:var(--dsw-alias-brand-primary);transition:width .2s ease}
.kc-run-list{display:flex;flex-direction:column;gap:4px;max-height:220px;overflow:auto}
.kc-run{display:flex;align-items:flex-start;gap:8px;font-size:11px;line-height:17px;padding:3px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.kc-run:last-child{border-bottom:0}
.kc-run-path{flex:1;min-width:0;word-break:break-word}
.kc-run-status{flex:none;font-variant-numeric:tabular-nums}
.kc-switch{position:relative;box-sizing:border-box;width:36px;height:20px;border-radius:999px;border:0;background:var(--dsw-alias-border-l2);cursor:pointer;flex:none;transition:background .15s ease;padding:0}
.kc-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground,#fff);box-shadow:0 1px 2px var(--dsw-alias-border-l2,rgba(0,0,0,.25));transition:transform .15s ease}
.kc-switch[data-on="true"]{background:var(--dsw-alias-brand-primary)}
.kc-switch[data-on="true"]::after{transform:translateX(16px)}
.kc-switch:disabled{opacity:.5;cursor:default}
.kc-access-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.kc-access-row:last-child{border-bottom:0}
.kc-access-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.kc-access-title{font-size:13px;line-height:20px;font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kc-access-path{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.kc-kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;font-size:12px;line-height:18px}
.kc-kv dt{color:var(--dsw-alias-label-secondary)}
.kc-kv dd{margin:0;word-break:break-all}
.kc-tools{display:flex;flex-wrap:wrap;gap:6px}
.kc-tool-chip{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:18px;border:.5px solid var(--dsw-alias-border-l1);border-radius:5px;padding:0 7px;color:var(--dsw-alias-label-secondary)}
.kc-divider{border:0;border-top:.5px solid var(--dsw-alias-border-l2);margin:2px 0;width:100%}
.kc-inline-form{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px}
.kc-spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:kc-spin .7s linear infinite;flex:none}
@keyframes kc-spin{to{transform:rotate(360deg)}}

/* ── Markdown preview: VS Code / GitHub-flavoured ─────────────────────── */
.kc-md{font-size:14px;line-height:1.62;color:var(--dsw-alias-label-primary);word-wrap:break-word;overflow-wrap:break-word}
.kc-md-heading{margin:22px 0 12px;font-weight:600;line-height:1.3}
.kc-md-heading:first-child{margin-top:0}
.kc-md-h1{font-size:2em;padding-bottom:.25em;border-bottom:1px solid var(--dsw-alias-border-l2)}
.kc-md-h2{font-size:1.5em;padding-bottom:.25em;border-bottom:1px solid var(--dsw-alias-border-l2)}
.kc-md-h3{font-size:1.25em}
.kc-md-h4{font-size:1em}
.kc-md-h5{font-size:.9em}
.kc-md-h6{font-size:.85em;color:var(--dsw-alias-label-secondary)}
.kc-md-p{margin:0 0 12px}
.kc-md a{color:var(--dsw-alias-brand-primary);text-decoration:none}
.kc-md a:hover{text-decoration:underline}
.kc-md-linkish{color:var(--dsw-alias-brand-primary);text-decoration:underline dotted;text-underline-offset:2px}
.kc-md-image{color:var(--dsw-alias-brand-primary);text-decoration:none;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:.9em}
.kc-inline-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:85%;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);border-radius:4px;padding:.12em .35em}
.kc-md-pre{margin:0 0 14px;padding:12px 14px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);overflow:auto}
.kc-md-pre code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;background:transparent;border:0;padding:0;white-space:pre;color:var(--dsw-alias-label-primary)}
.kc-md-quote{margin:0 0 14px;padding:0 1em;border-left:4px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.kc-md-quote .kc-md{margin:6px 0}
.kc-md-list{margin:0 0 12px;padding-left:2em}
.kc-md-list li{margin:3px 0}
.kc-task-item{list-style:none;margin-left:-1.4em;display:flex;align-items:flex-start;gap:6px}
.kc-task-item input{margin:.35em 0 0;accent-color:var(--dsw-alias-brand-primary)}
.kc-table-wrap{overflow:auto;margin:0 0 14px;max-width:100%}
.kc-md-table{border-collapse:collapse;font-size:13px;line-height:1.45;min-width:50%}
.kc-md-table th,.kc-md-table td{border:1px solid var(--dsw-alias-border-l1);padding:5px 11px;text-align:left;vertical-align:top}
.kc-md-table th{font-weight:600;background:var(--dsw-alias-bg-layer-2)}
.kc-md-table tbody tr:nth-child(2n) td{background:var(--dsw-alias-bg-layer-1)}
.kc-md-hr{border:0;border-top:1px solid var(--dsw-alias-border-l2);margin:20px 0}
.kc-md strong{font-weight:600}
.kc-md em{font-style:italic}
.kc-md del{text-decoration:line-through;color:var(--dsw-alias-label-secondary)}
`

    // ──────────────────────────────────────────────────────────────────────
    // Shared data hooks + small components
    // ──────────────────────────────────────────────────────────────────────

    function useLibrary(ctx) {
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      const requestRef = useRef(null)
      const load = useCallback(async () => {
        requestRef.current?.abort()
        const controller = new AbortController()
        requestRef.current = controller
        setLoading(true)
        setError(null)
        try {
          const value = await callRpc(ctx, 'state', {}, controller.signal)
          if (requestRef.current === controller) setData(value)
        } catch (failure) {
          if (requestRef.current === controller) setError(errorMessage(failure))
        } finally {
          if (requestRef.current === controller) setLoading(false)
        }
      }, [ctx])
      useEffect(() => {
        void load()
        return () => {
          requestRef.current?.abort()
          requestRef.current = null
        }
      }, [load])
      return { data, loading, error, reload: load }
    }

    function Spinner() {
      return h('span', { className: 'kc-spinner', 'aria-hidden': true })
    }

    function ErrorBanner({ message, onRetry, t }) {
      if (message === null || message === undefined) return null
      return h('div', { className: 'kc-card' },
        h('div', { className: 'kc-error', role: 'alert' }, `${tr(t, 'errorPrefix')}${message}`),
        onRetry === undefined ? null : h('div', null, h('button', { type: 'button', className: 'kc-btn kc-btn-small', onClick: onRetry }, tr(t, 'retry'))))
    }

    function EmptyBox({ children }) {
      return h('div', { className: 'kc-empty' }, children)
    }

    function Notice({ kind, text }) {
      if (text === null || text === undefined || text === '') return null
      return h('div', {
        className: kind === 'error' ? 'kc-error' : kind === 'warn' ? 'kc-warn' : 'kc-ok',
        role: kind === 'error' || kind === 'warn' ? 'alert' : 'status',
      }, text)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Library tab
    // ──────────────────────────────────────────────────────────────────────

    function LibraryTab({ ctx, t, library }) {
      const { data, loading, error, reload } = library
      const [collectionFilter, setCollectionFilter] = useState('all')
      const [query, setQuery] = useState('')
      const [searchResult, setSearchResult] = useState(null)
      const [searchLoading, setSearchLoading] = useState(false)
      const [searchError, setSearchError] = useState(null)
      const searchRequestRef = useRef(null)
      const [detailId, setDetailId] = useState(null)
      const [moveTarget, setMoveTarget] = useState('')
      const [detail, setDetail] = useState(null)
      const [detailError, setDetailError] = useState(null)
      const [detailLoading, setDetailLoading] = useState(false)
      const [viewMode, setViewMode] = useState('rendered')
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState('')
      const [notice, setNotice] = useState(null)
      const [errorNotice, setErrorNotice] = useState(null)
      const [busy, setBusy] = useState(false)
      const [pendingDelete, setPendingDelete] = useState(null)
      const [creating, setCreating] = useState(false)
      const [newName, setNewName] = useState('')
      const [newScope, setNewScope] = useState('user')
      const [newWorkspace, setNewWorkspace] = useState('')
      const [createError, setCreateError] = useState(null)
      const [pendingExit, setPendingExit] = useState(null)
      const detailRequestRef = useRef(null)
      const detailMutationRef = useRef(false)

      useEffect(() => () => {
        detailRequestRef.current?.controller.abort()
        detailRequestRef.current = null
      }, [])

      const openEntry = useCallback(async (id) => {
        if (detailMutationRef.current) return
        detailRequestRef.current?.controller.abort()
        const request = { id, controller: new AbortController() }
        detailRequestRef.current = request
        setDetailId(id)
        setDetailLoading(true)
        setDetailError(null)
        setDetail(null)
        setEditing(false)
        setViewMode('rendered')
        setNotice(null)
        setErrorNotice(null)
        setPendingDelete(null)
        setPendingExit(null)
        setMoveTarget('')
        setDraft('')
        try {
          const value = await callRpc(ctx, 'read', { id }, request.controller.signal)
          if (detailRequestRef.current !== request) return
          if (value?.meta?.id !== id) throw new Error('Knowledge note response does not match the requested id.')
          setDetail(value)
          setDraft(value.source)
        } catch (failure) {
          if (detailRequestRef.current === request) setDetailError(errorMessage(failure))
        } finally {
          if (detailRequestRef.current === request) setDetailLoading(false)
        }
      }, [ctx])

      const closeDetail = useCallback(() => {
        if (detailMutationRef.current) return
        detailRequestRef.current?.controller.abort()
        detailRequestRef.current = null
        setDetailId(null)
        setDetail(null)
        setDetailLoading(false)
        setDetailError(null)
        setEditing(false)
        setDraft('')
        setMoveTarget('')
        setPendingDelete(null)
        setPendingExit(null)
        setNotice(null)
        setErrorNotice(null)
      }, [])

      const detailRequest = detailRequestRef.current
      const isCurrentDetail = () => detail !== null && !detailLoading && !busy
        && !detailMutationRef.current && detail.meta.id === detailId
        && detailRequestRef.current === detailRequest && detailRequest?.id === detailId
      const detailReady = isCurrentDetail()
      const dirtyDraft = editing && detail !== null && draft !== detail.source

      const finishEditing = () => {
        setEditing(false)
        setDraft(detail === null ? '' : detail.source)
        setPendingExit(null)
      }

      const requestExit = (action) => {
        if (busy || detailMutationRef.current) return
        if (dirtyDraft) {
          setPendingExit(action)
          return
        }
        if (action === 'close') closeDetail()
        else finishEditing()
      }

      const queryText = query.trim()
      useEffect(() => {
        if (queryText === '' || data === null) {
          setSearchResult(null)
          setSearchLoading(false)
          setSearchError(null)
          return undefined
        }
        const request = { query: queryText, collectionId: collectionFilter, controller: new AbortController() }
        searchRequestRef.current = request
        setSearchResult(null)
        setSearchLoading(true)
        setSearchError(null)
        const timer = setTimeout(() => {
          callRpc(ctx, 'search', {
            query: request.query,
            ...(request.collectionId === 'all' ? {} : { collectionId: request.collectionId }),
          }, request.controller.signal)
            .then((value) => {
              if (searchRequestRef.current === request) {
                setSearchResult({ ...value, query: request.query, collectionId: request.collectionId })
              }
            })
            .catch((failure) => {
              if (searchRequestRef.current === request) setSearchError(errorMessage(failure))
            })
            .finally(() => {
              if (searchRequestRef.current === request) setSearchLoading(false)
            })
        }, 200)
        return () => {
          clearTimeout(timer)
          request.controller.abort()
          if (searchRequestRef.current === request) searchRequestRef.current = null
        }
      }, [ctx, queryText, collectionFilter, data])

      const entries = useMemo(() => {
        if (data === null) return []
        if (queryText !== '') {
          return searchResult?.query === queryText && searchResult.collectionId === collectionFilter
            ? searchResult.results : []
        }
        return data.entries.filter((entry) => {
          return collectionFilter === 'all' || entry.collectionId === collectionFilter
        })
      }, [data, queryText, collectionFilter, searchResult])

      const collections = data === null ? [] : data.collections
      const workspaces = data === null ? [] : data.workspaces

      const createCollection = async () => {
        const name = newName.trim()
        if (name.length === 0) {
          setCreateError(tr(t, 'createLibraryName'))
          return
        }
        setBusy(true)
        setCreateError(null)
        try {
          await callRpc(ctx, 'createCollection', {
            name,
            scope: newScope,
            ...(newScope === 'workspace' ? { workspacePath: newWorkspace } : {}),
          })
          setCreating(false)
          setNewName('')
          setNewScope('user')
          setNewWorkspace('')
          setNotice(tr(t, 'libraryCreated'))
          await reload()
        } catch (failure) {
          setCreateError(errorMessage(failure))
        } finally {
          setBusy(false)
        }
      }

      const deleteEntry = async (id) => {
        if (!isCurrentDetail() || id !== detail.meta.id) return
        detailMutationRef.current = true
        setBusy(true)
        setNotice(null)
        try {
          await callRpc(ctx, 'deleteEntry', { id })
          setPendingDelete(null)
          detailMutationRef.current = false
          closeDetail()
          // closeDetail clears notifications; surface the upload after it runs.
          setNotice(tr(t, 'entryDeleted'))
          await reload()
        } catch (failure) {
          setDetailError(errorMessage(failure))
        } finally {
          detailMutationRef.current = false
          setBusy(false)
        }
      }

      const moveEntryTo = async (target) => {
        if (!isCurrentDetail() || editing || target === '' || target === detail.meta.collectionId
          || !collections.some((collection) => collection.id === target)) return
        const request = detailRequest
        const id = detail.meta.id
        let committed = false
        setBusy(true)
        setNotice(null)
        setErrorNotice(null)
        setDetailError(null)
        detailMutationRef.current = true
        try {
          const moved = await callRpc(ctx, 'moveEntry', { id, collectionId: target })
          if (detailRequestRef.current !== request) return
          if (moved?.id !== id) throw new Error('Moved knowledge note does not match the requested id.')
          committed = true
          // The Host rewrites front matter on move. Do not export or edit the
          // previous source alongside the new library metadata.
          setDetail(null)
          setDraft('')
          setDetailLoading(true)
          const next = await callRpc(ctx, 'read', { id }, request.controller.signal)
          if (detailRequestRef.current !== request) return
          if (next?.meta?.id !== id) throw new Error('Knowledge note response does not match the requested id.')
          setDetail(next)
          setDraft(next.source)
          setMoveTarget('')
          setNotice(tr(t, 'entryMoved'))
          await reload()
        } catch (failure) {
          if (detailRequestRef.current === request) {
            if (committed) {
              setDetail(null)
              setDraft('')
            }
            setErrorNotice(`${tr(t, 'errorPrefix')}${errorMessage(failure)}`)
          }
        } finally {
          detailMutationRef.current = false
          if (detailRequestRef.current === request) {
            setDetailLoading(false)
            setBusy(false)
          }
        }
      }
      const deleteCollection = async (id) => {
        setBusy(true)
        setNotice(null)
        setErrorNotice(null)
        try {
          await callRpc(ctx, 'deleteCollection', { id })
          setPendingDelete(null)
          setNotice(tr(t, 'collectionDeleted'))
          await reload()
        } catch (failure) {
          setErrorNotice(`${tr(t, 'errorPrefix')}${errorMessage(failure)}`)
        } finally {
          setBusy(false)
        }
      }

      const saveEntry = async () => {
        if (!isCurrentDetail()) return false
        detailMutationRef.current = true
        setBusy(true)
        setNotice(null)
        setDetailError(null)
        try {
          const value = await callRpc(ctx, 'saveEntry', { id: detail.meta.id, markdown: draft })
          if (value.entry.id !== detailId) throw new Error('Saved knowledge note does not match the requested id.')
          const next = await callRpc(ctx, 'read', { id: value.entry.id })
          if (detailRequestRef.current !== detailRequest) return
          if (next?.meta?.id !== detailId) throw new Error('Knowledge note response does not match the requested id.')
          setDetail(next)
          setDraft(next.source)
          setEditing(false)
          setPendingExit(null)
          setNotice(tr(t, 'entrySaved'))
          await reload()
          return true
        } catch (failure) {
          if (detailRequestRef.current === detailRequest) setDetailError(errorMessage(failure))
          return false
        } finally {
          detailMutationRef.current = false
          setBusy(false)
        }
      }

      const copyCurrent = async () => {
        if (!isCurrentDetail()) return
        try {
          await copyText(editing ? draft : detail.source)
          setErrorNotice(null)
          setNotice(tr(t, 'copied'))
        } catch (failure) {
          setErrorNotice(`${tr(t, 'errorPrefix')}${errorMessage(failure)}`)
        }
      }

      const downloadCurrent = () => {
        if (!isCurrentDetail()) return
        const title = String(detail.meta.title ?? 'knowledge').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)
        downloadText(`${title}.md`, editing ? draft : detail.source)
      }

      const renderCollectionChip = (collection) => {
        const scopeLabel = collection.scope === 'user' ? tr(t, 'scopeUser') : collection.scope === 'shared' ? tr(t, 'scopeShared') : tr(t, 'scopeWorkspace')
        const chip = h('span', { className: 'kc-badge' }, `${collection.name} · ${scopeLabel}`)
        if (collection.id === 'shared') {
          return h('span', { key: collection.id, className: 'kc-row' }, chip)
        }
        if (pendingDelete === `collection:${collection.id}`) {
          return h('span', { key: collection.id, className: 'kc-row' },
            chip,
             h('span', { className: 'kc-warn' }, collection.scope === 'shared'
              ? tr(t, 'deleteSharedWarning', { count: (collection.readers ?? []).length })
              : tr(t, 'deleteCollectionTitle')),
           h('button', { type: 'button', className: 'kc-btn kc-btn-small kc-btn-danger', disabled: busy, onClick: () => deleteCollection(collection.id) }, tr(t, 'confirmDelete')),
            h('button', { type: 'button', className: 'kc-btn kc-btn-small', onClick: () => setPendingDelete(null) }, tr(t, 'cancel')))
        }
        return h('span', { key: collection.id, className: 'kc-row' },
          chip,
          h('button', { type: 'button', className: 'kc-btn kc-btn-small', onClick: () => setPendingDelete(`collection:${collection.id}`) }, tr(t, 'delete')))
      }

      // Detail view
      if (detailId !== null) {
        return h('div', { className: 'kc-pane' },
          h('div', { className: 'kc-detail-head' },
            h('button', { type: 'button', className: 'kc-btn', disabled: busy, onClick: () => requestExit('close') }, `← ${tr(t, 'back')}`),
            h('div', { className: 'kc-detail-actions' },
              h('div', { className: 'kc-segmented' },
                h('button', { type: 'button', disabled: !detailReady, 'data-active': viewMode === 'rendered', onClick: () => setViewMode('rendered') }, tr(t, 'rendered')),
                h('button', { type: 'button', disabled: !detailReady, 'data-active': viewMode === 'source', onClick: () => setViewMode('source') }, tr(t, 'sourceMode'))),
              h('button', { type: 'button', className: 'kc-btn kc-btn-small', disabled: !detailReady, onClick: copyCurrent }, tr(t, 'copy')),
              h('button', { type: 'button', className: 'kc-btn kc-btn-small', disabled: !detailReady, onClick: downloadCurrent }, tr(t, 'download')),
              h('select', {
                className: 'kc-input',
                'aria-label': tr(t, 'moveTo'),
                value: moveTarget,
                disabled: busy || !detailReady || editing,
                title: editing ? tr(t, 'moveWhileEditing') : undefined,
                onChange: (event) => setMoveTarget(event.target.value),
              },
                h('option', { value: '' }, tr(t, 'moveTo')),
                (data?.collections ?? []).filter((collection) => collection.id !== detail?.meta?.collectionId)
                  .map((collection) => h('option', { key: collection.id, value: collection.id }, collection.name))),
              h('button', { type: 'button', className: 'kc-btn kc-btn-small', disabled: moveTarget === '' || busy || !detailReady || editing, title: editing ? tr(t, 'moveWhileEditing') : undefined, onClick: () => moveEntryTo(moveTarget) }, tr(t, 'move')),
              editing
                ? h('button', { type: 'button', className: 'kc-btn kc-btn-small kc-btn-primary', disabled: busy, onClick: saveEntry }, tr(t, 'save'))
                : h('button', { type: 'button', className: 'kc-btn kc-btn-small', disabled: !detailReady, onClick: () => { if (!isCurrentDetail()) return; setEditing(true); setViewMode('source'); setDraft(detail.source); setMoveTarget('') } }, tr(t, 'edit')),
              pendingDelete === detailId
                ? h('span', { className: 'kc-row' },
                    h('span', { className: 'kc-warn' }, tr(t, 'deleteEntryTitle')),
                    h('button', { type: 'button', className: 'kc-btn kc-btn-small kc-btn-danger', disabled: !detailReady, onClick: () => deleteEntry(detail.meta.id) }, tr(t, 'confirmDelete')),
                    h('button', { type: 'button', className: 'kc-btn kc-btn-small', onClick: () => setPendingDelete(null) }, tr(t, 'cancel')))
                : h('button', { type: 'button', className: 'kc-btn kc-btn-small', disabled: !detailReady, onClick: () => { if (isCurrentDetail()) setPendingDelete(detail.meta.id) } }, tr(t, 'delete')))),
          h(Notice, { kind: 'ok', text: notice }),
          h(Notice, { kind: 'error', text: errorNotice }),
          pendingExit === null ? null : h('div', { className: 'kc-card', role: 'alert' },
            h('div', { className: 'kc-warn' }, tr(t, 'unsavedChanges')),
            h('div', { className: 'kc-row' },
              h('button', { type: 'button', className: 'kc-btn kc-btn-primary', disabled: busy, onClick: async () => {
                const saved = await saveEntry()
                if (saved && pendingExit === 'close') closeDetail()
              } }, tr(t, pendingExit === 'close' ? 'saveAndBack' : 'save')),
              h('button', { type: 'button', className: 'kc-btn', disabled: busy, onClick: () => {
                if (pendingExit === 'close') closeDetail()
                else finishEditing()
              } }, tr(t, 'discardChanges')),
              h('button', { type: 'button', className: 'kc-btn', disabled: busy, onClick: () => {
                setPendingExit(null)
                setViewMode('source')
              } }, tr(t, 'keepEditing')))),
          detailError === null ? null : h('div', { className: 'kc-error' }, `${tr(t, 'errorPrefix')}${detailError}`),
          detailLoading
            ? h('div', { className: 'kc-row' }, h(Spinner), h('span', { className: 'kc-muted' }, tr(t, 'loadingEntry')))
            : null,
          detail === null && !detailLoading ? null : h('div', { className: 'kc-detail' },
            h('h2', { className: 'kc-detail-title' }, detail === null ? '' : detail.meta.title),
            detail === null ? null : h('div', { className: 'kc-detail-meta kc-muted' },
              h('span', { className: 'kc-badge kc-badge-brand' }, detail.meta.collectionName),
              h('span', null, (detail.meta.sources ?? []).join(', ')),
              h('span', null, tr(t, 'updatedAt', { time: formatDate(detail.meta.updatedAt) })),
              h('span', null, formatBytes(detail.meta.size))),
            editing && viewMode === 'source'
              ? h('div', { className: 'kc-detail', style: { gap: '6px' } },
                  h('div', { className: 'kc-muted', style: { fontSize: '11px' } }, tr(t, 'editHint')),
                  h('textarea', { className: 'kc-editor', value: draft, disabled: busy, spellCheck: false, 'aria-label': tr(t, 'sourceMode'), onChange: (event) => setDraft(event.target.value) }),
                  h('div', { className: 'kc-row' },
                    h('button', { type: 'button', className: 'kc-btn kc-btn-primary', disabled: busy, onClick: saveEntry }, tr(t, 'save')),
                    h('button', { type: 'button', className: 'kc-btn', disabled: busy, onClick: () => requestExit('edit') }, tr(t, 'cancel'))))
              : h('div', { className: 'kc-scroll' },
                  viewMode === 'rendered'
                    ? (detail === null ? null : h(React.Fragment ?? 'div', null,
                        editing ? h('div', { className: 'kc-warn' }, tr(t, 'draftPreview')) : null,
                        renderMarkdown(editing ? draft.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '') : detail.markdown)))
                    : h('pre', { className: 'kc-source' }, h('code', null, detail === null ? '' : detail.source)))))
      }

      // List view
      return h('div', { className: 'kc-pane' },
        h('div', { className: 'kc-toolbar' },
          h('select', { className: 'kc-input kc-select', value: collectionFilter, onChange: (event) => setCollectionFilter(event.target.value), 'aria-label': tr(t, 'collection') },
            h('option', { value: 'all' }, tr(t, 'allCollections')),
            collections.map((collection) => h('option', { key: collection.id, value: collection.id }, `${collection.name} (${collection.entryCount})`))),
          h('input', { className: 'kc-input kc-search', type: 'search', placeholder: tr(t, 'searchPlaceholder'), value: query, onChange: (event) => setQuery(event.target.value), 'aria-label': tr(t, 'searchPlaceholder') }),
          h('div', { className: 'kc-toolbar-spacer' }),
          h('button', { type: 'button', className: 'kc-btn', onClick: () => { setCreating((value) => !value); setCreateError(null) } }, tr(t, 'newLibrary')),
          h('button', { type: 'button', className: 'kc-btn kc-icon-btn', title: tr(t, 'refresh'), onClick: reload, disabled: loading }, loading ? h(Spinner) : '↻')),
        creating
          ? h('div', { className: 'kc-inline-form' },
              h('label', { className: 'kc-field' },
                h('span', { className: 'kc-field-label' }, tr(t, 'createLibraryName')),
                h('input', { className: 'kc-input', value: newName, onChange: (event) => setNewName(event.target.value), placeholder: 'e.g. 产品设计规范' })),
              h('label', { className: 'kc-field' },
                h('span', { className: 'kc-field-label' }, tr(t, 'createLibraryScope')),
                h('select', { className: 'kc-input kc-select', value: newScope, onChange: (event) => setNewScope(event.target.value) },
                  h('option', { value: 'user' }, tr(t, 'scopeUser')),
                  h('option', { value: 'workspace' }, tr(t, 'scopeWorkspace')))),
              newScope === 'workspace'
                ? h('label', { className: 'kc-field' },
                    h('span', { className: 'kc-field-label' }, tr(t, 'workspace')),
                    h('select', { className: 'kc-input kc-select', value: newWorkspace, onChange: (event) => setNewWorkspace(event.target.value) },
                      h('option', { value: '' }, tr(t, 'chooseWorkspace')),
                      workspaces.map((workspace) => h('option', { key: workspace.id, value: workspace.path }, workspace.title))))
                : null,
              h('button', { type: 'button', className: 'kc-btn kc-btn-primary', disabled: busy, onClick: createCollection }, tr(t, 'create')),
              h('button', { type: 'button', className: 'kc-btn', onClick: () => setCreating(false) }, tr(t, 'cancel')),
              createError === null ? null : h('div', { className: 'kc-error', style: { flexBasis: '100%' } }, createError))
          : null,
        h(ErrorBanner, { message: error, onRetry: reload, t }),
        h(ErrorBanner, { message: searchError, t }),
        h(Notice, { kind: 'ok', text: notice }),
        h(Notice, { kind: 'error', text: errorNotice }),
        loading && data === null
          ? h('div', { className: 'kc-row' }, h(Spinner), h('span', { className: 'kc-muted' }, tr(t, 'loading')))
          : null,
        queryText !== '' && searchLoading
          ? h('div', { className: 'kc-row', role: 'status' }, h(Spinner), h('span', { className: 'kc-muted' }, tr(t, 'searching')))
          : null,
        queryText !== '' && searchResult?.query === queryText && searchResult.collectionId === collectionFilter && !searchLoading
          ? h('div', { className: 'kc-muted', role: 'status' }, tr(t, 'searchResultCount', { total: searchResult.total, count: entries.length }))
          : null,
        data === null ? null : h('div', { className: 'kc-list kc-scroll' },
          entries.length === 0
            ? (searchLoading || searchError !== null ? null : h(EmptyBox, null, queryText === '' && data.entries.length === 0 ? tr(t, 'emptyLibrary') : tr(t, 'emptySearch')))
            : entries.map((entry) => h('button', {
                key: entry.id,
                type: 'button',
                className: 'kc-entry',
                onClick: () => openEntry(entry.id),
              },
                h('div', { className: 'kc-entry-title' },
                  h('span', null, entry.title),
                  h('span', { className: 'kc-badge kc-badge-brand' }, entry.collectionName)),
                h('div', { className: 'kc-entry-meta' },
                  h('span', null, (entry.sources ?? []).join(', ')),
                  h('span', null, tr(t, 'updatedAt', { time: formatDate(entry.updatedAt) })),
                  h('span', null, formatBytes(entry.size))),
                (entry.snippet ?? entry.summary) === '' ? null : h('div', { className: 'kc-entry-summary' }, entry.snippet ?? entry.summary))),
          collections.length > 0
            ? h('div', { className: 'kc-card' },
                h('div', { className: 'kc-row-between' },
                  h('div', { className: 'kc-row' },
                    h('span', { className: 'kc-muted' }, tr(t, 'collection')),
                    collections.map((collection) => renderCollectionChip(collection)))))
            : null)
      )
    }

    // ──────────────────────────────────────────────────────────────────────
    // Generate tab
    // ──────────────────────────────────────────────────────────────────────

    function GenerateTab({ ctx, t, library }) {
      const { data, loading, error, reload } = library
      const [workspacePath, setWorkspacePath] = useState('')
      const [collectionId, setCollectionId] = useState('')
      const [language, setLanguage] = useState('zh')
      const [scanning, setScanning] = useState(false)
      const [scanError, setScanError] = useState(null)
      const [scanResult, setScanResult] = useState(null)
      const [selected, setSelected] = useState([])
      const [generating, setGenerating] = useState(false)
      const [progress, setProgress] = useState({ done: 0, total: 0 })
      const [runs, setRuns] = useState([])
      const [notice, setNotice] = useState(null)
      const abortRef = useRef(null)
      const scanRequestRef = useRef(null)
      const workspaceRef = useRef(workspacePath)
      workspaceRef.current = workspacePath

      const workspaces = data === null ? [] : data.workspaces
      const collections = data === null ? [] : data.collections

      const availableCollections = useMemo(() => {
        if (data === null) return []
        return collections.filter((collection) => {
          if (collection.scope === 'user' || collection.scope === 'shared') return true
          return workspacePath !== '' && collection.workspacePath !== null && collection.workspacePath === workspacePath
        })
      }, [data, collections, workspacePath])

      useEffect(() => {
        if (workspacePath === '' && workspaces.length > 0) {
          workspaceRef.current = workspaces[0].path
          setWorkspacePath(workspaces[0].path)
        }
      }, [workspaces, workspacePath])

      useEffect(() => {
        if (availableCollections.length === 0) {
          setCollectionId('')
          return
        }
        const current = availableCollections.find((collection) => collection.id === collectionId)
        if (current !== undefined) return
        const workspaceCollection = availableCollections.find((collection) => collection.scope === 'workspace')
        setCollectionId((workspaceCollection ?? availableCollections[0]).id)
      }, [availableCollections, collectionId])

      const configuredLanguage = data?.settings?.outputLanguage
      useEffect(() => {
        const configured = configuredLanguage
        if (configured === 'zh' || configured === 'en') setLanguage(configured)
      }, [configuredLanguage])

      useEffect(() => () => {
        if (abortRef.current !== null) abortRef.current.abort()
        scanRequestRef.current?.controller.abort()
        scanRequestRef.current = null
      }, [])

      const changeWorkspace = useCallback((path) => {
        if (abortRef.current !== null) return
        scanRequestRef.current?.controller.abort()
        scanRequestRef.current = null
        workspaceRef.current = path
        setWorkspacePath(path)
        setScanning(false)
        setScanResult(null)
        setSelected([])
        setRuns([])
        setNotice(null)
        setScanError(null)
      }, [])

      const scan = async () => {
        if (workspacePath === '' || abortRef.current !== null || workspaceRef.current !== workspacePath) return
        scanRequestRef.current?.controller.abort()
        const request = { workspacePath, controller: new AbortController() }
        scanRequestRef.current = request
        setScanning(true)
        setScanError(null)
        setScanResult(null)
        setSelected([])
        setRuns([])
        setNotice(null)
        try {
          const value = await callRpc(ctx, 'scan', { workspacePath }, request.controller.signal)
          if (scanRequestRef.current !== request || workspaceRef.current !== request.workspacePath) return
          setScanResult({ ...value, workspacePath: request.workspacePath, request })
        } catch (failure) {
          if (scanRequestRef.current === request) setScanError(errorMessage(failure))
        } finally {
          if (scanRequestRef.current === request) setScanning(false)
        }
      }

      const toggleSelected = (path, checked) => {
        setSelected((current) => {
          if (checked) return current.includes(path) ? current : [...current, path]
          return current.filter((item) => item !== path)
        })
      }

      const generate = async () => {
        if (selected.length === 0 || collectionId === '' || workspacePath === '' || abortRef.current !== null) return
        if (workspaceRef.current !== workspacePath || scanResult?.workspacePath !== workspacePath
          || scanRequestRef.current !== scanResult.request || scanResult.request.controller.signal.aborted
          || !selected.every((path) => scanResult.files.some((file) => file.path === path))) {
          setScanError(tr(t, 'scanWorkspaceChanged'))
          return
        }
        const controller = new AbortController()
        abortRef.current = controller
        setGenerating(true)
        setNotice(null)
        const initialRuns = selected.map((path) => ({ path, status: 'pending', message: '' }))
        setRuns(initialRuns)
        setProgress({ done: 0, total: selected.length })
        let succeeded = 0
        let failed = 0
        for (let index = 0; index < selected.length; index++) {
          if (controller.signal.aborted) break
          const path = selected[index]
          setRuns((current) => current.map((run, runIndex) => runIndex === index ? { ...run, status: 'running' } : run))
          try {
            const value = await callRpc(ctx, 'ingest', { workspacePath, collectionId, relPath: path, language }, controller.signal)
            succeeded++
            setRuns((current) => current.map((run, runIndex) => runIndex === index
              ? { ...run, status: 'done', message: `${value.replaced ? '↻ ' : '✓ '}${value.entry.title}${value.truncated ? ' · truncated' : ''}` }
              : run))
          } catch (failure) {
            failed++
            setRuns((current) => current.map((run, runIndex) => runIndex === index
              ? { ...run, status: 'error', message: errorMessage(failure) }
              : run))
          }
          setProgress({ done: index + 1, total: selected.length })
        }
        setGenerating(false)
        abortRef.current = null
        if (controller.signal.aborted) setNotice(tr(t, 'generationCancelled'))
        else {
          setNotice(tr(t, 'generationDone', { ok: succeeded, fail: failed }))
        }
        if (succeeded > 0) await reload()
      }

      const cancelGeneration = () => {
        if (abortRef.current !== null) abortRef.current.abort()
      }

      if (loading && data === null) {
        return h('div', { className: 'kc-row' }, h(Spinner), h('span', { className: 'kc-muted' }, tr(t, 'loading')))
      }

      const scanIsCurrent = scanResult !== null && scanResult.workspacePath === workspacePath
        && scanResult.request === scanRequestRef.current
      const scannedFiles = scanIsCurrent ? scanResult.files : []
      const selectedCount = selected.length
      const doneCount = runs.filter((run) => run.status === 'done').length
      const failedCount = runs.filter((run) => run.status === 'error').length

      return h('div', { className: 'kc-pane' },
        h(ErrorBanner, { message: error, onRetry: reload, t }),
        workspaces.length === 0
          ? h(EmptyBox, null, tr(t, 'noWorkspaces'))
          : h('div', { className: 'kc-card' },
              h('div', { className: 'kc-row' },
                h('label', { className: 'kc-field' },
                  h('span', { className: 'kc-field-label' }, tr(t, 'workspace')),
                  h('select', { className: 'kc-input kc-select', value: workspacePath, onChange: (event) => changeWorkspace(event.target.value), disabled: generating || scanning, 'aria-label': tr(t, 'workspace') },
                    workspaces.map((workspace) => h('option', { key: workspace.id, value: workspace.path }, workspace.title)))),
                h('label', { className: 'kc-field' },
                  h('span', { className: 'kc-field-label' }, tr(t, 'targetLibrary')),
                  h('select', { className: 'kc-input kc-select', value: collectionId, onChange: (event) => setCollectionId(event.target.value), disabled: generating },
                    h('option', { value: '' }, tr(t, 'chooseWorkspace')),
                    availableCollections.map((collection) => h('option', { key: collection.id, value: collection.id }, `${collection.name} (${collection.entryCount})`)))),
                h('label', { className: 'kc-field' },
                  h('span', { className: 'kc-field-label' }, tr(t, 'language')),
                  h('select', { className: 'kc-input', value: language, onChange: (event) => setLanguage(event.target.value), disabled: generating },
                    h('option', { value: 'zh' }, tr(t, 'langZh')),
                    h('option', { value: 'en' }, tr(t, 'langEn')))),
                h('div', { className: 'kc-toolbar-spacer' }),
                h('button', { type: 'button', className: 'kc-btn', onClick: scan, disabled: scanning || generating }, scanning ? `${tr(t, 'scanning')}` : scanResult === null ? tr(t, 'scan') : tr(t, 'rescan'))),
              h('div', { className: 'kc-muted', style: { fontSize: '11px', lineHeight: '17px' } }, tr(t, 'generateHint'))),
        scanError === null ? null : h('div', { className: 'kc-error' }, `${tr(t, 'errorPrefix')}${scanError}`),
        !scanIsCurrent
          ? null
          : h('div', { className: 'kc-card' },
              h('div', { className: 'kc-row-between' },
                h('span', { className: 'kc-muted' }, tr(t, 'filesFound', { count: scannedFiles.length })),
                h('div', { className: 'kc-row' },
                  h('button', { type: 'button', className: 'kc-btn kc-btn-small', disabled: generating, onClick: () => setSelected(scannedFiles.map((file) => file.path)) }, tr(t, 'selectAll')),
                  h('button', { type: 'button', className: 'kc-btn kc-btn-small', disabled: generating, onClick: () => setSelected([]) }, tr(t, 'clearSelection')))),
              scanResult.truncated ? h('div', { className: 'kc-warn' }, tr(t, 'scanTruncatedHint', { count: scannedFiles.length })) : null,
              scannedFiles.length === 0
                ? h(EmptyBox, null, tr(t, 'noFiles'))
                : h('div', { className: 'kc-doclist' },
                    scannedFiles.map((file) => h('label', { key: file.path, className: 'kc-doc' },
                      h('input', {
                        type: 'checkbox',
                        checked: selected.includes(file.path),
                        disabled: generating,
                        onChange: (event) => toggleSelected(file.path, event.target.checked),
                      }),
                      h('span', { className: 'kc-doc-path', title: file.path }, file.path),
                      h('span', { className: 'kc-doc-size' }, formatBytes(file.bytes))))),
              h('div', { className: 'kc-row' },
                h('span', { className: 'kc-muted' }, tr(t, 'selectedCount', { count: selectedCount })),
                h('div', { className: 'kc-toolbar-spacer' }),
                generating
                  ? h('button', { type: 'button', className: 'kc-btn kc-btn-danger', onClick: cancelGeneration }, tr(t, 'cancelGeneration'))
                  : h('button', { type: 'button', className: 'kc-btn kc-btn-primary', disabled: selectedCount === 0 || collectionId === '', onClick: generate }, tr(t, 'generate', { count: selectedCount })))),
        generating
          ? h('div', { className: 'kc-card' },
              h('div', { className: 'kc-row-between' },
                h('span', { className: 'kc-row' }, h(Spinner), h('span', null, tr(t, 'generating'))),
                h('span', { className: 'kc-muted' }, tr(t, 'progress', { done: progress.done, total: progress.total }))),
              h('div', { className: 'kc-progress' },
                h('div', { className: 'kc-progress-bar' },
                  h('div', { className: 'kc-progress-fill', role: 'progressbar', 'aria-label': tr(t, 'generating'), 'aria-valuemin': 0, 'aria-valuemax': progress.total, 'aria-valuenow': progress.done, style: { width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%` } }))))
          : null,
        h(Notice, { kind: 'ok', text: notice }),
        runs.length === 0
          ? null
          : h('div', { className: 'kc-card' },
              h('div', { className: 'kc-row-between' },
                h('span', { className: 'kc-muted' }, `${tr(t, 'entryCount', { count: doneCount })} · ${failedCount}`),
                null),
              h('div', { className: 'kc-run-list' },
                runs.map((run, runIndex) => h('div', { key: `${run.path}-${runIndex}`, className: 'kc-run' },
                  h('span', { className: 'kc-run-status' }, run.status === 'done' ? '✓' : run.status === 'error' ? '✗' : run.status === 'running' ? '…' : '·'),
                  h('span', { className: 'kc-run-path' },
                    h('div', null, run.path),
                    run.message === '' ? null : h('div', { className: run.status === 'error' ? 'kc-error' : 'kc-muted', style: { fontSize: '11px' } }, run.message))))))
      )
    }

    // ──────────────────────────────────────────────────────────────────────
    // Access & settings tab
    // ──────────────────────────────────────────────────────────────────────

    function PermissionsTab({ ctx, t, library }) {
      const { data, loading, error, reload } = library
      const [pendingPaths, setPendingPaths] = useState([])
      const permissionPendingRef = useRef(new Set())
      const [notice, setNotice] = useState(null)
      const [errorNotice, setErrorNotice] = useState(null)
      const [settingsNotice, setSettingsNotice] = useState(null)
      const [shareError, setShareError] = useState(null)
      const [shareNotice, setShareNotice] = useState(null)
      const [shareName, setShareName] = useState('')
      const [creatingShare, setCreatingShare] = useState(false)
      const shareCreationRef = useRef(false)
      const [pendingShares, setPendingShares] = useState([])
      const sharePendingRef = useRef(new Set())
      const sharedCollections = (data?.collections ?? []).filter((collection) => collection.scope === 'shared')

      // The Host owns path identity rules, including Windows case folding and
      // Linux's distinct case-sensitive workspaces.
      const isShared = (collection, workspace) => (collection.readerWorkspaceIds ?? []).includes(String(workspace.id))

      const toggleShare = async (collection, workspace) => {
        const key = `${collection.id}:${workspace.id}`
        if (sharePendingRef.current.has(key)) return
        sharePendingRef.current.add(key)
        const shared = isShared(collection, workspace)
        setPendingShares([...sharePendingRef.current])
        setShareNotice(null)
        setShareError(null)
        try {
          await callRpc(ctx, 'setCollectionShare', {
            collectionId: collection.id,
            workspacePath: workspace.path,
            allowed: !shared,
          })
          setShareNotice(shared ? tr(t, 'shareRevoked') : tr(t, 'shareGranted'))
          await reload()
        } catch (failure) {
          setShareError(errorMessage(failure))
        } finally {
          sharePendingRef.current.delete(key)
          setPendingShares([...sharePendingRef.current])
        }
      }

      const createShared = async () => {
        const name = shareName.trim()
        if (name.length === 0 || shareCreationRef.current) return
        shareCreationRef.current = true
        setCreatingShare(true)
        setShareNotice(null)
        setShareError(null)
        try {
          await callRpc(ctx, 'createCollection', { name, scope: 'shared' })
          setShareName('')
          setShareNotice(tr(t, 'shareCreated'))
          await reload()
        } catch (failure) {
          setShareError(errorMessage(failure))
        } finally {
          shareCreationRef.current = false
          setCreatingShare(false)
        }
      }

      const toggle = async (workspace) => {
        const key = String(workspace.id)
        if (permissionPendingRef.current.has(key)) return
        permissionPendingRef.current.add(key)
        setPendingPaths([...permissionPendingRef.current])
        setNotice(null)
        setErrorNotice(null)
        try {
          await callRpc(ctx, 'setPermission', { workspacePath: workspace.path, allowed: !workspace.allowed })
          setNotice(tr(t, 'permissionUpdated'))
          await reload()
        } catch (failure) {
          setErrorNotice(`${tr(t, 'errorPrefix')}${errorMessage(failure)}`)
        } finally {
          permissionPendingRef.current.delete(key)
          setPendingPaths([...permissionPendingRef.current])
        }
      }

      const changeLanguage = async (value) => {
        try {
          await callRpc(ctx, 'setSetting', { outputLanguage: value })
          setSettingsNotice(tr(t, 'settingSaved'))
          await reload()
        } catch (failure) {
          setErrorNotice(`${tr(t, 'errorPrefix')}${errorMessage(failure)}`)
        }
      }

      const copyDataDir = async () => {
        if (data === null) return
        try {
          await copyText(data.dataDir)
          setNotice(tr(t, 'copied'))
        } catch (failure) {
          setErrorNotice(`${tr(t, 'errorPrefix')}${errorMessage(failure)}`)
        }
      }

      if (loading && data === null) {
        return h('div', { className: 'kc-row' }, h(Spinner), h('span', { className: 'kc-muted' }, tr(t, 'loading')))
      }
      if (data === null) {
        return h('div', { className: 'kc-pane' }, h(ErrorBanner, { message: error, onRetry: reload, t }))
      }

      const workspaces = data.workspaces ?? []
      const language = data.settings !== null && typeof data.settings === 'object' ? data.settings.outputLanguage : 'zh'

      return h('div', { className: 'kc-pane' },
        h(ErrorBanner, { message: error, onRetry: reload, t }),
        h('div', { className: 'kc-card' },
          h('div', { className: 'kc-row-between' },
            h('div', null,
              h('div', { style: { fontWeight: 600, fontSize: '13px' } }, tr(t, 'accessTitle')),
              h('div', { className: 'kc-muted', style: { fontSize: '11px', lineHeight: '17px', maxWidth: '640px' } }, tr(t, 'accessHint'))),
            h('span', { className: 'kc-badge' }, `${data.permissions.length} / ${workspaces.length}`)),
          h(Notice, { kind: 'ok', text: notice }),
          h(Notice, { kind: 'error', text: errorNotice }),
          workspaces.length === 0
            ? h(EmptyBox, null, tr(t, 'noWorkspacesAccess'))
            : h('div', null, workspaces.map((workspace) => h('div', { key: workspace.id, className: 'kc-access-row' },
                h('div', { className: 'kc-access-main' },
                  h('div', { className: 'kc-access-title' },
                    h('span', null, workspace.title),
                    h('span', { className: workspace.allowed ? 'kc-ok' : 'kc-muted', style: { fontSize: '11px' } }, workspace.allowed ? tr(t, 'allowed') : tr(t, 'denied'))),
                  h('div', { className: 'kc-access-path' }, workspace.path)),
                h('button', {
                  type: 'button',
                  className: 'kc-switch',
                  role: 'switch',
                  'aria-checked': workspace.allowed,
                  'aria-label': `${tr(t, 'accessOn')}: ${workspace.title}`,
                  'data-on': workspace.allowed,
                  disabled: pendingPaths.includes(String(workspace.id)),
                  onClick: () => toggle(workspace),
                }))))),
        h('div', { className: 'kc-card' },
          h('div', { className: 'kc-row-between' },
            h('div', null,
              h('div', { style: { fontWeight: 600, fontSize: '13px' } }, tr(t, 'shareTitle')),
              h('div', { className: 'kc-muted', style: { fontSize: '11px', lineHeight: '17px', maxWidth: '640px' } }, tr(t, 'shareHint'))),
            h('span', { className: 'kc-badge' }, `${sharedCollections.length}`)),
          h(Notice, { kind: 'ok', text: shareNotice }),
          h(Notice, { kind: 'error', text: shareError }),
          sharedCollections.length === 0
            ? h(EmptyBox, null, tr(t, 'shareEmpty'))
            : h('div', null, sharedCollections.map((collection) => h('div', { key: collection.id, style: { padding: '8px 0' } },
                h('div', { className: 'kc-row-between' },
                  h('div', { style: { fontWeight: 600 } }, collection.name),
                  h('span', { className: 'kc-muted', style: { fontSize: '11px' } }, `${(collection.readers ?? []).length} / ${workspaces.length}`)),
                h('div', { className: 'kc-row', style: { flexWrap: 'wrap', gap: '6px', marginTop: '6px' } }, workspaces.map((workspace) => {
                  const shared = isShared(collection, workspace)
                  return h('button', {
                    key: workspace.id,
                    type: 'button',
                    className: 'kc-btn kc-btn-small',
                    'data-on': shared,
                    'aria-pressed': shared,
                    disabled: pendingShares.includes(`${collection.id}:${workspace.id}`),
                    onClick: () => toggleShare(collection, workspace),
                  }, `${workspace.title}${shared ? ' ✓' : ''}`)
                }))))),
          h('div', { className: 'kc-row', style: { marginTop: '10px' } },
            h('input', { className: 'kc-input', placeholder: tr(t, 'shareCreatePlaceholder'), 'aria-label': tr(t, 'shareCreatePlaceholder'), value: shareName, maxLength: 80, disabled: creatingShare, onChange: (event) => setShareName(event.target.value) }),
            h('button', { type: 'button', className: 'kc-btn kc-btn-small', disabled: shareName.trim().length === 0 || creatingShare, onClick: createShared }, tr(t, 'shareCreate')))),        h('div', { className: 'kc-card' },
          h('div', { style: { fontWeight: 600, fontSize: '13px' } }, tr(t, 'stats')),
          h('dl', { className: 'kc-kv' },
            h('dt', null, tr(t, 'entryTotal', { count: data.totals.entries })),
            h('dd', null, `${data.totals.entries}`),
            h('dt', null, tr(t, 'collectionTotal', { count: data.totals.collections })),
            h('dd', null, `${data.totals.collections}`),
            h('dt', null, tr(t, 'defaultModel')),
            h('dd', null, data.model === 'unavailable' ? tr(t, 'noModel') : data.model),
            h('dt', null, tr(t, 'dataDir')),
            h('dd', null, h('div', { className: 'kc-row' },
              h('code', { className: 'kc-tool-chip' }, data.dataDir),
              h('button', { type: 'button', className: 'kc-btn kc-btn-small', onClick: copyDataDir }, tr(t, 'copyPath')))),
            h('dt', null, tr(t, 'language')),
            h('dd', null, h('select', { className: 'kc-input', value: language, onChange: (event) => changeLanguage(event.target.value) },
              h('option', { value: 'zh' }, tr(t, 'langZh')),
              h('option', { value: 'en' }, tr(t, 'langEn')))),
            h('dt', null, tr(t, 'modelTools')),
            h('dd', null, h('div', { className: 'kc-tools' }, (data.tools ?? []).map((tool) => h('span', { key: tool, className: 'kc-tool-chip' }, tool))))),
          h(Notice, { kind: 'ok', text: settingsNotice }),
          h('div', { className: 'kc-muted', style: { fontSize: '11px', lineHeight: '17px' } }, tr(t, 'permissionDeniedHint'))),
        h('div', { className: 'kc-card' },
          h('div', { style: { fontWeight: 600, fontSize: '13px' } }, tr(t, 'aboutTitle')),
          h('div', { className: 'kc-muted', style: { fontSize: '11px', lineHeight: '17px' } }, tr(t, 'aboutText'))))
    }

    // ──────────────────────────────────────────────────────────────────────
    // Knowledge glyph + full-page panel
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Outline knowledge glyph (open book + spark) used for the sidebar panel
     * entry and the full-page heading. Inherits the current text color, so the
     * sidebar owns hover/selection coloring. `size` is supplied by the
     * sidebar.panellist owner row; `active` is accepted but the row styling
     * already carries selection.
     */
    function KnowledgeCenterGlyph({ size = 16 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
        focusable: 'false',
        stroke: 'currentColor',
        strokeWidth: 1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
        h('path', { d: 'M1.8 3.2c1.05-.5 2.25-.55 3.35-.15.95.34 1.75 1 2.25 1.9v8.25c-.5-.9-1.3-1.55-2.25-1.9-1.1-.4-2.3-.35-3.35.15V3.2z' }),
        h('path', { d: 'M14.2 3.2c-1.05-.5-2.25-.55-3.35-.15-.95.34-1.75 1-2.25 1.9v8.25c.5-.9 1.3-1.55 2.25-1.9 1.1-.4 2.3-.35 3.35.15V3.2z' }),
        h('path', { d: 'M8 5v8.2' }),
        h('path', { d: 'M12.55.9l.32.78.78.32-.78.32-.32.78-.32-.78-.78-.32.78-.32.32-.78z', fill: 'currentColor', stroke: 'none' })
      )
    }

    /** Full-page Knowledge Center panel opened from the sidebar icon. */
    function KnowledgeCenterPage({ ctx, t }) {
      return h('div', { className: 'kc-page' },
        h('div', { className: 'kc-page-content' },
          h('div', { className: 'kc-page-heading' },
            h('span', { className: 'kc-page-heading-icon' }, h(KnowledgeCenterGlyph, { size: 22 })),
            h('div', { className: 'kc-page-heading-text' },
              h('h1', null, tr(t, 'title')),
              h('div', { className: 'kc-page-subtitle kc-muted' }, tr(t, 'subtitle')))),
          h('div', { className: 'kc-page-body' },
            h(KnowledgeCenterSection, { ctx, t, chromeless: true }))))
    }

    // ──────────────────────────────────────────────────────────────────────
    // Root settings section
    // ──────────────────────────────────────────────────────────────────────

    function KnowledgeCenterSection({ ctx, t, chromeless = false }) {
      const [tab, setTab] = useState('library')
      const [sectionId] = useState(() => `kc-section-${++sectionSequence}`)
      const [, setLocaleRevision] = useState(0)
      const library = useLibrary(ctx)

      useEffect(() => {
        if (ctx.locale === undefined || typeof ctx.locale.subscribe !== 'function') return undefined
        const unsubscribe = ctx.locale.subscribe(() => setLocaleRevision((value) => value + 1))
        return () => {
          if (typeof unsubscribe === 'function') unsubscribe()
        }
      }, [ctx])

      const tabs = [
        { id: 'library', label: tr(t, 'tabLibrary') },
        { id: 'generate', label: tr(t, 'tabGenerate') },
        { id: 'access', label: tr(t, 'tabAccess') },
      ]
      const recovery = library.data?.storageRecovery
      const hasRecovery = (typeof recovery === 'string' && recovery.trim() !== '')
        || (recovery !== null && typeof recovery === 'object')

      const navigateTabs = (event, index) => {
        let target
        if (event.key === 'ArrowRight') target = (index + 1) % tabs.length
        else if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length
        else if (event.key === 'Home') target = 0
        else if (event.key === 'End') target = tabs.length - 1
        else return
        event.preventDefault()
        setTab(tabs[target].id)
        event.currentTarget.parentElement?.querySelector(`#${sectionId}-tab-${tabs[target].id}`)?.focus()
      }

      return h('div', { className: 'kc-root' },
        h('style', { key: 'kc-styles' }, CSS),
        chromeless ? null : h('div', { className: 'kc-header' },
          h('div', { className: 'kc-title' }, tr(t, 'title')),
          h('div', { className: 'kc-subtitle kc-muted' }, tr(t, 'subtitle'))),
        hasRecovery ? h('div', { className: 'kc-card' },
          h(Notice, { kind: 'warn', text: tr(t, 'storageRecovered') }),
          h('div', null, h('button', { type: 'button', className: 'kc-btn', onClick: () => setTab('access') }, tr(t, 'tabAccess')))) : null,
        h('div', { className: 'kc-tabs', role: 'tablist', 'aria-label': tr(t, 'title') },
          tabs.map((item, index) => h('button', {
            key: item.id,
            id: `${sectionId}-tab-${item.id}`,
            type: 'button',
            role: 'tab',
            'aria-selected': tab === item.id,
            'aria-controls': `${sectionId}-panel-${item.id}`,
            tabIndex: tab === item.id ? 0 : -1,
            className: `kc-tab${tab === item.id ? ' kc-tab-active' : ''}`,
            onClick: () => setTab(item.id),
            onKeyDown: (event) => navigateTabs(event, index),
          }, item.label))),
        h('div', { className: 'kc-panes' },
          h('div', { className: 'kc-pane', id: `${sectionId}-panel-library`, role: 'tabpanel', 'aria-labelledby': `${sectionId}-tab-library`, hidden: tab !== 'library', tabIndex: 0, style: { display: tab === 'library' ? 'flex' : 'none' } },
            h(LibraryTab, { ctx, t, library })),
          h('div', { className: 'kc-pane', id: `${sectionId}-panel-generate`, role: 'tabpanel', 'aria-labelledby': `${sectionId}-tab-generate`, hidden: tab !== 'generate', tabIndex: 0, style: { display: tab === 'generate' ? 'flex' : 'none' } },
            h(GenerateTab, { ctx, t, library })),
          h('div', { className: 'kc-pane', id: `${sectionId}-panel-access`, role: 'tabpanel', 'aria-labelledby': `${sectionId}-tab-access`, hidden: tab !== 'access', tabIndex: 0, style: { display: tab === 'access' ? 'flex' : 'none' } },
            h(PermissionsTab, { ctx, t, library }))))
    }

    // ──────────────────────────────────────────────────────────────────────
    // Client plugin
    // ──────────────────────────────────────────────────────────────────────

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'knowledge-center: dictionaries')
      const t = ctx.locale.bind(NS)
      // Settings page (Settings → 知识中心). The Settings shell hardcodes nav
      // icons and falls back to a gear for third-party sections in this Harness
      // version, so the visible knowledge glyph lives on the supported
      // sidebar.panellist entry below.
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'knowledge-center',
        order: 17,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ ctx, t }),
      }, KnowledgeCenterSection))
      // Full-page panel opened by the sidebar icon (Qoder-style entry point).
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'knowledge-center',
        locale: NS,
        inject: () => ({ ctx, t }),
      }, KnowledgeCenterPage))
      // Global panel icon; the sidebar owns the button, tooltip, label and
      // selection state, and passes `size`/`active` to the glyph.
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'knowledge-center',
        order: 20,
        locale: NS,
        label: () => t('nav'),
      }, KnowledgeCenterGlyph))
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply,
    }
  },
})

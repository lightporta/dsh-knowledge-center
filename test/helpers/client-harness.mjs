import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const clientUrl = new URL('../../client.js', import.meta.url)

export function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export function textContent(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (typeof node !== 'object') return String(node)
  return textContent(node.children)
}

function sameDependencies(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]))
}

/**
 * Run the unmodified browser bundle with persistent React-style hook state.
 * The harness executes component effects and public event handlers; tests never
 * reach into component state slots or expose private functions from the bundle.
 * It intentionally does not simulate DOM layout, painting or browser events.
 */
export function mountClient({ state, rpc, language = 'en' }) {
  const instances = new Map()
  const dictionaries = new Map()
  const registrations = []
  const calls = []
  const localeListeners = new Set()
  let current = null
  let dirty = true
  let tree = null
  let mounted = true
  let pendingEffects = []
  let timerClock = 0
  let timerId = 0
  const timers = new Map()

  function scheduleTimer(callback, delay = 0) {
    const id = ++timerId
    timers.set(id, { callback, due: timerClock + Math.max(0, Number(delay)) })
    return id
  }

  function hook(initializer) {
    assert.ok(current, 'hook called outside a component')
    const instance = current
    const index = instance.cursor++
    if (!(index in instance.hooks)) instance.hooks[index] = initializer()
    return instance.hooks[index]
  }

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      const instance = current
      const cell = hook(() => ({ value: typeof initial === 'function' ? initial() : initial }))
      if (cell.set === undefined) {
        cell.set = (next) => {
          if (!mounted || !instance.active) return
          const value = typeof next === 'function' ? next(cell.value) : next
          if (!Object.is(value, cell.value)) {
            cell.value = value
            dirty = true
          }
        }
      }
      return [cell.value, cell.set]
    },
    useRef(initial) {
      return hook(() => ({ current: initial }))
    },
    useMemo(factory, dependencies) {
      const cell = hook(() => ({}))
      if (!sameDependencies(cell.dependencies, dependencies)) {
        cell.value = factory()
        cell.dependencies = dependencies
      }
      return cell.value
    },
    useCallback(callback, dependencies) {
      return React.useMemo(() => callback, dependencies)
    },
    useEffect(effect, dependencies) {
      const cell = hook(() => ({}))
      if (!sameDependencies(cell.dependencies, dependencies)) {
        cell.dependencies = dependencies
        pendingEffects.push(() => {
          cell.cleanup?.()
          cell.cleanup = effect()
        })
      }
    },
  }

  const context = {
    effect(effect) { return effect() },
    locale: {
      register(namespace, values) {
        dictionaries.set(namespace, values)
        return () => dictionaries.delete(namespace)
      },
      bind(namespace) {
        return (key) => dictionaries.get(namespace)?.[language]?.[key] ?? key
      },
      subscribe(callback) {
        localeListeners.add(callback)
        return () => localeListeners.delete(callback)
      },
    },
    slots: {
      inject(_name, callback) { return callback() },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    get(name) {
      assert.equal(name, 'connection')
      return {
        rpc: {
          async call(channel, method, params, signal) {
            calls.push({ channel, method, params, signal })
            if (method === 'state') return { ok: true, value: state }
            const value = await rpc(method, params, signal)
            return { ok: true, value }
          },
        },
      }
    },
  }

  let definition
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { definition = value } } },
    AbortController,
    setTimeout: scheduleTimer,
    clearTimeout(id) { timers.delete(id) },
    console,
  }
  vm.runInNewContext(readFileSync(clientUrl, 'utf8'), sandbox, { filename: 'client.js' })
  const plugin = definition.factory((name) => {
    assert.equal(name, 'react')
    return React
  })
  plugin.apply(context)
  const Section = registrations.find(({ options }) => options.name === 'settings.section').component
  const t = context.locale.bind('knowledge-center')

  function renderNode(node, path, visited) {
    if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${path}.${index}`, visited))
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      let instance = instances.get(path)
      if (instance?.type !== node.type) {
        instance = { type: node.type, hooks: [], active: true }
        instances.set(path, instance)
      }
      visited.add(path)
      instance.cursor = 0
      const previous = current
      current = instance
      let rendered
      try {
        rendered = node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children })
      } finally {
        current = previous
      }
      return renderNode(rendered, `${path}.render`, visited)
    }
    return {
      ...node,
      children: node.children.map((child, index) => renderNode(child, `${path}.${index}`, visited)),
    }
  }

  function render() {
    dirty = false
    pendingEffects = []
    const visited = new Set()
    tree = renderNode(React.createElement(Section, { ctx: context, t }), 'root', visited)
    for (const [path, instance] of instances) {
      if (visited.has(path)) continue
      instance.active = false
      for (const cell of instance.hooks) cell.cleanup?.()
      instances.delete(path)
    }
    for (const effect of pendingEffects) effect()
  }

  function nodes(predicate) {
    const found = []
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit)
      if (node === null || typeof node !== 'object') return
      if (predicate(node)) found.push(node)
      visit(node.children)
    }
    visit(tree)
    return found
  }

  return {
    calls,
    emitLocaleChange() {
      for (const listener of localeListeners) listener()
    },
    advanceTime(milliseconds) {
      const target = timerClock + milliseconds
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= target)
          .sort(([leftId, left], [rightId, right]) => left.due - right.due || leftId - rightId)[0]
        if (next === undefined) break
        const [id, timer] = next
        timerClock = timer.due
        timers.delete(id)
        timer.callback()
      }
      timerClock = target
    },
    get tree() { return tree },
    nodes,
    button(label) {
      const found = nodes((node) => node.type === 'button' && textContent(node) === label)
      assert.ok(found.length > 0, `button not found: ${label}`)
      return found[0]
    },
    entry(title) {
      const found = nodes((node) => node.type === 'button' && node.props.className === 'kc-entry'
        && textContent(node).includes(title))
      assert.equal(found.length, 1, `expected one entry: ${title}`)
      return found[0]
    },
    click(node) {
      assert.notEqual(node.props.disabled, true, `cannot click disabled control: ${textContent(node)}`)
      return node.props.onClick()
    },
    async flush() {
      // Draining microtasks also settles the bundle's async RPC/.finally chains.
      for (let turn = 0; turn < 20; turn++) {
        if (dirty && mounted) render()
        await Promise.resolve()
      }
      assert.equal(dirty && mounted, false, 'component did not settle')
    },
    unmount() {
      mounted = false
      for (const instance of instances.values()) {
        instance.active = false
        for (const cell of instance.hooks) cell.cleanup?.()
      }
      instances.clear()
      timers.clear()
    },
  }
}

/**
 * Browser bundle wiring test.
 *
 * The client half is a plain-JavaScript `window.__ModuleLoader__` factory, so
 * it can be evaluated in Node with a minimal React stand-in. These tests guard
 * the package-private contract: the plugin shape, locale registration and the
 * three slot contributions (Settings page, full-page panel, sidebar icon).
 * Run with: node --test
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const fakeReact = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useMemo(factory) {
    return factory()
  },
  useRef(value) {
    return { current: value }
  },
  useCallback(callback) {
    return callback
  },
}

function loadClientPlugin() {
  let captured
  const previousWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        captured = definition
      },
    },
  }
  try {
    vm.runInThisContext(readFileSync(resolve(root, 'client.js'), 'utf8'), { filename: 'client.js' })
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
  assert.ok(captured, 'client bundle did not call window.__ModuleLoader__.load')
  return captured.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected client module request: ${name}`)
  })
}

function applyWithStubs(plugin) {
  const registrations = []
  const locales = {}
  const ctx = {
    effect(callback) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    locale: {
      register(namespace, dictionaries) {
        locales[namespace] = dictionaries
        return () => {}
      },
      bind() {
        return (key) => key
      },
    },
    slots: {
      inject(_slot, callback) {
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  return { registrations, locales }
}

test('client bundle exposes the expected plugin shape', () => {
  const plugin = loadClientPlugin()
  assert.deepEqual(plugin.inject, ['slots', 'locale', 'connection'])
  assert.equal(typeof plugin.apply, 'function')
})

test('client bundle registers dictionaries and all three entry points', () => {
  const { registrations, locales } = applyWithStubs(loadClientPlugin())
  assert.ok(locales['knowledge-center'].zh, 'zh dictionary registered')
  assert.ok(locales['knowledge-center'].en, 'en dictionary registered')
  const bySlot = new Map(registrations.map((registration) => [registration.options.name, registration]))
  assert.equal(bySlot.get('settings.section').options.id, 'knowledge-center')
  assert.equal(bySlot.get('settings.section').options.order, 17)
  assert.equal(bySlot.get('main').options.key, 'knowledge-center')
  assert.equal(bySlot.get('sidebar.panellist').options.id, 'knowledge-center')
  assert.equal(typeof bySlot.get('sidebar.panellist').options.label, 'function')
})

test('sidebar icon is an accessible decorative 16px book glyph', () => {
  const { registrations } = applyWithStubs(loadClientPlugin())
  const icon = registrations.find((registration) => registration.options.name === 'sidebar.panellist').component
  const rendered = icon({ size: 16, active: true })
  assert.equal(rendered.type, 'svg')
  assert.equal(rendered.props.width, 16)
  assert.equal(rendered.props.height, 16)
  assert.equal(rendered.props.viewBox, '0 0 16 16')
  assert.equal(rendered.props['aria-hidden'], 'true')
  assert.ok(rendered.children.length >= 4, 'book pages, spine and spark paths')
})

test('full-page panel renders its own page shell', () => {
  const { registrations } = applyWithStubs(loadClientPlugin())
  const page = registrations.find((registration) => registration.options.name === 'main').component
  const rendered = page({ ctx: {}, t: (key) => key })
  assert.equal(rendered.type, 'div')
  assert.equal(rendered.props.className, 'kc-page')
})

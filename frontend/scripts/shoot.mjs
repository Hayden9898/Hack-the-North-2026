#!/usr/bin/env node
/*
 * Screenshot harness for the design-review loop.
 *
 * Drives a headless Chrome over the DevTools Protocol so we can set the theme, emulate a
 * viewport, and capture full-page PNGs without any extra dependencies.
 *
 *   node scripts/shoot.mjs <outDir> [baseUrl]
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const OUT = process.argv[2] ?? '/tmp/shots'
const BASE = process.argv[3] ?? 'http://127.0.0.1:5173'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, scale: 2, mobile: false },
  { name: 'mobile', width: 390, height: 844, scale: 2, mobile: true },
]
const THEMES = ['dark', 'light']
const PAGES = (process.env.SHOOT_PAGES ?? '/:landing').split(',').map((p) => {
  // `lastIndexOf` returns -1 when the spec has no `:name` suffix, and `slice(0, -1)` would
  // silently drop the last character of the path ('/app' -> '/ap', which 404s and screenshots
  // the wrong page under a plausible filename). Treat a missing suffix as "derive the name".
  const i = p.lastIndexOf(':')
  if (i === -1) return { path: p, name: p.replace(/^\/+|\/+$/g, '').replace(/\W+/g, '-') || 'root' }
  return { path: p.slice(0, i), name: p.slice(i + 1) }
})

mkdirSync(OUT, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--user-data-dir=/tmp/lo-shot-profile',
  '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' })

let ws
try {
  // Wait for the debugger endpoint.
  let target
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      target = list.find((t) => t.type === 'page')
      if (target) break
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  if (!target) throw new Error('chrome devtools endpoint never came up')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('ws failed'))
  })

  let id = 0
  const pending = new Map()
  const events = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    } else if (msg.method) {
      events.push(msg.method)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id
      pending.set(n, { resolve, reject })
      ws.send(JSON.stringify({ id: n, method, params }))
    })

  await send('Page.enable')
  await send('Runtime.enable')

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      for (const page of PAGES) {
        await send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: vp.scale,
          mobile: vp.mobile,
        })
        // Seed the theme before the app boots so there is no flash or wrong-theme capture.
        await send('Page.addScriptToEvaluateOnNewDocument', {
          source: `try{localStorage.setItem('logorder.theme','${theme}')}catch(e){}`,
        })
        await send('Page.navigate', { url: BASE + page.path })
        await sleep(1400)
        // Settle scroll-triggered reveals by walking the page, then return to the top.
        await send('Runtime.evaluate', {
          expression: `(async()=>{const h=document.body.scrollHeight;for(let y=0;y<h;y+=400){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60))}window.scrollTo(0,0);await new Promise(r=>setTimeout(r,350))})()`,
          awaitPromise: true,
        })
        const { data } = await send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
        })
        const file = `${OUT}/${page.name}-${vp.name}-${theme}.png`
        writeFileSync(file, Buffer.from(data, 'base64'))
        console.log(`shot ${file}`)
      }
    }
  }

  const errors = events.filter((e) => e.includes('exceptionThrown'))
  if (errors.length) console.log(`page exceptions: ${errors.length}`)
} finally {
  try { ws?.close() } catch { /* already gone */ }
  chrome.kill()
}

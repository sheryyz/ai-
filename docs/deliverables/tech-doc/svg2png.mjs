// figs/*.svg → figs-png/*.png at 3x for the Word document (Word's SVG support is uneven).
//   node docs/deliverables/tech-doc/svg2png.mjs
import { mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const out = join(HERE, 'figs-png')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 3 })
for (const f of readdirSync(join(HERE, 'figs')).filter((n) => n.endsWith('.svg'))) {
  await page.goto(pathToFileURL(join(HERE, 'figs', f)).href)
  const [w, h] = await page.evaluate(() => {
    const s = document.querySelector('svg')
    return [s.width.baseVal.value, s.height.baseVal.value]
  })
  await page.setViewportSize({ width: Math.ceil(w), height: Math.ceil(h) })
  await page.screenshot({ path: join(out, f.replace('.svg', '.png')), clip: { x: 0, y: 0, width: w, height: h } })
  console.log(f, w, h)
}
await browser.close()

#!/usr/bin/env node
/**
 * export_deck_pptx.mjs —  slide deck  PPTX
 *
 * Usage:
 *   node export_deck_pptx.mjs --slides <dir> --out <file.pptx>
 *
 * ：
 *   -  scripts/html2pptx.js  HTML DOM  PowerPoint 
 *   - ，PPT 
 *   - body  960pt × 540pt（LAYOUT_WIDE，13.333″ × 7.5″）
 *
 * ⚠️ HTML  4 items（ references/editable-pptx.md）：
 *   1.  <p>/<h1>-<h6> （div ）
 *   2.  CSS 
 *   3. <p>/<h*>  background/border/shadow（ div）
 *   4. div  background-image（ <img>）
 *
 *  HTML  pass ——  HTML 。
 * （、web component、CSS 、 SVG）
 *  export_deck_pdf.mjs / export_deck_stage_pdf.mjs  PDF。
 *
 * Dependencies:npm install playwright pptxgenjs sharp
 *
 * （01-xxx.html → 02-xxx.html → ...）。
 */

import pptxgen from 'pptxgenjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, '');
    args[k] = a[i + 1];
  }
  if (!args.slides || !args.out) {
    console.error('Usage: node export_deck_pptx.mjs --slides <dir> --out <file.pptx>');
    console.error('');
    console.error('⚠️ HTML  4 items（ references/editable-pptx.md）。');
    console.error('    export_deck_pdf.mjs  PDF。');
    process.exit(1);
  }
  return args;
}

async function main() {
  const { slides, out } = parseArgs();
  const slidesDir = path.resolve(slides);
  const outFile = path.resolve(out);

  const files = (await fs.readdir(slidesDir))
    .filter(f => f.endsWith('.html'))
    .sort();
  if (!files.length) {
    console.error(`No .html files found in ${slidesDir}`);
    process.exit(1);
  }

  console.log(`Converting ${files.length} slides via html2pptx...`);

  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  let html2pptx;
  try {
    html2pptx = require(path.join(__dirname, 'html2pptx.js'));
  } catch (e) {
    console.error(`✗  html2pptx.js ：${e.message}`);
    console.error(`  ：npm install playwright pptxgenjs sharp`);
    process.exit(1);
  }

  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';  // 13.333 × 7.5 inch， HTML body 960 × 540 pt

  const errors = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const fullPath = path.join(slidesDir, f);
    try {
      await html2pptx(fullPath, pres);
      console.log(`  [${i + 1}/${files.length}] ${f} ✓`);
    } catch (e) {
      console.error(`  [${i + 1}/${files.length}] ${f} ✗  ${e.message}`);
      errors.push({ file: f, error: e.message });
    }
  }

  if (errors.length) {
    console.error(`\n⚠️ ${errors.length}  slide 。：HTML  4 items。`);
    console.error(`   references/editable-pptx.md 「」。`);
    if (errors.length === files.length) {
      console.error(`✗ ， PPTX。`);
      process.exit(1);
    }
  }

  await pres.writeFile({ fileName: outFile });
  console.log(`\n✓ Wrote ${outFile}  (${files.length - errors.length}/${files.length} slides,  PPTX)`);
}

main().catch(e => { console.error(e); process.exit(1); });

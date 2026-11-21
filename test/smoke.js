const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file:///home/user/pixora/index.html');
  const png = async color => Buffer.from((await p.evaluate(c => { const k=document.createElement('canvas'); k.width=k.height=200; const x=k.getContext('2d'); x.fillStyle=c; x.fillRect(0,0,200,200); return k.toDataURL('image/png'); }, color)).split(',')[1], 'base64');
  await p.setInputFiles('#file', [
    { name: 'red.png', mimeType: 'image/png', buffer: await png('#f00') },
    { name: 'blue.png', mimeType: 'image/png', buffer: await png('#00f') } ]);
  await p.waitForFunction(() => document.querySelectorAll('#layers li').length === 2);
  const px = () => p.evaluate(() => Array.from(document.getElementById('c').getContext('2d').getImageData(640,360,1,1).data));
  // blue loaded last -> on top
  let c = await px(); assert.deepStrictEqual([c[0],c[2]], [0,255], 'blue should be on top');
  // list is top-first; move top item (blue) back one -> red on top
  await p.click('#layers li:first-child button[aria-label="뒤로"]');
  c = await px(); assert.deepStrictEqual([c[0],c[2]], [255,0], 'red should be on top after reorder');
  // ratio
  await p.selectOption('#ratio', '9:16');
  assert.deepStrictEqual(await p.evaluate(() => [c.width, c.height]), [720, 1280]);
  // export webp
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#save')]);
  assert.strictEqual(dl.suggestedFilename(), 'thumbnail.webp');
  const buf = require('fs').readFileSync(await dl.path());
  assert.strictEqual(buf.slice(0,4).toString(), 'RIFF'); assert.strictEqual(buf.slice(8,12).toString(), 'WEBP');
  assert.deepStrictEqual(errs, []);
  console.log('OK'); await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

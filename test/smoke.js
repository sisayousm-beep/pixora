// 스모크 테스트: node test/smoke.js (Playwright 필요)
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));

  const png = async color => Buffer.from((await page.evaluate(c => {
    const k = document.createElement('canvas'); k.width = k.height = 200;
    const x = k.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 200, 200);
    return k.toDataURL('image/png');
  }, color)).split(',')[1], 'base64');
  const pixel = (x, y) => page.evaluate(([x, y]) =>
    Array.from(document.getElementById('c').getContext('2d').getImageData(x, y, 1, 1).data), [x, y]);

  await page.setInputFiles('#file', [
    { name: 'red.png', mimeType: 'image/png', buffer: await png('#f00') },
    { name: 'blue.png', mimeType: 'image/png', buffer: await png('#00f') },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#layers li').length === 2);

  // 나중에 불러온 파랑이 맨 위
  let c = await pixel(640, 360);
  assert.deepStrictEqual([c[0], c[2]], [0, 255], 'blue on top');

  // 목록 맨 위(파랑)를 뒤로 -> 빨강이 맨 위
  await page.click('#layers li:first-child button[aria-label="뒤로"]');
  c = await pixel(640, 360);
  assert.deepStrictEqual([c[0], c[2]], [255, 0], 'red on top after reorder');

  // 마우스로 끌어서 이동: 캔버스 중앙을 잡고 왼쪽으로 옮기면 중앙이 비게 됨
  const box = await page.locator('#c').boundingBox();
  const scale = box.width / 1280;
  await page.mouse.move(box.x + 640 * scale, box.y + 360 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 300 * scale, box.y + 360 * scale, { steps: 5 });
  await page.mouse.up();
  c = await pixel(300, 360);
  assert.deepStrictEqual([c[0], c[2]], [255, 0], 'red moved left');

  // 비율 변경
  await page.selectOption('#ratio', '9:16');
  assert.deepStrictEqual(await page.evaluate(() => [c.width, c.height]), [720, 1280]);

  // WebP 저장
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  assert.strictEqual(download.suggestedFilename(), 'thumbnail.webp');
  const buf = fs.readFileSync(await download.path());
  assert.strictEqual(buf.subarray(0, 4).toString(), 'RIFF');
  assert.strictEqual(buf.subarray(8, 12).toString(), 'WEBP');

  assert.deepStrictEqual(errors, []);
  console.log('OK');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

// 스모크 테스트: node test/smoke.js (Playwright 필요)
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
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
  const top = async (x, y) => { const c = await pixel(x, y); return c[0] === 255 ? 'red' : c[2] === 255 ? 'blue' : 'none'; };

  await page.setInputFiles('#file', [
    { name: 'red.png', mimeType: 'image/png', buffer: await png('#f00') },
    { name: 'blue.png', mimeType: 'image/png', buffer: await png('#00f') },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#layers li').length === 2);

  // 나중에 불러온 파랑이 맨 위, 선택된 상태
  assert.strictEqual(await top(640, 360), 'blue');
  assert.strictEqual(await page.inputValue('#pw'), '200');

  // 뒤로 -> 빨강이 맨 위, 실행 취소 -> 다시 파랑
  await page.click('#back');
  assert.strictEqual(await top(640, 360), 'red');
  await page.click('#undo');
  assert.strictEqual(await top(640, 360), 'blue');
  await page.click('#redo');
  assert.strictEqual(await top(640, 360), 'red');

  // 마우스로 끌어서 이동 (빨강 선택)
  const box = await page.locator('#c').boundingBox();
  const s = box.width / 1280;
  await page.mouse.move(box.x + 640 * s, box.y + 360 * s);
  await page.mouse.down();
  await page.mouse.move(box.x + 300 * s, box.y + 360 * s, { steps: 5 });
  await page.mouse.up();
  assert.strictEqual(await top(300, 360), 'red');
  assert.strictEqual(await page.inputValue('#px'), '200');

  // 숫자 입력: W를 400으로 -> H도 비율 유지로 400
  await page.fill('#pw', '400');
  await page.press('#pw', 'Enter');
  assert.strictEqual(await page.inputValue('#ph'), '400');

  // 오른쪽 아래 모서리를 끌어 크기 조절 (현재 빨강: x200 y260 400x400 -> 모서리 600,660)
  await page.mouse.move(box.x + 600 * s, box.y + 660 * s);
  await page.mouse.down();
  await page.mouse.move(box.x + 700 * s, box.y + 660 * s, { steps: 5 });
  await page.mouse.up();
  assert.strictEqual(await page.inputValue('#pw'), '500');
  assert.strictEqual(await page.inputValue('#ph'), '500');

  // 맞추기/채우기 (16:9 캔버스, 정사각형 이미지)
  const xywh = () => Promise.all(['#px', '#py', '#pw', '#ph'].map(s => page.inputValue(s)));
  await page.click('#fit-contain');
  assert.deepStrictEqual(await xywh(), ['280', '0', '720', '720']);
  await page.click('#fit-cover');
  assert.deepStrictEqual(await xywh(), ['0', '-280', '1280', '1280']);
  await page.click('#undo');
  assert.deepStrictEqual(await xywh(), ['280', '0', '720', '720']);

  // 삭제
  await page.click('#del');
  assert.strictEqual(await page.locator('#layers li').count(), 1);

  // 비율 탭
  await page.click('#t-ratio');
  await page.click('[data-ratio="9:16"]');
  assert.deepStrictEqual(await page.evaluate(() => [c.width, c.height]), [720, 1280]);

  // 내보내기 탭 -> WebP 저장
  await page.click('#t-export');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  assert.strictEqual(download.suggestedFilename(), 'thumbnail.webp');
  const buf = fs.readFileSync(await download.path());
  assert.strictEqual(buf.subarray(0, 4).toString(), 'RIFF');
  assert.strictEqual(buf.subarray(8, 12).toString(), 'WEBP');

  assert.deepStrictEqual(errors, []);
  console.log('OK');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

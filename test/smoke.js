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
  assert.strictEqual(buf.indexOf('ANIM'), -1, 'one scene -> still image');
  assert.ok(await page.locator('#anim').isHidden());

  // ---- 장면 여러 개 -> 움직이는 WebP ----
  // 장면 1: 파랑 (x540 y260, 200x200). 장면 2: 빨강을 채우기로 꽉 채움
  await page.click('#frame-add');
  assert.strictEqual(await page.locator('.frame').count(), 2);
  await page.click('#t-layers');
  await page.setInputFiles('#file', [{ name: 'red.png', mimeType: 'image/png', buffer: await png('#f00') }]);
  await page.waitForFunction(() => document.querySelectorAll('#layers li').length === 1);
  await page.click('#fit-cover');
  // 장면 1로 돌아가면 파랑 하나만
  await page.click('.frame >> nth=0');
  assert.strictEqual(await page.locator('#layers li').count(), 1);
  assert.strictEqual(await top(640, 360), 'blue');
  // 장면 3을 추가했다가 실행 취소
  await page.click('#frame-add');
  assert.strictEqual(await page.locator('.frame').count(), 3);
  await page.click('#undo');
  assert.strictEqual(await page.locator('.frame').count(), 2);

  // 시간: 일괄 1.5초 후 장면 2만 0.5초, 반복 3회
  await page.click('#t-export');
  assert.ok(await page.locator('#anim').isVisible());
  await page.fill('#dur-all', '1.5');
  await page.click('#dur-apply');
  await page.fill('#durs li:nth-child(2) input', '0.5');
  await page.press('#durs li:nth-child(2) input', 'Enter');
  await page.fill('#loops', '3');
  await page.press('#loops', 'Enter');

  const [anim] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const a = fs.readFileSync(await anim.path());
  const at = a.indexOf('ANIM');
  assert.ok(at > 0, 'has ANIM chunk');
  assert.strictEqual(a.readUInt16LE(at + 8 + 4), 3, 'loop count');
  assert.strictEqual(a.readUInt32LE(4), a.length - 8, 'RIFF size');
  // 브라우저 디코더로 재생 정보와 장면 색 확인
  const info = await page.evaluate(async b64 => {
    const data = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const dec = new ImageDecoder({ data, type: 'image/webp' });
    await dec.tracks.ready;
    const out = { frames: dec.tracks.selectedTrack.frameCount, scenes: [] };
    for (let i = 0; i < out.frames; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const k = new OffscreenCanvas(image.displayWidth, image.displayHeight), x = k.getContext('2d');
      x.drawImage(image, 0, 0);
      out.scenes.push({ ms: image.duration / 1000, w: image.displayWidth, h: image.displayHeight, px: Array.from(x.getImageData(640, 360, 1, 1).data) });
      image.close();
    }
    return out;
  }, a.toString('base64'));
  assert.strictEqual(info.frames, 2);
  assert.deepStrictEqual(info.scenes.map(s => [s.ms, s.w, s.h]), [[1500, 720, 1280], [500, 720, 1280]]);
  const color = px => px[3] < 128 ? 'none' : px[0] > 200 && px[2] < 60 ? 'red' : px[2] > 200 && px[0] < 60 ? 'blue' : 'other';
  assert.deepStrictEqual(info.scenes.map(s => color(s.px)), ['blue', 'red']);

  // 무한 반복(0)
  await page.fill('#loops', '0');
  await page.press('#loops', 'Enter');
  const [inf] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const b = fs.readFileSync(await inf.path());
  assert.strictEqual(b.readUInt16LE(b.indexOf('ANIM') + 12), 0);

  // 장면 삭제 -> 다시 정지 이미지
  await page.click('#frame-del');
  assert.strictEqual(await page.locator('.frame').count(), 1);
  assert.ok(await page.locator('#frame-del').isHidden());

  assert.deepStrictEqual(errors, []);
  console.log('OK');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

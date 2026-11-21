// Live checks for /hardware-out/. They draw test elements in a small canvas in
// a panel at the bottom of the window, convert them with the same library the
// page uses, and read the bytes back. Nothing here touches the three canvases
// in the page, and nothing scrolls or takes focus.
import { runTests, checkBench, stillDrawn, inkFraction, nextPaint, supported } from '/shared/support.js';
import { deck, escpos, matrix, oneBit } from '/lib/device-out.js';

const $ = (id) => document.getElementById(id);
let bench, canvas, ctx;

async function fixture() {
  if (!canvas) {
    bench.innerHTML = `
      <style>
        #fxOut { display: block; width: 288px; height: 72px; }
        #fxOut > div { position: absolute; top: 0; width: 72px; height: 72px; }
        #fxKey { all: unset; display: block; width: 72px; height: 72px; background: linear-gradient(rgb(0, 0, 255), rgb(0, 0, 255)) 0 0 / 20px 20px no-repeat, rgb(255, 204, 0); }
        #fxHalf { left: 72px; background: linear-gradient(90deg, #000 50%, #fff 50%); }
        #fxGrey { left: 144px; background: rgb(128, 128, 128); }
        #fxRed { left: 216px; background: rgb(255, 0, 0); }
      </style>
      <canvas id="fxOut" width="288" height="72" content="drawable" layoutsubtree>
        <div><button id="fxKey" drawable></button></div>
        <div id="fxHalf" drawable></div><div id="fxGrey" drawable></div><div id="fxRed" drawable></div>
      </canvas>`;
    canvas = $('fxOut');
    ctx = canvas.getContext('2d');
    canvas.addEventListener('paint', () => {
      ctx.reset();
      ['fxKey', 'fxHalf', 'fxGrey', 'fxRed'].forEach((id, i) => ctx.drawElementImage($(id), i * 72, 0, 72, 72));
    });
  }
  await nextPaint(canvas);
  return (i) => ctx.getImageData(i * 72, 0, 72, 72);
}

async function jpegOf(image, turned) {
  const c = new OffscreenCanvas(image.width, image.height), g = c.getContext('2d');
  const flat = new OffscreenCanvas(image.width, image.height);
  flat.getContext('2d').putImageData(image, 0, 0);
  if (turned) g.setTransform(-1, 0, 0, -1, image.width, image.height);
  g.drawImage(flat, 0, 0);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
}

const tests = [
  {
    name: 'HTML-in-canvas is available',
    run: () => { if (!supported) throw new Error('drawElementImage() is missing. The canvases are empty and nothing is sent.'); return 'drawElementImage() exists'; },
  },
  {
    name: 'This browser has WebHID and Web Serial',
    why: 'The APIs the Connect buttons use. Having them says nothing about a device accepting the bytes.',
    run: () => {
      const have = [['WebHID', navigator.hid], ['Web Serial', navigator.serial], ['Web Bluetooth', navigator.bluetooth], ['WebUSB', navigator.usb]];
      const text = have.map(([name, api]) => `${name}: ${api ? 'yes' : 'no'}`).join(', ');
      if (!navigator.hid || !navigator.serial) throw new Error(text);
      return text;
    },
  },
  {
    name: 'A button that is a grandchild of the canvas is drawn by itself',
    why: 'The button has the drawable attribute and sits inside a div. Its own pixels are read from the canvas.',
    run: async () => {
      const at = await fixture();
      const px = at(0).data, mid = (36 * 72 + 36) * 4, corner = (5 * 72 + 5) * 4;
      const body = [px[mid], px[mid + 1], px[mid + 2]], mark = [px[corner], px[corner + 1], px[corner + 2]];
      if (!(body[0] > 240 && body[1] > 190 && body[2] < 30)) throw new Error(`the middle of the button is rgb(${body}), expected rgb(255,204,0)`);
      if (!(mark[2] > 240 && mark[0] < 30)) throw new Error(`the corner mark is rgb(${mark}), expected blue`);
      return `button body rgb(${body}), its corner mark rgb(${mark})`;
    },
  },
  {
    name: 'A key image survives the trip through HID reports',
    why: 'Pixels to JPEG, JPEG to 1,024-byte reports, reports back to a JPEG through the reader, JPEG to pixels.',
    run: async () => {
      const at = await fixture();
      const jpeg = await jpegOf(at(0), deck.turned);
      const reports = deck.reports(7, jpeg);
      let got = null;
      const reader = new deck.Reader((key, bytes) => { got = { key, bytes }; });
      for (const data of reports) {
        if (data.length !== 1023) throw new Error(`a report is ${data.length} bytes, expected 1023 after the report id`);
        reader.sendReport(deck.reportId, data);
      }
      if (!got || got.key !== 7) throw new Error('the reader did not finish key 7');
      if (got.bytes.length !== jpeg.length || got.bytes.some((b, i) => b !== jpeg[i])) throw new Error('the JPEG that came out differs from the one that went in');
      const bitmap = await createImageBitmap(new Blob([got.bytes], { type: 'image/jpeg' }));
      const c = new OffscreenCanvas(72, 72), g = c.getContext('2d');
      g.drawImage(bitmap, 0, 0);
      // The blue mark is in the top left of the button, so in the stored, turned image it is bottom right.
      const mark = Array.from(g.getImageData(66, 66, 1, 1).data.slice(0, 3)), body = Array.from(g.getImageData(20, 20, 1, 1).data.slice(0, 3));
      if (!(mark[2] > 200 && mark[0] < 70)) throw new Error(`the stored image has rgb(${mark}) at its bottom right, expected the blue mark`);
      if (!(body[0] > 220 && body[2] < 60)) throw new Error(`the stored image has rgb(${body}) in its body, expected yellow`);
      return `${jpeg.length} byte JPEG, ${reports.length} report${reports.length > 1 ? 's' : ''}, same bytes out. Stored turned by 180°: mark rgb(${mark}) at the bottom right`;
    },
  },
  {
    name: 'A long key image is split over several reports and put back in order',
    run: () => {
      const jpeg = new Uint8Array(2500).map((_, i) => (i * 7) & 255);
      const reports = deck.reports(3, jpeg);
      let got = null;
      const reader = new deck.Reader((key, bytes) => { got = bytes; });
      for (const data of reports) reader.sendReport(deck.reportId, data);
      const lengths = reports.map((d) => d[3] | (d[4] << 8)), last = reports.map((d) => d[2]);
      if (reports.length !== 3 || lengths.join() !== '1016,1016,468' || last.join() !== '0,0,1') throw new Error(`pieces ${lengths}, last flags ${last}`);
      if (!got || got.some((b, i) => b !== jpeg[i])) throw new Error('the bytes came back different');
      return `2,500 bytes in pieces of ${lengths.join(', ')}. The last report carries the "last" flag`;
    },
  },
  {
    name: 'An input report for one key calls click() on that button and no other',
    why: 'Builds the report a device sends for key 9 held, then for no key held, and counts click events on fifteen test buttons.',
    run: () => {
      const buttons = Array.from({ length: deck.keys }, () => document.createElement('button'));
      const clicks = new Array(deck.keys).fill(0);
      buttons.forEach((b, k) => b.addEventListener('click', () => clicks[k]++));
      let held = [];
      const input = (view) => { const down = deck.pressed(view); for (const k of down) if (!held.includes(k)) buttons[k].click(); held = down; };
      input(deck.inputReport([9])); input(deck.inputReport([9])); input(deck.inputReport([]));
      if (clicks[9] !== 1 || clicks.reduce((a, b) => a + b) !== 1) throw new Error(`clicks per key: ${clicks}`);
      return 'key 9 held for two reports gave one click on button 9';
    },
  },
  {
    name: 'An element becomes ESC/POS bytes, and the reader gets the same dots back',
    why: 'A square that is black on the left and white on the right. The bytes are parsed the way the simulated printer parses them.',
    run: async () => {
      const at = await fixture();
      const image = at(1);
      const bytes = escpos.print(image, { dither: 'threshold', band: 32 });
      const head = Array.from(bytes.subarray(0, 6), (b) => b.toString(16).padStart(2, '0')).join(' ');
      if (head !== '1b 40 1d 76 30 00') throw new Error(`the stream starts ${head}`);
      const page = escpos.read(bytes);
      if (page.width !== 72 || page.height !== 72) throw new Error(`read back ${page.width} x ${page.height} dots`);
      const want = oneBit(image, 'threshold');
      let wrong = 0, black = 0;
      for (let i = 0; i < want.length; i++) { if (want[i] !== page.bits[i]) wrong++; black += page.bits[i]; }
      if (wrong) throw new Error(`${wrong} dots differ after the round trip`);
      const left = page.bits[36 * 72 + 10], right = page.bits[36 * 72 + 60];
      if (left !== 1 || right !== 0) throw new Error(`left dot ${left}, right dot ${right}`);
      return `${bytes.length} bytes, ${page.commands.length} commands, 72 x 72 dots, ${Math.round((black / want.length) * 100)}% black, left half black and right half white`;
    },
  },
  {
    name: 'Mid grey prints as about half the dots with error diffusion and the ordered pattern',
    why: 'rgb(128,128,128) has no exact answer in one bit. A threshold makes it all white or all black.',
    run: async () => {
      const at = await fixture();
      const image = at(2), share = (how) => oneBit(image, how).reduce((a, b) => a + b, 0) / (72 * 72);
      const d = share('diffuse'), o = share('ordered'), t = share('threshold');
      if (d < 0.4 || d > 0.6 || o < 0.4 || o > 0.6) throw new Error(`diffusion ${(d * 100).toFixed(0)}%, ordered ${(o * 100).toFixed(0)}% black`);
      return `black dots: error diffusion ${(d * 100).toFixed(0)}%, ordered ${(o * 100).toFixed(0)}%, threshold ${(t * 100).toFixed(0)}%`;
    },
  },
  {
    name: 'A red element is red after RGB565',
    why: 'Pixels to a frame and back through the reader the simulated panel uses.',
    run: async () => {
      const at = await fixture();
      const small = new OffscreenCanvas(64, 32), g = small.getContext('2d');
      const src = new OffscreenCanvas(72, 72); src.getContext('2d').putImageData(at(3), 0, 0);
      g.drawImage(src, 0, 0, 64, 32);
      const bytes = matrix.frame(g.getImageData(0, 0, 64, 32));
      const back = matrix.read(bytes);
      const px = Array.from(back.data.slice(0, 3));
      if (bytes.length !== 4100) throw new Error(`a frame is ${bytes.length} bytes, expected 4100`);
      if (!(px[0] > 240 && px[1] < 10 && px[2] < 10)) throw new Error(`rgb(${px}) came back`);
      return `4,100 bytes. First pixel bytes ${bytes[4].toString(16).padStart(2, '0')} ${bytes[5].toString(16)} read back as rgb(${px})`;
    },
  },
];

if (supported) {
  tests.push({
    name: 'The ticker fires paint with no script running it',
    why: 'Counts paint events on the sign canvas for half a second. The text moves with a CSS animation only.',
    run: async () => {
      const sign = $('matrixSrc'), box = sign.getBoundingClientRect();
      let n = 0;
      const on = () => n++;
      sign.addEventListener('paint', on);
      await new Promise((r) => setTimeout(r, 500));
      sign.removeEventListener('paint', on);
      const where = box.bottom > 0 && box.top < innerHeight ? 'on screen' : 'scrolled out of view';
      if (n < 5) throw new Error(`${n} paint events in 500 ms with the sign ${where}`);
      return `${n} paint events in 500 ms with the sign ${where}`;
    },
  });
  tests.push(stillDrawn(() => [
    { name: 'key pad', ink: () => inkFraction($('deckSrc').getContext('2d')) },
    { name: 'receipt', ink: () => inkFraction($('receiptSrc').getContext('2d')) },
  ]));
}

bench = checkBench();
runTests($('results'), tests).then(() => bench.done());

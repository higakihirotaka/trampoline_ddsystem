const { Jimp } = require('jimp');

async function removeBg() {
  const img = await Jimp.read('./public/logo.png');
  const w = img.width;
  const h = img.height;

  // Sample background color from top-left corner
  const bgColor = img.getPixelColor(0, 0);
  const bgR = (bgColor >> 24) & 0xff;
  const bgG = (bgColor >> 16) & 0xff;
  const bgB = (bgColor >> 8)  & 0xff;

  console.log(`Image size: ${w}x${h}`);
  console.log(`Background color sampled: R=${bgR} G=${bgG} B=${bgB}`);

  // Flood fill from all 4 corners with a tolerance
  const tolerance = 40;

  function isBackground(x, y) {
    const c = img.getPixelColor(x, y);
    const r = (c >> 24) & 0xff;
    const g = (c >> 16) & 0xff;
    const b = (c >> 8)  & 0xff;
    const a = c & 0xff;
    if (a < 128) return true; // already transparent
    return Math.abs(r - bgR) < tolerance &&
           Math.abs(g - bgG) < tolerance &&
           Math.abs(b - bgB) < tolerance;
  }

  const visited = new Uint8Array(w * h);

  function floodFill(startX, startY) {
    const stack = [[startX, startY]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (visited[y * w + x]) continue;
      if (!isBackground(x, y)) continue;
      visited[y * w + x] = 1;
      img.setPixelColor(0x00000000, x, y);
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
  }

  floodFill(0, 0);
  floodFill(w-1, 0);
  floodFill(0, h-1);
  floodFill(w-1, h-1);

  await img.write('./public/logo.png');
  console.log('Done! Saved to public/logo.png');
}

removeBg().catch(console.error);

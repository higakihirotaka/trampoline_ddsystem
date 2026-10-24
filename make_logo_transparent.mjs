import { Jimp } from 'jimp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, 'public', 'logo.png');
const dst = path.join(__dirname, 'public', 'logo_t.png');

const img = await Jimp.read(src);
const { width, height, data } = img.bitmap;

// ---- フラッドフィル（4方向）で背景を検出 ----
const visited = new Uint8Array(width * height);
const queue = [];

function isBg(idx) {
  const r = data[idx], g = data[idx+1], b = data[idx+2];
  return r > 200 && g > 200 && b > 200;
}

// 四隅からフラッドフィル開始
const corners = [
  0, width - 1,
  (height - 1) * width, (height - 1) * width + width - 1
];
for (const px of corners) {
  if (!visited[px] && isBg(px * 4)) {
    queue.push(px);
    visited[px] = 1;
  }
}

while (queue.length > 0) {
  const px = queue.pop();
  const x = px % width;
  const y = Math.floor(px / width);
  const neighbors = [];
  if (x > 0) neighbors.push(px - 1);
  if (x < width - 1) neighbors.push(px + 1);
  if (y > 0) neighbors.push(px - width);
  if (y < height - 1) neighbors.push(px + width);
  for (const np of neighbors) {
    if (!visited[np] && isBg(np * 4)) {
      visited[np] = 1;
      queue.push(np);
    }
  }
}

// ---- フラッドフィルで見つかった背景ピクセルを透明化（エッジをぼかす）----
for (let px = 0; px < width * height; px++) {
  if (!visited[px]) continue;
  const idx = px * 4;
  const r = data[idx], g = data[idx+1], b = data[idx+2];
  const brightness = (r + g + b) / 3;
  if (brightness > 240) {
    data[idx+3] = 0;
  } else {
    // やや暗い境界ピクセルは半透明
    data[idx+3] = Math.round(((240 - brightness) / 40) * 255);
  }
}

await img.write(dst);
console.log('done:', dst);

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'docs', 'spritesheet.webp');
const OUTPUT_DIR = path.join(ROOT, 'assets', 'pet-actions');
const ROWS = 9;

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, '/').replace(/ /g, '%20')}`;
}

function findBrowser() {
  const browser = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!browser) {
    throw new Error('No Chrome or Edge executable found for WebP decoding.');
  }
  return browser;
}

function extractJsonFromDom(dom) {
  const match = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
  if (!match) {
    throw new Error(`Browser export failed. DOM output:\n${dom.slice(0, 1000)}`);
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Browser export returned invalid JSON: ${error.message}`);
  }
}

function exportRowsWithCanvas() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-spritesheet-'));
  const htmlPath = path.join(tempDir, 'slice.html');
  const html = `<!doctype html>
<meta charset="utf-8">
<body></body>
<script>
  const rows = ${ROWS};
  const source = ${JSON.stringify(fileUrl(SOURCE))};

  function finish(payload) {
    const result = document.createElement('pre');
    result.id = 'result';
    result.textContent = JSON.stringify(payload);
    document.body.replaceChildren(result);
  }

  const img = new Image();
  img.onload = () => {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height || height % rows !== 0) {
      finish({ error: 'Unexpected source size: ' + width + 'x' + height });
      return;
    }

    const rowHeight = height / rows;
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    sourceCanvas.getContext('2d').drawImage(img, 0, 0);

    function cropFrame(canvas, imageData, runStart, runEnd) {
      const data = imageData.data;
      const width = canvas.width;
      const height = canvas.height;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < height; y += 1) {
        for (let x = runStart; x <= runEnd; x += 1) {
          const alpha = data[((y * width + x) * 4) + 3];
          if (alpha > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < minX || maxY < minY) return null;

      const pad = 4;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(width - 1, maxX + pad);
      maxY = Math.min(height - 1, maxY + pad);

      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = maxX - minX + 1;
      frameCanvas.height = maxY - minY + 1;
      frameCanvas
        .getContext('2d')
        .drawImage(canvas, minX, minY, frameCanvas.width, frameCanvas.height, 0, 0, frameCanvas.width, frameCanvas.height);

      return {
        x: minX,
        y: minY,
        width: frameCanvas.width,
        height: frameCanvas.height,
        dataUrl: frameCanvas.toDataURL('image/png'),
      };
    }

    function detectFrames(canvas) {
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const occupied = [];
      for (let x = 0; x < canvas.width; x += 1) {
        let hasPixel = false;
        for (let y = 0; y < canvas.height; y += 1) {
          if (data[((y * canvas.width + x) * 4) + 3] > 8) {
            hasPixel = true;
            break;
          }
        }
        occupied[x] = hasPixel;
      }

      const rawRuns = [];
      let start = -1;
      for (let x = 0; x < occupied.length; x += 1) {
        if (occupied[x] && start === -1) start = x;
        if ((!occupied[x] || x === occupied.length - 1) && start !== -1) {
          const end = occupied[x] ? x : x - 1;
          if (end - start + 1 >= 24) rawRuns.push({ start, end });
          start = -1;
        }
      }

      const mergedRuns = [];
      const mergeGap = 18;
      for (const run of rawRuns) {
        const prev = mergedRuns[mergedRuns.length - 1];
        if (prev && run.start - prev.end <= mergeGap) {
          prev.end = run.end;
        } else {
          mergedRuns.push({ ...run });
        }
      }

      return mergedRuns
        .map((run) => cropFrame(canvas, imageData, run.start, run.end))
        .filter(Boolean);
    }

    const actions = [];
    for (let row = 0; row < rows; row += 1) {
      const stripCanvas = document.createElement('canvas');
      stripCanvas.width = width;
      stripCanvas.height = rowHeight;
      stripCanvas
        .getContext('2d')
        .drawImage(sourceCanvas, 0, row * rowHeight, width, rowHeight, 0, 0, width, rowHeight);

      actions.push({
        row: row + 1,
        y: row * rowHeight,
        width,
        height: rowHeight,
        dataUrl: stripCanvas.toDataURL('image/png'),
        frames: detectFrames(stripCanvas),
      });
    }

    finish({ sourceWidth: width, sourceHeight: height, rowHeight, actions });
  };
  img.onerror = () => finish({ error: 'Could not load source image.' });
  img.src = source;
</script>`;

  fs.writeFileSync(htmlPath, html, 'utf8');

  const dom = execFileSync(findBrowser(), [
    '--headless=old',
    '--disable-gpu',
    '--single-process',
    '--no-sandbox',
    '--disable-software-rasterizer',
    '--allow-file-access-from-files',
    '--no-first-run',
    '--virtual-time-budget=10000',
    '--dump-dom',
    fileUrl(htmlPath),
  ], {
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const payload = extractJsonFromDom(dom);
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload;
}

function pngFromDataUrl(dataUrl) {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) {
    throw new Error('Unexpected row export format.');
  }
  return Buffer.from(dataUrl.slice(prefix.length), 'base64');
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Source file not found: ${SOURCE}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const payload = exportRowsWithCanvas();
  const actions = [];

  payload.actions.forEach((action, index) => {
    const id = `action-${String(index + 1).padStart(2, '0')}`;
    const folder = path.join(OUTPUT_DIR, id);
    fs.mkdirSync(folder, { recursive: true });
    for (const file of fs.readdirSync(folder)) {
      if (/^(frame-\d+|strip)\.png$/.test(file)) {
        fs.unlinkSync(path.join(folder, file));
      }
    }
    fs.writeFileSync(path.join(folder, 'strip.png'), pngFromDataUrl(action.dataUrl));

    const frames = action.frames.map((frame, frameIndex) => {
      const fileName = `frame-${String(frameIndex + 1).padStart(2, '0')}.png`;
      fs.writeFileSync(path.join(folder, fileName), pngFromDataUrl(frame.dataUrl));
      return {
        index: frameIndex + 1,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        file: `${id}/${fileName}`,
      };
    });

    actions.push({
      id,
      row: action.row,
      x: 0,
      y: action.y,
      width: action.width,
      height: action.height,
      strip: `${id}/strip.png`,
      frames,
    });
  });

  const manifest = {
    source: 'docs/spritesheet.webp',
    generatedAt: new Date().toISOString(),
    layout: {
      rows: ROWS,
      width: payload.sourceWidth,
      height: payload.sourceHeight,
      rowHeight: payload.rowHeight,
    },
    actions,
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'README.md'),
    [
      '# Pet Action Sprites',
      '',
      'Generated from `docs/spritesheet.webp`.',
      '',
      '- `action-01` through `action-09` map to the source image rows from top to bottom.',
      '- Each folder contains `strip.png`, a full-width transparent PNG action strip for that row.',
      '- Each folder also contains `frame-*.png`, transparent per-frame sprites detected from that row.',
      '- `manifest.json` records the source crop coordinates for later animation wiring.',
      '',
    ].join('\n'),
    'utf8',
  );

  console.log(`Generated ${actions.length} action strips in ${path.relative(ROOT, OUTPUT_DIR)}`);
}

main();

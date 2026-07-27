// Generate og:image (1200x630) using Playwright + a tiny in-memory page
const { chromium } = require('playwright');
const path = require('path');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    width:1200px;height:630px;
    background:radial-gradient(ellipse at 20% 20%, #1f1f1d 0%, #121212 60%);
    color:#f2efe7;
    font-family:'Inter','PingFang SC','Microsoft YaHei',sans-serif;
    position:relative;
    overflow:hidden;
  }
  .grain{
    position:absolute;inset:0;
    opacity:0.06;mix-blend-mode:screen;
    background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3' stitchTiles='stitchTiles'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.24'/%3E%3C/svg%3E");
  }
  .grid{
    position:absolute;inset:-8px;
    background-image:
      linear-gradient(to right, rgba(194,166,99,0.06) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(194,166,99,0.06) 1px, transparent 1px);
    background-size:64px 64px;
    mask-image:radial-gradient(ellipse at 30% 40%, black 30%, transparent 75%);
  }
  .content{position:relative;padding:80px 96px;display:flex;flex-direction:column;justify-content:space-between;height:100%}
  .top{display:flex;align-items:center;gap:14px;font-size:24px;font-weight:500;letter-spacing:0.22em}
  .mark{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;background:#121212;border:1px solid rgba(255,255,255,0.08);border-radius:8px}
  .mark svg{width:22px;height:22px;color:#f2efe7}
  .ver{font-family:'JetBrains Mono',monospace;font-size:18px;color:#79766e;font-weight:400;letter-spacing:0.05em;margin-left:8px}
  .mid h1{font-size:84px;font-weight:600;line-height:1.05;letter-spacing:-0.02em;margin-bottom:24px}
  .mid h1 span{background:linear-gradient(135deg, #c2a663, #dcc384);-webkit-background-clip:text;background-clip:text;color:transparent}
  .mid p{font-size:28px;color:#9d998f;line-height:1.45;max-width:880px;font-weight:400}
  .bot{display:flex;justify-content:space-between;align-items:flex-end}
  .tags{display:flex;gap:10px}
  .tag{font-family:'JetBrains Mono',monospace;font-size:16px;color:#9d998f;padding:6px 14px;background:rgba(242,239,231,0.04);border:1px solid rgba(242,239,231,0.14);border-radius:999px}
  .tag.gold{color:#c2a663;border-color:rgba(194,166,99,0.3)}
  .url{font-family:'JetBrains Mono',monospace;font-size:18px;color:#79766e}
  .url b{color:#c2a663;font-weight:500}
</style></head><body>
  <div class="grain"></div>
  <div class="grid"></div>
  <div class="content">
    <div class="top">
      <span class="mark"><svg viewBox="0 0 16 16" fill="none"><path d="M11 3.2A5 5 0 1 0 11 12.8 6.5 6.5 0 0 1 11 3.2Z" fill="currentColor"/></svg></span>
      <span>MoonMeter<span class="ver">v1.2.2</span></span>
    </div>
    <div class="mid">
      <h1>Every token, in<br/><span>a clearer light.</span></h1>
      <p>本地优先的 LLM 用量、余额与成本工作台 · 数据留在本机</p>
    </div>
    <div class="bot">
      <div class="tags">
        <span class="tag gold">11+ Providers</span>
        <span class="tag">Claude Code · Codex CLI</span>
        <span class="tag">SQLite + safeStorage</span>
        <span class="tag">MIT</span>
      </div>
      <div class="url">github.com/<b>2488652el</b>/MoonMeter</div>
    </div>
  </div>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const out = 'D:/开发/tokengirl/design/site/og.png';
  await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log('OK', out);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

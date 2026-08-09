const fs = require('fs');
const path = require('path');

const distHtml = path.join(__dirname, '..', 'dist', 'index.html');
let html = fs.readFileSync(distHtml, 'utf-8');
const buildId = (process.env.EXPO_PUBLIC_APP_COMMIT_SHA || 'local').replace(/[^a-zA-Z0-9_-]/g, '');

const pwaTags = `
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#0a0a0a" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Alice" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <link rel="icon" type="image/png" href="/favicon.png" />`;

const swScript = `
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
          navigator.serviceWorker.register('/sw.js');
        });
      }
    </script>`;

html = html.replace('</head>', pwaTags + '\n  </head>');
html = html.replace('<body', '<body style="background-color:#0a0a0a;margin:0"');
html = html.replace('</body>', swScript + '\n  </body>');

fs.writeFileSync(distHtml, html);

const distServiceWorker = path.join(__dirname, '..', 'dist', 'sw.js');
const serviceWorker = fs
  .readFileSync(distServiceWorker, 'utf-8')
  .replace('__ALICE_BUILD_ID__', buildId);
fs.writeFileSync(distServiceWorker, serviceWorker);

const vercelJson = path.join(__dirname, '..', 'vercel.json');
const distVercel = path.join(__dirname, '..', 'dist', 'vercel.json');
fs.copyFileSync(vercelJson, distVercel);

console.log('PWA tags injected + vercel.json copied to dist/');

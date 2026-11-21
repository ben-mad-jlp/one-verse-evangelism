// Screenshot every screen of a deck, fully revealed, at the 1600x1000 stage size.
// usage: npx electron tools/shoot.js app/week4.html .shots/w4 [i,j,...]   (0-based indexes)
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs');
const [html, out, idx] = process.argv.slice(2);
const WAIT = +process.env.WAIT || 700;
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 1600, height: 1000, show: false, useContentSize: true });
  await win.loadFile(path.resolve(html));
  await new Promise(r => setTimeout(r, 1200));
  const n = await win.webContents.executeJavaScript('Deck.screens.length');
  const list = idx ? idx.split(',').map(Number) : [...Array(n).keys()];
  for (const i of list) {
    const id = await win.webContents.executeJavaScript(`Deck.goTo(${i},{revealAll:true});
      document.querySelectorAll('#menu-btn,.arrow,#dots').forEach(e=>e.style.display='none');
      Deck.screens[${i}].id`);
    await new Promise(r => setTimeout(r, WAIT));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, String(i + 1).padStart(2, '0') + '-' + id + '.png'), img.toPNG());
  }
  app.quit();
});

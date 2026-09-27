const fs = require('fs');
const path = require('path');
const sharp = require('../frontend/node_modules/sharp');

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error('Pass the original academy logo image path');
  const root = path.resolve(__dirname, '..');
  // Remove only the surrounding empty margin; retain the complete supplied logo.
  const logo = await sharp(source).extract({ left: 390, top: 110, width: 500, height: 500 }).png().toBuffer();
  let count = 0;
  for (const directory of ['frontend/public', 'backend/static']) {
    const base = path.join(root, directory);
    for (const name of ['logo-new.png', 'images/academy-logo.png']) {
      fs.writeFileSync(path.join(base, name), logo);
      count++;
    }
    const icons = fs.readdirSync(path.join(base, 'images')).filter(name => /^icon-\d+x\d+\.png$/.test(name));
    for (const name of [...icons.map(name => 'images/' + name), 'app-icon-512.png']) {
      const size = name === 'app-icon-512.png' ? 512 : Number(name.match(/icon-(\d+)/)[1]);
      await sharp(logo).resize(size, size).png().toFile(path.join(base, name));
      count++;
    }
    fs.writeFileSync(path.join(base, 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><image width="500" height="500" href="data:image/png;base64,${logo.toString('base64')}"/></svg>\n`);
    for (const name of ['sw.js', 'service-worker.js']) {
      const file = path.join(base, name);
      let content = fs.readFileSync(file, 'utf8');
      content = name === 'sw.js' ? content.replace(/gcsp-academy-v104/g, 'gcsp-academy-v105') : content.replace(/gcsp-(academy|static|dynamic|api)-v2/g, 'gcsp-$1-v3');
      fs.writeFileSync(file, content);
    }
  }
  const res = path.join(root, 'frontend/android/app/src/main/res');
  for (const dir of fs.readdirSync(res)) {
    const folder = path.join(res, dir);
    if (!fs.statSync(folder).isDirectory()) continue;
    for (const name of fs.readdirSync(folder)) {
      if (!/^ic_launcher(?:_round|_foreground)?\.png$/.test(name) && name !== 'splash.png') continue;
      const file = path.join(folder, name);
      const { width, height } = await sharp(file).metadata();
      const fraction = name === 'splash.png' ? 0.42 : name.includes('foreground') ? 0.6 : 0.88;
      const side = Math.max(1, Math.round(Math.min(width, height) * fraction));
      const inset = await sharp(logo).resize(side, side).toBuffer();
      await sharp({ create: { width, height, channels: 4, background: '#ffffff' } }).composite([{ input: inset, gravity: 'centre' }]).png().toFile(file + '.new');
      fs.renameSync(file + '.new', file);
      count++;
    }
  }
  console.log(`Updated ${count} academy logo and icon assets, SVG aliases, and both service-worker caches.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

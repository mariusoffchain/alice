#!/usr/bin/env node
// Paired calls to the installed Metro asset implementation; no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync, spawnSync } = require('node:child_process');
const load = root => require(path.join(root, 'node_modules/metro/src/Assets.js'));
function png(width, height) {
  function chunk(type, body) {
    const data = Buffer.concat([Buffer.from(type), body]);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, data, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
if (process.argv[2] === '--malformed') {
  const metro = load(process.argv[3]);
  const malformed = [Buffer.alloc(0), Buffer.alloc(32), Buffer.from('icns\0\0\0\x10ic07\0\0\0\0', 'binary'), Buffer.from([0,0,0,12,0x4a,0x58,0x4c,0x20,13,10,135,10,0,0,0,0,0x6a,0x78,0x6c,0x63])];
  const rows = [];
  for (const type of ['png','jpg','gif','webp','svg','bmp','psd','tiff','ktx']) for (const [index, bytes] of malformed.entries()) {
    assert.throws(() => metro.getAssetSize(type, bytes, `synthetic-${index}.${type}`));
    rows.push({ type, fixture: index, rejected: true });
  }
  console.log(JSON.stringify(rows));
} else {
  (async () => {
    const [beforeRoot, afterRoot, output] = process.argv.slice(2);
    assert.ok(beforeRoot && afterRoot && output);
    const before = load(beforeRoot), after = load(afterRoot);
    const files = execFileSync('git', ['ls-files', '--', 'apps', 'packages'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).split('\n').filter(file => /\.(png|jpg|jpeg|webp|svg|gif|bmp|psd|tiff|ktx)$/i.test(file));
    assert.ok(files.length > 0);
    const rows = [];
    for (const file of files) {
      const asset = path.join(beforeRoot, file);
      const bytes = fs.readFileSync(asset); assert.deepEqual(bytes, fs.readFileSync(path.join(afterRoot, file)));
      const type = path.extname(asset).slice(1);
      const oldDimensions = before.getAssetSize(type, bytes, asset);
      assert.deepEqual(after.getAssetSize(type, bytes, asset), oldDimensions, file);
      const oldData = await before.getAssetData(asset, file, [], 'android', '/assets');
      assert.deepEqual(await after.getAssetData(asset, file, [], 'android', '/assets'), oldData, file);
      rows.push({ file, ...oldDimensions, hash: oldData.hash, scales: oldData.scales, passed: true });
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-metro-assets-'));
    for (const [name, size] of [['icon.png',16],['icon@2x.png',32],['icon.android.png',24],['icon@2x.android.png',48],['icon.ios.png',20]]) fs.writeFileSync(path.join(directory,name),png(size,size));
    const plugin = path.join(directory,'plugin.cjs'); fs.writeFileSync(plugin,"module.exports = data => ({ ...data, syntheticPlugin: 'checked' });\n");
    const variants = [];
    for (const [platform, width, scales] of [[null,16,[1,2]],['android',24,[1,2]],['ios',20,[1]]]) {
      const args = [path.join(directory,'icon.png'),'images/icon.png',[plugin],platform,'/assets'];
      const oldData = await before.getAssetData(...args), newData = await after.getAssetData(...args);
      assert.deepEqual(newData, oldData); assert.equal(newData.width,width); assert.equal(newData.height,width); assert.deepEqual(newData.scales,scales); assert.equal(newData.syntheticPlugin,'checked');
      const oldFile = await before.getAsset('icon.png',directory,[],platform,['png']);
      assert.deepEqual(await after.getAsset('icon.png',directory,[],platform,['png']),oldFile);
      assert.deepEqual(oldFile,png(width,width));
      variants.push({ platform,width,scales,plugin:true,bytesIdentical:true });
    }
    // New parser fallback still reads a real PNG even with a JPEG extension.
    assert.deepEqual(after.getAssetSize('jpg',png(7,9),'mismatch.jpg'),before.getAssetSize('jpg',png(7,9),'mismatch.jpg'));
    const svg = Buffer.from('<svg width="50%" height="50%" viewBox="0 0 12 18"></svg>');
    assert.deepEqual(after.getAssetSize('svg',svg,'relative.svg'),before.getAssetSize('svg',svg,'relative.svg'));
    const malformed = spawnSync(process.execPath,[__filename,'--malformed',afterRoot],{ encoding:'utf8',timeout:5000,maxBuffer:1024*1024 });
    assert.equal(malformed.status,0,malformed.stderr || malformed.error?.message);
    const report = { date:new Date().toISOString(), passed:true,
      methodology:'Actual unchanged before/after Metro asset APIs on every tracked supported image in apps/packages, matching bytes/dimensions/asset metadata. Valid synthetic PNGs with platform/scale variants and asset plugin, fallback extension and relative SVG. Candidate-only malformed buffers in a 5-second child, no network or vulnerable-baseline malformed execution. Not an exhaustive decoder security audit or Android device test.',
      beforeVersion:require(path.join(beforeRoot,'node_modules/metro/package.json')).version,
      afterVersion:require(path.join(afterRoot,'node_modules/metro/package.json')).version,
      projectAssets:rows,variants,additionalChecks:['mismatched extension fallback','percentage SVG with viewBox'],malformedRejected:JSON.parse(malformed.stdout),fixtureDirectory:directory };
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({passed:true,projectAssets:rows.length,variants:variants.length,malformedRejected:report.malformedRejected.length}));
  })().catch(error => { console.error(error.stack); process.exitCode=1; });
}

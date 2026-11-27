'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const [, , sourcePath, outputPath] = process.argv;
if (!sourcePath || !outputPath) throw new Error('Usage: node build.cjs <original app.asar> <output app.asar>');
const source = fs.readFileSync(sourcePath);
const base = 8 + source.readUInt32LE(4);
const jsonBytes = source.readUInt32LE(12);
if (base > source.length || jsonBytes + 16 > base) throw new Error('Invalid ASAR header');
const header = JSON.parse(source.toString('utf8', 16, 16 + jsonBytes));
const dist = header.files?.dist?.files;

function content(entry) {
    const offset = Number(entry?.offset);
    if (entry?.unpacked || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 || base + offset + entry.size > source.length) {
        throw new Error('Missing or invalid packed ASAR entry');
    }
    return source.subarray(base + offset, base + offset + entry.size);
}

if (!dist?.['languageServer.js'] || !dist['main.js'] || !dist['preload.js']) {
    throw new Error('Antigravity main, preload, or language service layout changed');
}
const rawMain = content(dist['main.js']).toString('utf8');
const rawPreload = content(dist['preload.js']).toString('utf8');
if (dist['geminiUsageCapsule.cjs'] || rawMain.includes('geminiUsageCapsule') || rawPreload.includes('gemini-usage-capsule:summary')) {
    throw new Error('This archive already has the Gemini usage capsule');
}
const added = 'geminiUsageCapsule.cjs';
dist[added] = {};
dist['usage-renderer.cjs'] = {};
const changes = new Map([
    ['dist/main.js', Buffer.from(rawMain + "\n;require('./geminiUsageCapsule.cjs').register();\n")],
    ['dist/preload.js', Buffer.concat([Buffer.from(rawPreload + '\n;'), fs.readFileSync(path.join(__dirname, 'usage-preload.js'))])],
    ['dist/' + added, fs.readFileSync(path.join(__dirname, 'usage-main.cjs'))],
    ['dist/usage-renderer.cjs', fs.readFileSync(path.join(__dirname, 'usage-renderer.cjs'))],
]);
for (const [name, bytes] of changes) new vm.Script(bytes.toString('utf8'), { filename: name });

const hash = data => createHash('sha256').update(data).digest('hex');
function integrity(data, blockSize) {
    const blocks = [];
    if (!data.length) blocks.push(hash(data));
    for (let start = 0; start < data.length; start += blockSize) blocks.push(hash(data.subarray(start, start + blockSize)));
    return { algorithm: 'SHA256', hash: hash(data), blockSize, blocks };
}

let offset = 0;
const packed = [];
function walk(files, prefix = '') {
    for (const [name, entry] of Object.entries(files)) {
        const relativePath = prefix + name;
        if (entry.files) walk(entry.files, relativePath + '/');
        else if (!entry.unpacked && !entry.link) {
            const changed = changes.get(relativePath);
            const data = changed || content(entry);
            if (changed && entry.integrity) {
                const blockSize = entry.integrity.blockSize;
                if (entry.integrity.algorithm !== 'SHA256' || !Number.isSafeInteger(blockSize) || blockSize < 1) {
                    throw new Error('Unknown ASAR integrity metadata');
                }
                entry.integrity = integrity(data, blockSize);
            }
            entry.size = data.length;
            entry.offset = String(offset);
            offset += data.length;
            packed.push(data);
        }
    }
}
walk(header.files);

const json = Buffer.from(JSON.stringify(header));
const outputHeader = Buffer.alloc(16 + Math.ceil(json.length / 4) * 4);
outputHeader.writeUInt32LE(4, 0);
outputHeader.writeUInt32LE(outputHeader.length - 8, 4);
outputHeader.writeUInt32LE(outputHeader.length - 12, 8);
outputHeader.writeUInt32LE(json.length, 12);
json.copy(outputHeader, 16);
fs.writeFileSync(outputPath, Buffer.concat([outputHeader, ...packed]), { flag: 'wx' });
console.log('Built Gemini usage capsule for Antigravity ' + JSON.parse(contentVersion()).version);

function contentVersion() {
    const original = JSON.parse(source.toString('utf8', 16, 16 + jsonBytes));
    return content(original.files['package.json']).toString('utf8');
}

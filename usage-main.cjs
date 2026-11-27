'use strict';

const { createHash } = require('node:crypto');
const { readdir, stat } = require('node:fs/promises');
const { homedir } = require('node:os');
const path = require('node:path');
const { readUsage } = require('./usage-renderer.cjs');

const CHANNEL = 'gemini-usage-capsule:summary';
const DAY = 86400000;
const windows = new Set([1, 7, 30]);
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

function timestamp(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Date.parse(value);
    if (value && Number.isFinite(Number(value.seconds))) {
        return Number(value.seconds) * 1000 + (Number(value.nanos) || 0) / 1000000;
    }
    return NaN;
}

function count(value) {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function firstDay(days, now = new Date()) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1).getTime();
}

const levels = { minimal: '极低', low: '低', medium: '中', high: '高', veryhigh: '很高', extra: '极高', xhigh: '极高', max: '最高', ultra: 'Ultra', off: '关闭', none: '关闭', auto: '自动', adaptive: '自适应', 低: '低', 中: '中', 高: '高', 极高: '极高', 最高: '最高', 极低: '极低' };

function levelOf(value) {
    if (typeof value !== 'string') return null;
    const key = value.trim().toLowerCase()
        .replace(/^(?:thinking_level_|reasoning_effort_|reasoning_level_|effort_level_|effort_)/, '')
        .replace(/[\s_-]+/g, '');
    return Object.hasOwn(levels, key) ? levels[key] : null;
}

function modelInfo(chat, usage, catalog, geminiOnly) {
    const ids = [chat.modelDisplayName, chat.model, chat.responseModel, chat.responseModelFull, usage.model]
        .filter(value => typeof value === 'string' && value.length < 120);
    const mapped = ids.flatMap(value => catalog.get(value.toLowerCase()) || []);
    const candidates = [chat.modelDisplayName, ...mapped, ...ids].filter(Boolean);
    const geminiLabel = candidates.find(value => /gemini/i.test(value) && !/^MODEL_/i.test(value))
        || candidates.find(value => /gemini|\b(?:neon|carbon|argon|hydrogen)\b/i.test(value));
    const isGemini = geminiLabel || /^(?:API_PROVIDER_)?GOOGLE_GEMINI$|^24$/i.test(usage.apiProvider || '');
    if (!isGemini && geminiOnly) return null;
    const label = geminiLabel || candidates.find(value => !/^(?:\d+|MODEL_UNSPECIFIED)$/i.test(value));
    const clean = (label || (isGemini ? 'Gemini（型号未记录）' : '型号未记录'))
        .replace(/^models?\//i, '').replace(/^MODEL_/i, '').replace(/_/g, ' ')
        .replace(/^orchestrator[\s.-]+/i, '').replace(/^gemini\b/i, 'Gemini');
    const suffix = /[\s(（-]+(minimal|low|medium|high|very[ -]?high|extra|xhigh|max|ultra|off|none|auto|adaptive|极高|最高|极低|高|低|中)(?:[)）])?$/i;
    const match = clean.match(suffix);
    const start = chat.chatStartMetadata || {};
    const effort = [chat.thinkingLevel, chat.reasoningEffort, chat.effortLevel, chat.thinkingConfig?.thinkingLevel,
        start.thinkingLevel, start.reasoningEffort, start.effortLevel, start.thinkingConfig?.thinkingLevel,
        usage.thinkingLevel, usage.reasoningEffort, match?.[1]]
        .map(levelOf).find(Boolean);
    return { model: match ? clean.slice(0, match.index).trim() : clean, effort: effort || '未记录' };
}

function normalize(item, conversation, index, catalog, geminiOnly = true) {
    const chat = item?.chatModel;
    const usage = chat?.usage;
    if (!usage) return null;
    const grouping = modelInfo(chat, usage, catalog, geminiOnly);
    const amounts = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens];
    if (!grouping || !amounts.some(value => count(value) > 0)) return null;
    const uncached = count(usage.inputTokens);
    const read = count(usage.cacheReadTokens ?? 0);
    const write = count(usage.cacheWriteTokens ?? 0);
    const output = count(usage.outputTokens);
    const input = uncached === null || read === null || write === null ? null : uncached + read + write;
    const at = timestamp(chat.chatStartMetadata?.createdAt);
    const provider = String(usage.apiProvider || '');
    const identity = usage.responseId ? [provider, 'response', usage.responseId]
        : usage.messageId ? [provider, 'message', usage.messageId]
        : [conversation, index];
    const id = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    return { id, at, ...grouping, input, output, read, write, thinking: count(usage.thinkingOutputTokens) };
}

function aggregate(rows, days, now = new Date()) {
    const start = days === null ? null : firstDay(days, now);
    const requests = new Map();
    let undated = 0;
    for (const row of rows) {
        if (start !== null) {
            if (!Number.isFinite(row.at)) { undated++; continue; }
            if (row.at < start || row.at > +now) continue;
        }
        const previous = requests.get(row.id);
        if (!previous || (row.input ?? 0) + (row.output ?? 0) > (previous.input ?? 0) + (previous.output ?? 0)) {
            requests.set(row.id, row);
        }
    }
    const groups = new Map();
    for (const row of requests.values()) {
        const key = JSON.stringify([row.model, row.effort]);
        if (!groups.has(key)) groups.set(key, {
            model: row.model, effort: row.effort, input: 0, output: 0, thinking: 0, thinkingSamples: 0,
            read: 0, write: 0, requests: 0, incomplete: 0,
        });
        const group = groups.get(key);
        group.requests++;
        if (row.input === null || row.output === null) group.incomplete++;
        group.input += row.input ?? 0;
        group.output += row.output ?? 0;
        group.read += row.input === null ? 0 : row.read;
        group.write += row.input === null ? 0 : row.write;
        if (row.thinking !== null) {
            group.thinking += row.thinking;
            group.thinkingSamples++;
        }
    }
    const result = [...groups.values()].map(group => ({
        ...group, total: group.input + group.output,
        cacheRate: group.input ? group.read / group.input : null,
    })).sort((a, b) => b.total - a.total || a.model.localeCompare(b.model));
    const totals = result.reduce((all, row) => {
        for (const key of Object.keys(all)) all[key] += row[key];
        return all;
    }, { input: 0, output: 0, total: 0, read: 0, write: 0, requests: 0, incomplete: 0 });
    return { rows: result, totals, undated, start, end: +now };
}

async function localConversations() {
    const directory = path.join(homedir(), '.gemini', 'antigravity', 'conversations');
    const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const names = files.map(file => file.name);
    return Promise.all(files.filter(file => file.isFile() && file.name.endsWith('.db') &&
        UUID.test(file.name.slice(0, -3))).map(async file => {
        const db = await stat(path.join(directory, file.name));
        const wal = names.includes(file.name + '-wal') ? await stat(path.join(directory, file.name + '-wal')).catch(() => null) : null;
        return [file.name.slice(0, -3), {
            lastModifiedTime: new Date(Math.max(db.mtimeMs, wal?.mtimeMs ?? 0)).toISOString(), local: true,
        }];
    }));
}

function createReader(contents) {
    let pending;
    let snapshot;
    const catalog = new Map();
    let catalogRequest;
    let catalogCheckedAt = 0;
    const cache = new Map();
    const currentRequests = new Map();
    let currentSnapshot;
    async function readCatalog() {
        if (Date.now() - catalogCheckedAt < 60000) return;
        catalogRequest ||= (async () => {
            const user = await readUsage(contents, 'catalog').catch(() => ({}));
            if (!user.models?.length) return;
            catalog.clear();
            for (const config of user.models || []) {
                if (typeof config.name !== 'string') continue;
                for (const key of config.refs) {
                    if (typeof key !== 'string') continue;
                    const id = key.toLowerCase();
                    const labels = catalog.get(id) || [];
                    if (!labels.includes(config.name)) labels.push(config.name);
                    catalog.set(id, labels);
                }
            }
            for (const [key, labels] of catalog) if (labels.length !== 1) catalog.delete(key);
            catalogCheckedAt = Date.now();
        })().finally(() => { catalogRequest = null; });
        await catalogRequest;
    }
    async function readConversation(id, refresh) {
        if (!refresh && currentSnapshot?.id === id && Date.now() - currentSnapshot.at < 7000) {
            return currentSnapshot.data;
        }
        if (!currentRequests.has(id)) {
            const reading = (async () => {
                await readCatalog();
                const response = await readUsage(contents, 'trajectory', id);
                if (!response.available) throw new Error('本地会话不可读');
                const rows = response.rows.map(item => normalize(item, id, item.index, catalog, false)).filter(Boolean);
                const data = { status: 'ready', ...aggregate(rows, null) };
                currentSnapshot = { id, data, at: Date.now() };
                return data;
            })().finally(() => currentRequests.delete(id));
            currentRequests.set(id, reading);
        }
        return currentRequests.get(id);
    }
    async function collect() {
        const result = await readUsage(contents, 'summaries').catch(() => ({}));
        await readCatalog();
        const cutoff = firstDay(30);
        const summaries = new Map(await localConversations());
        for (const [id, summary] of result.summaries || []) {
            const local = summaries.get(id);
            const lastModifiedTime = Math.max(timestamp(summary.lastModifiedTime) || 0, timestamp(local?.lastModifiedTime) || 0);
            summaries.set(id, { ...summary, lastModifiedTime: lastModifiedTime || undefined });
        }
        const candidates = [...summaries]
            .filter(([id, summary]) => UUID.test(id) &&
                (!Number.isFinite(timestamp(summary?.lastModifiedTime)) || timestamp(summary.lastModifiedTime) >= cutoff))
            .sort((a, b) => (timestamp(b[1]?.lastModifiedTime) || 0) - (timestamp(a[1]?.lastModifiedTime) || 0));
        const keys = new Set(candidates.map(([id]) => id));
        for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key);
        let failed = 0;
        async function load(id, summary) {
            const modified = timestamp(summary?.lastModifiedTime);
            const key = JSON.stringify([modified, summary?.stepCount ?? null]);
            if (Number.isFinite(modified) && Date.now() - modified > 120000 && cache.get(id)?.key === key) return;
            const response = await readUsage(contents, 'trajectory', id);
            if (!response.available) throw new Error('本地会话不可读');
            const rows = response.rows.map(item => normalize(item, id, item.index, catalog))
                .filter(row => row && (!Number.isFinite(row.at) || row.at >= cutoff - DAY));
            cache.set(id, { key, rows });
        }
        const deadline = Date.now() + 25000;
        let next = 0;
        async function worker() {
            while (next < candidates.length && Date.now() < deadline) {
                const [id, summary] = candidates[next++];
                try { await load(id, summary); } catch { failed++; }
            }
        }
        await Promise.all([worker(), worker()]);
        const skipped = candidates.length - next;
        snapshot = {
            records: [...cache.values()].flatMap(item => item.rows), failed: failed + skipped,
            scanned: candidates.length - failed - skipped, at: Date.now(),
        };
        return snapshot;
    }
    return async (days, refresh) => {
        try {
            if (typeof days === 'string') return await readConversation(days, refresh);
            const fresh = snapshot && Date.now() - snapshot.at < (refresh ? 4000 : 45000);
            if (!fresh) {
                pending ||= collect().finally(() => { pending = null; });
                await pending;
            }
            return { status: 'ready', ...aggregate(snapshot.records, days), updated: snapshot.at,
                failed: snapshot.failed, scanned: snapshot.scanned };
        } catch (error) {
            const detail = error.message === '等待客户端加载历史服务' ? error.message : '本地历史服务读取失败';
            return { status: 'error', detail };
        }
    };
}

function register() {
    const { ipcMain } = require('electron');
    const readers = new WeakMap();
    ipcMain.handle(CHANNEL, (event, days, refresh) => {
        const validScope = windows.has(days) || typeof days === 'string' && UUID.test(days);
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !validScope) {
            return { status: 'offline' };
        }
        const url = new URL(event.senderFrame.url || 'about:blank');
        if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
            return { status: 'offline' };
        }
        if (!readers.has(event.sender)) readers.set(event.sender, createReader(event.sender));
        return readers.get(event.sender)(days, refresh === true);
    });
}

module.exports = { register, normalize, aggregate, firstDay };

'use strict';

// Renderer service discovery follows Obsidian Prism v1.0.7's read-only
// renderer RPC adapter. This implementation returns only usage metadata.
function readInAntigravity({ method, id }) {
    const root = document.getElementById('root') || document.body;
    const key = root && Object.keys(root).find(name => /^__react(?:Container|Fiber)\$/.test(name));
    if (!key) return { failure: '等待客户端加载历史服务' };
    const queue = [root[key]];
    const seen = new Set();
    const isService = value => value && typeof value.getUserStatus === 'function' &&
        typeof value.getCascadeTrajectory === 'function';
    const wantsContext = method === 'conversation';
    const isAgentManager = value => value && typeof value.peek === 'function' &&
        typeof value.getAgentStates === 'function';
    let service;
    let manager;
    for (let index = 0; index < queue.length && index < 5000 && (!service || wantsContext && !manager); index++) {
        const fiber = queue[index];
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        const value = fiber.memoizedProps?.value;
        if (!service && isService(value)) service = value;
        if (wantsContext && !manager) {
            if (isAgentManager(value)) manager = value;
            for (let link = fiber.dependencies?.firstContext, i = 0; link && !manager && i < 24; link = link.next, i++) {
                if (isAgentManager(link.memoizedValue)) manager = link.memoizedValue;
            }
        }
        if (fiber.child) queue.push(fiber.child);
        if (fiber.sibling) queue.push(fiber.sibling);
    }
    if (!service) return { failure: '等待客户端加载历史服务' };

    const str = value => typeof value === 'string' && value.length <= 160 ? value : undefined;
    const modelRef = value => typeof value === 'number' || typeof value === 'bigint' ? String(value) : str(value);
    const tokens = value => value === undefined || value === null ? undefined : String(value);
    const time = value => {
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'bigint') {
            const n = Number(value);
            return Number.isFinite(n) ? (n > 1e11 ? n : n * 1000) : undefined;
        }
        if (value?.seconds !== undefined) return Number(value.seconds) * 1000 + Number(value.nanos ?? 0) / 1e6;
    };
    const levels = object => ({
        thinkingLevel: str(object?.thinkingLevel ?? object?.thinkingConfig?.thinkingLevel),
        reasoningEffort: str(object?.reasoningEffort ?? object?.reasoningConfig?.effort),
        effortLevel: str(object?.effortLevel),
    });
    const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
    function contextWindow(raw, source) {
        const integer = value => {
            if (typeof value !== 'number' && typeof value !== 'bigint' &&
                !(typeof value === 'string' && /^\d+$/.test(value))) return null;
            const n = Number(value);
            return Number.isSafeInteger(n) && n >= 0 ? n : null;
        };
        const used = integer(raw?.estimatedTokensUsed);
        const limit = integer(raw?.maxContextTokens);
        return used === null ? null : { used, limit: limit || null, source,
            afterCompaction: raw.estimatedAfterCompaction === true };
    }

    return (async () => {
        if (method === 'catalog') {
            const result = await service.getUserStatus({});
            const items = result?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
            return { models: items.map(item => ({
                name: str(item.label),
                refs: [item.modelId, item.modelOrAlias?.choice?.value, item.modelOrAlias?.model, item.modelOrAlias?.alias]
                    .map(modelRef).filter(Boolean),
            })) };
        }
        if (method === 'summaries') {
            const result = typeof service.getAllCascadeTrajectories === 'function'
                ? await service.getAllCascadeTrajectories({ excludeSubtrajectories: false })
                : typeof service.searchConversations === 'function'
                    ? await service.searchConversations({ query: '' }) : {};
            const entries = result.trajectorySummaries
                ? Object.entries(result.trajectorySummaries)
                : (result.results || []).map(row => [row.cascadeId, row]);
            return { summaries: entries.filter(([key]) => uuid.test(key)).map(([key, row]) =>
                [key, { lastModifiedTime: time(row?.lastModifiedTime), stepCount: Number(row?.stepCount) || 0 }]) };
        }
        if ((!wantsContext && method !== 'trajectory') || !uuid.test(id)) return { failure: '无效的历史记录请求' };
        const result = await service.getCascadeTrajectory({ cascadeId: id });
        const trajectory = result?.trajectory;
        const steps = Array.isArray(trajectory?.steps) ? trajectory.steps : [];
        const items = Array.isArray(trajectory?.generatorMetadata) ? trajectory.generatorMetadata : [];
        let context = null;
        if (wantsContext) {
            try {
                const provider = manager?.peek(id);
                context = contextWindow(provider?.getState?.()?.contextWindowUsage, 'live');
            } catch {}
            context ||= contextWindow(result?.contextWindowUsage, 'history') ||
                contextWindow(trajectory?.contextWindowUsage, 'history');
            for (let index = items.length - 1; index >= 0 && !context; index--) {
                const item = items[index];
                const chat = item?.metadata?.case === 'chatModel' ? item.metadata.value : item?.chatModel;
                context = contextWindow(chat?.chatStartMetadata?.contextWindowMetadata, 'previous-request');
            }
        }
        return { rows: items.map((item, index) => {
            const chat = item?.metadata?.case === 'chatModel' ? item.metadata.value : item?.chatModel;
            const usage = chat?.usage;
            if (!usage) return null;
            const start = chat.chatStartMetadata;
            const fallback = (item.stepIndices || []).map(i => time(steps[Number(i)]?.metadata?.createdAt))
                .filter(value => value !== undefined).sort((a, b) =>
                    (typeof a === 'number' ? a : Date.parse(a)) - (typeof b === 'number' ? b : Date.parse(b)))[0];
            return {
                index,
                chatModel: {
                    model: modelRef(chat.model), modelDisplayName: str(chat.modelDisplayName),
                    responseModel: str(chat.responseModel), responseModelFull: str(chat.responseModelFull),
                    ...levels(chat),
                    chatStartMetadata: { createdAt: time(start?.createdAt) ?? fallback, ...levels(start) },
                    usage: {
                        model: modelRef(usage.model), apiProvider: modelRef(usage.apiProvider),
                        responseId: str(usage.responseId), messageId: str(usage.messageId),
                        inputTokens: tokens(usage.inputTokens), outputTokens: tokens(usage.outputTokens),
                        cacheReadTokens: tokens(usage.cacheReadTokens), cacheWriteTokens: tokens(usage.cacheWriteTokens),
                        thinkingOutputTokens: tokens(usage.thinkingOutputTokens), ...levels(usage),
                    },
                },
            };
        }).filter(Boolean), available: Boolean(trajectory || context), ...(wantsContext ? { context } : {}) };
    })();
}

async function readUsage(contents, method, id) {
    const source = '(' + readInAntigravity.toString() + ')(' + JSON.stringify({ method, id }) + ')';
    let timeout;
    try {
        const result = await Promise.race([
            contents.executeJavaScript(source),
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('历史服务响应超时')), 9000);
            }),
        ]);
        if (!result || result.failure) throw new Error(result?.failure || '无法读取历史服务');
        return result;
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = { readUsage };

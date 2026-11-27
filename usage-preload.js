(() => {
    if (window.top !== window || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
    const { ipcRenderer } = require('electron');
    const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
    const numbers = new Intl.NumberFormat('zh-CN');
    const compact = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
    const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });
    const periods = [[1, '今天'], [7, '近 7 天'], [30, '近 30 天']];

    function element(tag, className, value) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (value !== undefined) node.textContent = value;
        return node;
    }

    function button(className, value) {
        const node = element('button', className, value);
        node.type = 'button';
        return node;
    }

    function conversationFor(composer) {
        const scopedView = composer.closest('[data-cascade-id]');
        const id = scopedView?.getAttribute('data-cascade-id');
        if (uuid.test(id || '')) return id.toLowerCase();
        if (composer.closest('[data-testid="side-question-tab-content"], [data-testid="subagent-tab-conversation"], [data-media-drop-scope="subpane"]')) {
            return null;
        }
        const route = location.pathname.match(/\/c\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
        return uuid.test(route || '') ? route.toLowerCase() : null;
    }

    function mount(conversation = false) {
        const hostId = conversation ? 'conversation-usage-capsule' : 'gemini-usage-capsule';
        const title = conversation ? '本次对话用量' : 'Gemini Token 用量';
        if (!document.body || document.getElementById(hostId)) return;
        const host = element('div');
        host.id = hostId;
        host.setAttribute('data-ag-localization-skip', '');
        host.style.cssText = 'position:fixed;z-index:620;pointer-events:none;width:0;height:0;visibility:hidden;';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = element('style');
        style.textContent = `
          :host{--surface:#fbfcff;--soft:#edf2fb;--ink:#172033;--muted:#556581;--line:#dbe3f2;--accent:#285ec0;--bar:#4478dd;--shadow:0 15px 38px #0c224536;color-scheme:light;font:13px/1.45 system-ui,sans-serif}
          :host([data-dark]){--surface:#1e2431;--soft:#293449;--ink:#eef3ff;--muted:#a8b9d8;--line:#3a455d;--accent:#a4bfff;--bar:#799df8;--shadow:0 15px 38px #0008;color-scheme:dark}
          *{box-sizing:border-box} [hidden]{display:none!important}
          button{font:inherit;cursor:pointer;color:inherit}
          button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
          .pill,.panel{position:absolute;pointer-events:auto;-webkit-app-region:no-drag;color:var(--ink);background:var(--surface);border:1px solid var(--line)}
          .pill{top:0;left:0;width:62px;height:24px;white-space:nowrap;display:flex;justify-content:center;gap:5px;align-items:center;border-radius:999px;padding:0;box-shadow:0 2px 6px #101e3317;font-weight:650;font-size:12px}
          .dot{color:var(--accent);font-size:13px}
          .panel{top:32px;left:var(--panel-offset,0px);width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 103px);overflow:auto;overscroll-behavior:contain;border-radius:14px;box-shadow:var(--shadow);padding:14px}
          .head,.row-top,.meta,.tabs{display:flex;align-items:center;gap:8px}.head,.row-top{justify-content:space-between}
          .title{font-size:15px;font-weight:730}.close,.refresh,.tab{background:none;border:0;border-radius:7px;padding:5px 8px;color:var(--muted)}
          .close:hover,.refresh:hover,.tab:hover{background:var(--soft)}.close{font-size:17px;line-height:1}.controls{display:flex;gap:4px}
          .tabs{gap:3px;width:max-content;padding:3px;background:var(--soft);border-radius:9px;margin:12px 0}
          .tab[aria-pressed=true]{background:var(--surface);color:var(--accent);font-weight:700;box-shadow:0 1px 4px #18264820}
          .summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-bottom:10px}
          .metric{background:var(--soft);padding:9px 8px;border-radius:9px;min-width:0}.metric b{display:block;font-size:17px;font-variant-numeric:tabular-nums}
          .label,.meta,.foot,.status{color:var(--muted)}.meta,.foot,.label{font-size:11px}.meta{gap:10px;flex-wrap:wrap}
          .row{padding:9px 0;border-top:1px solid var(--line)}.model{min-width:0;overflow-wrap:anywhere;font-weight:680}.total{flex:none;font-weight:700;font-variant-numeric:tabular-nums}
          .effort{display:inline-block;font-size:11px;color:var(--accent);background:var(--soft);border-radius:5px;padding:1px 5px;margin-left:5px;white-space:nowrap}
          .track{height:3px;margin:6px 0;background:var(--soft);border-radius:4px;overflow:hidden}.bar{height:100%;background:var(--bar)}
          .context{margin-bottom:10px;padding:10px;border:1px solid var(--line);border-radius:9px}
          .context .track{height:6px;margin:8px 0}
          .context .bar[data-level=high]{background:#bd6b24}.context .bar[data-level=full]{background:#c94a56}
          .foot{border-top:1px solid var(--line);padding-top:8px}.status{padding:13px 0}.section{font-size:12px;font-weight:700;margin:5px 0}
          .convo{width:26px;height:26px;border-radius:50%}
          .convo .chart{width:12px;height:10px;display:flex;align-items:end;gap:2px}
          .convo .chart span{flex:1;background:var(--accent);border-radius:1px;height:48%}
          .convo .chart span:nth-child(2){height:76%}.convo .chart span:nth-child(3){height:100%}
          .convo[aria-expanded=true]{background:var(--soft)}
          .up{top:auto;bottom:8px;max-height:min(550px,var(--panel-height,400px))}
          .up .head{margin-bottom:10px}
          @media (max-width:370px){.summary{gap:4px}.metric{padding:7px 4px}.metric b{font-size:14px}}
        `;
        const pill = button(conversation ? 'pill convo' : 'pill');
        const pillLabel = conversation ? title : 'Gemini 用量';
        pill.setAttribute('aria-label', pillLabel);
        pill.title = pillLabel;
        pill.setAttribute('aria-controls', 'usage-panel');
        pill.setAttribute('aria-expanded', 'false');
        if (conversation) {
            const chart = element('span', 'chart');
            chart.setAttribute('aria-hidden', 'true');
            chart.append(element('span'), element('span'), element('span'));
            pill.append(chart);
        } else {
            pill.append(element('span', 'dot', '✦'), element('span', '', '用量'));
        }
        const panel = element('section', conversation ? 'panel up' : 'panel');
        panel.id = 'usage-panel';
        panel.hidden = true;
        panel.setAttribute('aria-label', title);
        const close = button('close', '×');
        close.setAttribute('aria-label', '关闭用量面板');
        const refresh = button('refresh', '刷新');
        const controls = element('div', 'controls');
        controls.append(refresh, close);
        const head = element('div', 'head');
        head.append(element('div', 'title', title), controls);
        const tabs = element('div', 'tabs');
        const body = element('div');
        body.setAttribute('aria-live', 'polite');
        panel.append(head);
        if (!conversation) panel.append(tabs);
        panel.append(body);
        shadow.append(style, pill, panel);
        document.body.append(host);

        let days = 1;
        let serial = 0;
        let timer;
        let conversationId = null;
        const tabButtons = new Map((conversation ? [] : periods).map(([value, label]) => {
            const tab = button('tab', label);
            tab.setAttribute('aria-pressed', String(value === days));
            tab.addEventListener('click', () => {
                days = value;
                for (const [period, control] of tabButtons) control.setAttribute('aria-pressed', String(period === days));
                load();
            });
            tabs.append(tab);
            return [value, tab];
        }));

        function setTheme() {
            const scheme = (getComputedStyle(document.documentElement).colorScheme || '').trim();
            const dark = scheme === 'dark' || document.documentElement.classList.contains('dark') ||
                document.documentElement.dataset.theme === 'dark' ||
                (scheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
            host.toggleAttribute('data-dark', dark);
        }
        const interactive = 'button,a[href],input,select,[role="button"],[role="menuitem"],[role="tab"],[contenteditable="true"]';
        function hide() {
            if (!panel.hidden) toggle(false);
            host.style.visibility = 'hidden';
        }
        function positionByComposer() {
            const composers = [...document.querySelectorAll('[data-testid="agent-input-box"]')];
            const main = composers.find(box =>
                !box.closest('[data-testid="side-question-tab-content"],[data-testid="subagent-tab-conversation"],[data-media-drop-scope="subpane"]') &&
                box.getBoundingClientRect().height > 0 && conversationFor(box));
            const toolbar = '.agy-composer-footer,[data-agent-composer-root],[data-testid="input-box-bottom-toolbar"]';
            const permission = main?.querySelector('[data-testid="permissions-selector-trigger"]') ||
                Array.from(main?.querySelectorAll('button') || []).find(node =>
                    /permission|权限|极速|默认|安全|Fast|Turbo/i.test(node.getAttribute('aria-label') || node.textContent.trim()));
            const footer = permission?.closest(toolbar);
            const anchor = permission?.getBoundingClientRect();
            if (!footer || !main.contains(footer) || !anchor?.width || anchor.bottom >= innerHeight || anchor.top < 54) return hide();

            const size = 26;
            const top = Math.round(anchor.top + (anchor.height - size) / 2);
            const row = footer.getBoundingClientRect();
            const occupied = [...footer.querySelectorAll(interactive)].map(node => node.getBoundingClientRect())
                .filter(rect => rect.width && rect.height && rect.bottom > top && rect.top < top + size);
            // Keep a gap beside the permission button. Try nearby positions
            // within this toolbar only, so a narrow pane cannot cover a control.
            const preferred = Math.round(anchor.left - 15 - size);
            let left = preferred;
            for (; left >= Math.max(row.left + 6, preferred - 78); left -= 3) {
                if (occupied.every(rect => rect.right + 5 <= left || rect.left - 5 >= left + size)) break;
            }
            if (left < Math.max(row.left + 6, preferred - 78)) return hide();
            if ([3, 13, 23].some(x => document.elementsFromPoint(left + x, top + 13)
                .some(node => node !== host && !footer.contains(node) && node.closest(interactive)))) return hide();
            const panelWidth = Math.min(440, innerWidth - 32);
            const panelLeft = Math.max(16, Math.min(innerWidth - 16 - panelWidth, left + size - panelWidth));
            host.style.left = left + 'px';
            host.style.top = top + 'px';
            host.style.setProperty('--panel-offset', (panelLeft - left) + 'px');
            host.style.setProperty('--panel-height', Math.max(65, top - 65) + 'px');
            host.style.visibility = 'visible';
            const next = conversationFor(main);
            if (next !== conversationId) {
                conversationId = next;
                serial++;
                if (!panel.hidden) load();
            }
        }
        const isSearch = node => {
            const label = node.getAttribute('aria-label') || node.getAttribute('title') || '';
            return /^(搜索会话|search conversations)(?:$|\s|[（(])/i.test(label) ||
                /^(sidebar-search-toggle|search-conversations-button)$/.test(node.dataset.testid || '');
        };
        function position() {
            if (conversation) return positionByComposer();
            const width = 62;
            const height = 24;
            const buttons = [...document.querySelectorAll(interactive)];
            const search = buttons.find(node => {
                if (!isSearch(node)) return false;
                const box = node.getBoundingClientRect();
                return box.left < 230 && box.top < 80 && box.width > 0 && box.height > 0;
            })?.getBoundingClientRect();
            const top = Math.round(search ? search.top + (search.height - height) / 2 : 38);
            const start = Math.ceil(search ? search.right + 7 : 185);
            const settings = buttons.find(node => {
                const rect = node.getBoundingClientRect();
                const label = node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent.trim();
                return rect.left < 36 && rect.bottom > innerHeight - 70 && rect.bottom <= innerHeight &&
                    /^(设置|settings)$/i.test(label);
            })?.getBoundingClientRect();
            const occupied = buttons.flatMap(node => {
                const rect = node.getBoundingClientRect();
                if (!rect.width || rect.bottom <= top - 3 || rect.top >= top + height + 3) return [];
                const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
                const y = Math.min(innerHeight - 1, Math.max(0, Math.max(rect.top, top) + 3));
                const hits = document.elementsFromPoint(x, y);
                return hits.some(hit => hit === node || node.contains(hit)) ? [rect] : [];
            });
            let left = start;
            const end = Math.min(innerWidth - 90 - width, start + 460);
            for (; left <= end; left += 3) {
                if (occupied.every(rect => rect.right + 4 <= left || rect.left - 4 >= left + width)) break;
            }
            if (left > end) {
                return hide();
            }
            const panelWidth = Math.min(440, innerWidth - 32);
            const panelLeft = Math.min(innerWidth - 16 - panelWidth, Math.max(left, settings?.right + 10 || 0));
            host.style.left = left + 'px';
            host.style.top = top + 'px';
            host.style.setProperty('--panel-offset', (panelLeft - left) + 'px');
            host.style.visibility = 'visible';
        }
        let repositionTimer;
        function schedulePosition() {
            if (repositionTimer) return;
            repositionTimer = setTimeout(() => {
                repositionTimer = undefined;
                position();
            }, 180);
        }
        function metric(label, value, title) {
            const card = element('div', 'metric');
            if (title) card.title = title;
            card.append(element('span', 'label', label), element('b', '', value));
            return card;
        }
        function contextCard(context) {
            const card = element('div', 'context');
            const header = element('div', 'row-top');
            header.append(element('div', 'model', '上下文窗口'));
            card.append(header);
            if (!context) {
                card.append(element('div', 'label', '暂无上下文统计'));
                return card;
            }
            const { used, limit, source, afterCompaction } = context;
            const details = element('div', 'meta');
            details.append(element('span', '', '已用约 ' + numbers.format(used) + ' Token'));
            if (limit) {
                const fraction = used / limit;
                const scale = element('div', 'track');
                const fill = element('div', 'bar');
                fill.style.width = Math.min(100, fraction * 100) + '%';
                if (fraction >= 0.8) fill.dataset.level = fraction >= 0.95 ? 'full' : 'high';
                scale.setAttribute('role', 'progressbar');
                scale.setAttribute('aria-label', '上下文占用');
                scale.setAttribute('aria-valuemax', '100');
                scale.setAttribute('aria-valuenow', String(Math.round(Math.min(1, fraction) * 100)));
                scale.setAttribute('aria-valuetext', numbers.format(used) + ' / ' + numbers.format(limit) + ' Token');
                scale.append(fill);
                header.append(element('span', 'total', percent.format(fraction)));
                details.append(element('span', '', '上限 ' + numbers.format(limit)),
                    element('span', '', '剩余约 ' + numbers.format(Math.max(0, limit - used))));
                card.append(scale);
            } else {
                details.append(element('span', '', '上限未提供'));
            }
            const caption = { live: '当前估算', history: '会话最近记录', 'previous-request': '最近一次模型请求开始时的估算' };
            card.append(details, element('div', 'label', afterCompaction ? '压缩后的估算' : caption[source]));
            return card;
        }
        function render(data) {
            if (data.status !== 'ready') {
                body.replaceChildren(element('div', 'status', data.status === 'offline'
                    ? '本地语言服务还没就绪，稍后再刷新。' : '暂时读不到本地用量，点击「刷新」重试。' + (data.detail ? ' ' + data.detail : '')));
                return;
            }
            const totals = data.totals;
            const context = conversation ? [contextCard(data.context)] : [];
            if (!totals.requests) {
                const reason = data.failed ? '部分历史记录没能读取。' : conversation
                    ? '本次对话还没有可统计的模型用量。' : '这段时间没有找到带日期的 Gemini 用量记录。';
                body.replaceChildren(...context, element('div', 'status', reason));
                return;
            }
            const summary = element('div', 'summary');
            summary.append(metric('总 Token', compact.format(totals.total), numbers.format(totals.total)),
                metric('模型请求', numbers.format(totals.requests)),
                metric('缓存命中率', totals.input ? percent.format(totals.read / totals.input) : '—',
                    '缓存读取 Token ÷ 全部输入 Token'));
            const list = element('div');
            list.append(element('div', 'section', '按模型和思考档位'));
            for (const row of data.rows) {
                const share = totals.total ? row.total / totals.total : 0;
                const line = element('div', 'row');
                const top = element('div', 'row-top');
                const model = element('div', 'model', row.model);
                model.append(element('span', 'effort', row.effort));
                top.append(model, element('span', 'total', numbers.format(row.total) + ' · ' + percent.format(share)));
                const track = element('div', 'track');
                const bar = element('div', 'bar');
                bar.style.width = String(share * 100) + '%';
                track.append(bar);
                const details = [
                    '输入 ' + numbers.format(row.input),
                    '输出 ' + numbers.format(row.output),
                    '缓存读取 ' + numbers.format(row.read),
                    '缓存命中 ' + (row.cacheRate === null ? '—' : percent.format(row.cacheRate)),
                ];
                if (row.thinkingSamples) details.push('思考 ' + numbers.format(row.thinking));
                if (row.write) details.push('缓存写入 ' + numbers.format(row.write));
                const meta = element('div', 'meta');
                meta.append(...details.map(detail => element('span', '', detail)));
                line.append(top, track, meta);
                list.append(line);
            }
            const notes = [conversation ? '占比按本次对话的总 Token 计算 · 缓存命中率以输入 Token 为分母'
                : '本机历史 · 按本地日期汇总 · 缓存命中率以输入 Token 为分母'];
            if (data.failed) notes.push(data.failed + ' 个会话未完整读取');
            if (data.undated) notes.push(data.undated + ' 条缺少日期，未计入');
            if (totals.incomplete) notes.push(totals.incomplete + ' 次请求部分计数缺失');
            body.replaceChildren(...context, summary, list, element('div', 'foot', notes.join(' · ')));
        }
        async function load(force = false, quiet = false) {
            if (conversation && !conversationId) return;
            const request = ++serial;
            if (!quiet) body.replaceChildren(element('div', 'status', '正在读取本机用量…'));
            try {
                const data = await ipcRenderer.invoke('gemini-usage-capsule:summary', conversation ? conversationId : days, force);
                if (request === serial && !panel.hidden) render(data);
            } catch (error) {
                if (request === serial && !panel.hidden) render({ status: 'error', detail:
                    /No handler registered/i.test(String(error)) ? '用量模块未启动' : '应用内部通信异常' });
            }
        }
        function toggle(open, focus = false) {
            setTheme();
            panel.hidden = !open;
            pill.setAttribute('aria-expanded', String(open));
            clearInterval(timer);
            if (open) {
                load();
                timer = setInterval(() => load(false, true), conversation ? 15000 : 45000);
            } else if (focus) pill.focus();
        }
        pill.addEventListener('click', () => toggle(panel.hidden));
        close.addEventListener('click', () => toggle(false, true));
        refresh.addEventListener('click', () => load(true));
        document.addEventListener('pointerdown', event => {
            if (!panel.hidden && !event.composedPath().includes(host)) toggle(false);
        }, true);
        shadow.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !panel.hidden) {
                event.stopPropagation();
                toggle(false, true);
            }
        });
        new MutationObserver(setTheme).observe(document.documentElement, {
            attributes: true, attributeFilter: ['class', 'data-theme', 'style'],
        });
        new MutationObserver(records => {
            if (records.some(record => record.target !== host)) schedulePosition();
        }).observe(document.body, {
            subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-expanded', 'data-cascade-id'],
        });
        window.addEventListener('resize', schedulePosition);
        if (conversation) window.addEventListener('scroll', schedulePosition, true);
        setTheme();
        position();
    }

    function start() {
        const selector = '[data-testid="agent-input-box"], [data-testid="conversation-view"], [data-testid="model-selector-trigger"]';
        const mountBoth = () => { mount(); mount(true); };
        if (document.querySelector(selector)) return mountBoth();
        const observer = new MutationObserver(() => {
            if (!document.querySelector(selector)) return;
            observer.disconnect();
            mountBoth();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 60000);
    }
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();

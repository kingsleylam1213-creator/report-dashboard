import { pagesRequest } from './pages-runtime.mjs';
import { createModel, summarize, total, oldUnits, key, csvCell } from './model.mjs';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => v == null ? '—' : Number(v).toLocaleString('zh-CN');
const percent = (v, n) => n > 0 ? `${(v / n * 100).toFixed(1)}%` : '—';
const colors = ['#76a39c', '#638ac0', '#d9b66a', '#df946b', '#c87678'];
const titles = { overview: ['刊登与库存总览', '从库存到上架，找到每一个待补齐的销售机会。', '经营总览'], matrix: ['店铺上架矩阵', '按款式和站点展开，一眼看清各店铺的 SKU 覆盖。', '店铺上架矩阵'], detail: ['SKU 与库龄明细', '查看完整产品库、在售链接和各站点库存。', 'SKU 与库龄'], pending: ['有货待上架', '优先处理有站点库存、尚无在售链接的 SKU。', '待上架清单'], data: ['数据更新与核对', '维护源表和站点关联，让每次更新都有据可查。', '数据更新与核对'] };
let data, model, view = 'overview', page = 1, pageSize = 35, visibleRows = [], matrixGroups = [], matrixIncludeEmpty = false;
let filters = { site: '', shop: '', category: '', status: '', stock: '', search: '' };
let running = false, pollTimer, lastVersion = '', searchTimer, loading = false;
let session = { mode: 'local', canEdit: true, role: 'admin' };

function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, 4200); }
async function request(url, body) { return pagesRequest(url, body); }

function option(value, label, selected = '') { return `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`; }
function badge(status) { return `<span class="status ${status.code}" title="${esc(status.reason)}">${esc(status.label)}</span>`; }
function siteName(code) { const site = model.sites.get(code); return site ? `${site.name === code ? '' : site.name + ' '}${code}` : code === '未分配' ? '无站点记录' : code; }
function rowName(r) { return esc(r.unmatchedLink ? r.unmatchedLink.platformSku : r.sku); }
function stockCell(r) {
  if (r.inv) return `<strong class="em-number">${num(total(r.inv))}</strong>`;
  const capacity = model.capacity(r);
  if (capacity !== null) return `<span title="成分库存的独立测算，不计入实物库存合计">可组 ${num(capacity)} 套</span>`;
  return `<span title="${r.site === '未分配' ? '产品暂无站点库存记录' : r.pool ? '此库存池中没有该SKU记录' : '此站点尚未提供库存或未配置库存池'}">—</span>`;
}
function productCell(r) { return `<div class="product-cell"><b>${rowName(r)}</b>${r.product.kind === 'bundle' ? ' <span class="bundle-note">组合</span>' : ''}<span class="product-name" title="${esc(r.product.name)}">${esc(r.product.name || '产品名称待补充')}</span><span class="subcode">款式 ${esc(r.product.spu)}</span></div>`; }
function shopBadges(r) {
  const links = model.linksFor(r, filters.shop);
  const shops = [...new Set(links.direct.map(l => l.shop))];
  const combo = [...new Set(links.bundle.map(l => l.shop))].filter(s => !shops.includes(s));
  if (!shops.length && !combo.length) return '<span class="subcode">暂无已归属在售链接</span>';
  return shops.slice(0, 3).map(s => `<span class="shop-badge">${esc(s)}</span>`).join('') + (shops.length > 3 ? `<span class="subcode">另 ${shops.length - 3} 家</span>` : '') + (combo.length ? `<div class="bundle-note">组合：${esc(combo.slice(0, 2).join('、'))}${combo.length > 2 ? ` 等${combo.length}家` : ''}</div>` : '');
}
function kpis(s) {
  return `<div class="kpi-grid">
    <div class="kpi emphasis"><div class="kpi-head">实物总库存<span class="kpi-icon">▧</span></div><div class="kpi-value">${num(s.units)}<small>件</small></div><div class="kpi-sub">按库存池与 SKU 去重计算</div></div>
    <div class="kpi"><div class="kpi-head">款式 / SPU<span class="kpi-icon">▦</span></div><div class="kpi-value">${num(s.styles)}</div><div class="kpi-sub">筛选范围 ${num(s.skus)} 个 SKU</div></div>
    <div class="kpi"><div class="kpi-head">已覆盖 SKU<span class="kpi-icon">↗</span></div><div class="kpi-value">${num(s.activeSkus)}</div><div class="kpi-sub">含直接在售与组合成分在售</div></div>
    <div class="kpi"><div class="kpi-head">有货待上架<span class="kpi-icon">◷</span></div><div class="kpi-value warning-number">${num(s.counts.pending)}</div><div class="kpi-sub">SKU × 站点 · 共 ${num(s.pendingUnits)} 件</div></div>
    <div class="kpi"><div class="kpi-head">超 180 天库存<span class="kpi-icon">◴</span></div><div class="kpi-value">${num(s.old)}</div><div class="kpi-sub">占实物库存 ${percent(s.old, s.units)}</div></div>
    <div class="kpi"><div class="kpi-head">365 天以上库存<span class="kpi-icon">◷</span></div><div class="kpi-value">${num(s.bands[4])}</div><div class="kpi-sub">占实物库存 ${percent(s.bands[4], s.units)}</div></div>
  </div>`;
}
function ageChart(rows) {
  const pools = new Map();
  for (const r of rows) if (r.inv) { if (!pools.has(r.pool)) pools.set(r.pool, new Map()); pools.get(r.pool).set(r.inv.physicalKey, r.inv); }
  let content = '';
  for (const [pool, invs] of [...pools].sort((a, b) => [...b[1].values()].reduce((n, v) => n + total(v), 0) - [...a[1].values()].reduce((n, v) => n + total(v), 0))) {
    const bands = [0, 0, 0, 0, 0]; for (const v of invs.values()) v.bands.forEach((x, i) => bands[i] += x);
    const units = bands.reduce((a, b) => a + b, 0);
    const label = pool === 'US' ? '美国' : pool === 'UK' ? '英国' : pool === 'DE' ? '德国' : pool === 'AU' ? '澳大利亚' : pool;
    content += `<div class="age-row"><div class="age-site"><strong>${esc(label)}</strong><small>${esc(pool)}</small></div><div class="stacked-track" role="img" aria-label="${esc(pool)} 库存 ${num(units)} 件">${bands.map((v, i) => `<div class="age-segment" style="width:${units ? v / units * 100 : 0}%;background:${colors[i]}" title="${data.meta.bandNames[i]}：${num(v)} 件（${percent(v, units)}）">${units && v / units > .12 ? percent(v, units) : ''}</div>`).join('')}</div><div class="age-value">${num(units)}<span class="subcode">件</span></div></div>`;
  }
  return `<section class="panel"><div class="panel-heading"><div><h2>站点库存与库龄分布</h2><p>按实物库存池汇总，查看库存沉淀在哪个区间。</p></div><button class="text-button" data-age-summary>查看数量汇总 ›</button></div><div class="panel-content"><div class="legend">${data.meta.bandNames.map((b, i) => `<span><i style="background:${colors[i]}"></i>${b}</span>`).join('')}</div>${content || '<div class="empty">此筛选范围暂无实物库存记录</div>'}<div class="chart-note">${pools.size} 个库存池。完整库龄段数量见 SKU 明细。精确平均库龄与累计库龄天数需要逐件入库日期，当前源表未提供。</div></div></section>`;
}
function donutChart(rows) {
  const inventoryRows = rows.filter(r => total(r.inv) > 0);
  const states = { active: 0, bundle: 0, pending: 0, check: 0 };
  for (const r of inventoryRows) { const state = model.status(r, filters.shop).code; if (state in states) states[state]++; }
  const count = inventoryRows.length, covered = states.active + states.bundle, ratio = count ? covered / count : 0;
  const config = [['active', '单品／组合SKU在售', '#568b78'], ['bundle', '仅组合成分在售', '#8da4bd'], ['pending', '有货待上架', '#dfb56d'], ['check', '待核对站点／SKU', '#d8a096']];
  let offset = 0;
  const arcs = config.map(([s, , color]) => { const length = count ? states[s] / count * 314.159 : 0; const a = `<circle cx="75" cy="75" r="50" fill="none" stroke="${color}" stroke-width="13" stroke-dasharray="${length} ${314.159 - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 75 75)"/>`; offset += length; return a; }).join('');
  return `<section class="panel"><div class="panel-heading"><div><h2>有库存 SKU 上架覆盖</h2><p>以 SKU × 站点为统计单位</p></div></div><div class="panel-content"><div class="donut-layout"><svg class="donut" viewBox="0 0 150 150" role="img" aria-label="上架覆盖率${percent(covered, count)}"><circle cx="75" cy="75" r="50" fill="none" stroke="#eef2f0" stroke-width="13"/>${arcs}<text x="75" y="75" text-anchor="middle" fill="#34594e" font-size="24" font-weight="600">${count ? (ratio * 100).toFixed(1) + '%' : '—'}</text><text x="75" y="93" text-anchor="middle" fill="#a5b1af" font-size="9">上架覆盖率</text></svg><div class="donut-legend">${config.map(([s, label, color]) => `<div class="donut-item"><i style="background:${color}"></i><span>${label}</span><b>${num(states[s])}</b></div>`).join('')}</div></div><div class="mini-alert"><span>◷</span><span>${states.pending ? `${num(states.pending)} 个有货 SKU × 站点暂无在售链接，可安排上架。` : '当前筛选范围没有已确认的有货待上架项。'}${states.check ? ` 另有 ${num(states.check)} 项需核对。` : ''}</span><button data-go="pending">查看清单</button></div></div></section>`;
}
function storeChart(rows) {
  const shops = new Map();
  for (const r of rows.filter(r => !r.unmatchedLink && r.site !== '待确认')) for (const l of [...model.linksFor(r).direct, ...model.linksFor(r).bundle]) {
    if (filters.shop && l.shop !== filters.shop) continue;
    if (!shops.has(l.shop)) shops.set(l.shop, new Set()); shops.get(l.shop).add(r.id);
  }
  const ranking = [...shops].sort((a, b) => b[1].size - a[1].size).slice(0, 9);
  const max = Math.max(...ranking.map(([, s]) => s.size), 1);
  return `<section class="panel"><div class="panel-heading"><div><h2>店铺上架覆盖</h2><p>已知 SKU × 站点数量，含组合成分</p></div><button class="text-button" data-go="matrix">全部店铺 ›</button></div><div class="panel-content">${ranking.map(([shop, set]) => `<div class="store-bar-row"><button data-shop="${esc(shop)}" title="筛选${esc(shop)}">${esc(shop)}</button><div class="store-track"><span style="width:${set.size / max * 100}%"></span></div><b>${num(set.size)}</b></div>`).join('') || '<div class="empty">暂无已归属的在售记录</div>'}<div class="chart-note">仅统计已匹配 SKU 且已知站点的记录；缺失关联见核对区。同一组合的成分分别展示覆盖。</div></div></section>`;
}
function pendingRows(rows) { return rows.filter(r => model.status(r, filters.shop).code === 'pending').sort((a, b) => (b.inv?.bands[4] || 0) - (a.inv?.bands[4] || 0) || oldUnits(b.inv) - oldUnits(a.inv) || total(b.inv) - total(a.inv)); }
function miniPending(rows) {
  const pending = pendingRows(rows);
  return `<section class="panel overview-pending-table"><div class="table-toolbar"><h2>优先上架提醒</h2><span class="result-count">${num(pending.length)} 项</span><div class="toolbar-end"><button class="text-button" data-go="pending">查看全部 ›</button></div></div><div class="table-wrap"><table><thead><tr><th>产品 SKU / 款式</th><th>站点</th><th class="number">库存</th><th class="number">超180天</th><th>操作</th></tr></thead><tbody>${pending.slice(0, 7).map(r => `<tr><td>${productCell(r)}</td><td class="site-label">${esc(r.site)}</td><td class="number">${stockCell(r)}</td><td class="number old-number">${num(oldUnits(r.inv))}</td><td><button class="link-button" data-detail="${esc(r.id)}">核对上架 ›</button></td></tr>`).join('')}</tbody></table>${pending.length ? '' : '<div class="empty">当前筛选范围没有有货待上架项</div>'}</div></section>`;
}
function qualityBanner() {
  const n = data.meta.issueCounts['在售记录缺少站点'] || 0;
  const m = data.meta.issueCounts['在售记录未匹配SKU'] || 0;
  return n || m ? `<div class="info-banner"><span>${n ? `${num(n)} 行在售记录缺少站点` : ''}${n && m ? '，' : ''}${m ? `${num(m)} 行缺少 SKU 关联` : ''}。上架提醒按成功关联的数据判断，请先补齐核对项。</span><button class="text-button" data-go="data">前往核对 ›</button></div>` : '';
}
function pagination(count) {
  const pages = Math.max(1, Math.ceil(count / pageSize)); page = Math.min(page, pages);
  return `<div class="pagination"><span>共 ${num(count)} 项 · 每页 ${pageSize} 项</span><button class="page-button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${page} / ${num(pages)}</span><button class="page-button" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>下一页</button></div>`;
}
function detailTable(rows, isPending = false) {
  visibleRows = isPending ? pendingRows(rows) : [...rows].sort((a, b) => (total(b.inv) || 0) - (total(a.inv) || 0) || a.sku.localeCompare(b.sku));
  const count = visibleRows.length;
  page = Math.max(1, Math.min(page, Math.ceil(count / pageSize) || 1));
  const subset = visibleRows.slice((page - 1) * pageSize, page * pageSize);
  const pending = summarize(model, visibleRows, filters.shop);
  let heading = isPending ? `<div class="pending-summary"><strong>${num(count)}</strong> 个 SKU × 站点待上架<span class="separator">/</span>关联实物库存 <strong>${num(pending.units)}</strong> 件<span class="separator">/</span>超180天 ${num(pending.old)} 件</div><div class="info-banner"><span>${filters.shop ? `当前按 ${esc(filters.shop)} 检查上架缺口；其他店铺已售情况仍可在详情中查看。` : '当前按全部店铺检查。选择某个店铺，可查看该店铺尚未覆盖的有货 SKU。'} 最老库龄和库存数量高的产品优先展示。</span><button class="text-button" id="include-bundle-button">${filters.status === 'bundle' ? '查看有货待上架' : '查看仅组合在售项'}</button></div>` : `<div class="info-banner"><span>包含完整产品库。没有任何库存或刊登记录的 SKU 归入“无站点记录”；选择站点后可查看对应的未上架产品。</span><span>${num(data.meta.counts.products)} 个产品编码</span></div>`;
  if (isPending && filters.status === 'bundle') {
    visibleRows = rows.filter(r => model.status(r, filters.shop).code === 'bundle');
    return detailTableBase(visibleRows, '仅组合在售 SKU', '<div class="info-banner"><span>这些单品目前作为组合成分在售，可核对是否需要补充单品链接。</span><button class="text-button" id="include-bundle-button">查看有货待上架</button></div>');
  }
  return detailTableBase(visibleRows, isPending ? '待上架 SKU 清单' : 'SKU 库存与刊登明细', heading);
}
function detailTableBase(rows, label, before = '') {
  visibleRows = rows;
  const count = rows.length;
  page = Math.max(1, Math.min(page, Math.ceil(count / pageSize) || 1));
  const subset = rows.slice((page - 1) * pageSize, page * pageSize);
  return before + `<section class="panel"><div class="table-toolbar"><h2>${label}</h2><span class="result-count">${num(count)} 项</span><div class="toolbar-end"><span class="result-count">单位：件；组合套数另列</span></div></div><div class="table-wrap"><table><thead><tr><th>产品 SKU / 款式</th><th>品类</th><th>站点 / 库存池</th><th>上架状态</th><th>已上架店铺</th><th class="number">总库存 / 可组套数</th>${data.meta.bandNames.map(b => `<th class="number">${esc(b)}</th>`).join('')}<th>最老库龄段</th><th>操作</th></tr></thead><tbody>${subset.map(r => {
    const oldest = r.inv ? r.inv.bands.findLastIndex(v => v > 0) : -1;
    return `<tr><td>${productCell(r)}</td><td>${esc(r.product.category)}<span class="subcode">${esc(r.product.status || '状态待补充')}</span></td><td class="site-label">${esc(r.site)}<span class="subcode">${esc(r.pool || '未提供库存池')}</span></td><td>${badge(model.status(r, filters.shop))}</td><td>${shopBadges(r)}</td><td class="number">${stockCell(r)}</td>${[0, 1, 2, 3, 4].map(i => `<td class="number ${i > 1 && r.inv?.bands[i] > 0 ? 'old-number' : ''}">${num(r.inv?.bands[i])}</td>`).join('')}<td>${oldest >= 0 ? esc(data.meta.bandNames[oldest]) : '—'}</td><td><button class="link-button" data-detail="${esc(r.id)}">查看详情 ›</button></td></tr>`;
  }).join('')}</tbody></table>${count ? '' : '<div class="empty">没有符合条件的记录，请调整筛选条件。</div>'}</div>${pagination(count)}</section>`;
}
function matrixView(rows) {
  const shops = filters.shop ? data.shops.filter(s => s.name === filters.shop) : data.shops;
  const groups = new Map();
  for (const r of rows) {
    if (!matrixIncludeEmpty && !r.inv && !model.linksFor(r).direct.length && !model.linksFor(r).bundle.length) continue;
    const id = key(r.site, r.product.spu);
    if (!groups.has(id)) groups.set(id, { id, site: r.site, spu: r.product.spu, category: r.product.category, name: r.product.name, rows: [] });
    groups.get(id).rows.push(r);
  }
  matrixGroups = [...groups.values()].sort((a, b) => b.rows.reduce((n, r) => n + (total(r.inv) || 0), 0) - a.rows.reduce((n, r) => n + (total(r.inv) || 0), 0));
  page = Math.max(1, Math.min(page, Math.ceil(matrixGroups.length / pageSize) || 1));
  return `<div class="info-banner"><span>数字表示“直接在售 SKU / 本款式当前可见 SKU”。已在其他店铺上架的同一库存仅计一次。</span><label class="scope-check"><input id="matrix-empty" type="checkbox" ${matrixIncludeEmpty ? 'checked' : ''}>含无库存且未上架的款式</label></div><section class="panel"><div class="table-toolbar"><h2>款式 × 店铺</h2><span class="result-count">${num(matrixGroups.length)} 个款式 × 站点 · ${shops.length} 家店铺</span><div class="toolbar-end"><span class="result-count">点击单元格查看明细</span></div></div><div class="matrix-head-note"><span><b>绿色</b> 全部在售</span><span><i>黄色</i> 部分覆盖／有货待上架</span><span>蓝色：仅组合成分在售</span><span>灰色：无经营站点记录，待确认</span></div><div class="table-wrap matrix-scroll"><table class="matrix-table"><thead><tr><th class="sticky-col">款式 / SPU</th><th>站点</th><th class="number">实物库存</th>${shops.map(s => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${matrixGroups.slice((page - 1) * pageSize, page * pageSize).map(g => {
    const invs = new Map(g.rows.filter(r => r.inv).map(r => [r.inv.physicalKey, r.inv]));
    const units = [...invs.values()].reduce((n, v) => n + total(v), 0);
    return `<tr><td class="sticky-col"><div class="product-cell"><b>${esc(g.spu)}</b><span class="product-name" title="${esc(g.name)}">${esc(g.name)}</span><span class="subcode">${g.rows.length} 个 SKU · ${esc(g.category)}</span></div></td><td class="site-label">${esc(g.site)}</td><td class="number em-number">${invs.size ? num(units) : '—'}</td>${shops.map(s => {
      const states = g.rows.map(r => model.status(r, s.name));
      const direct = states.filter(s => s.code === 'active').length, bundle = states.filter(s => s.code === 'bundle').length, pending = states.filter(s => s.code === 'pending').length;
      const uncertain = states.some(s => s.code === 'check');
      const cls = direct === g.rows.length ? '' : direct ? 'partial' : pending ? 'pending' : bundle ? 'bundle' : 'uncertain';
      const text = direct ? `${direct}/${g.rows.length}` : bundle ? `组合 ${bundle}` : pending ? `待上 ${pending}` : uncertain ? '待确认' : '未上架';
      const title = `直接在售${direct}个，组合覆盖${bundle}个，有货待上架${pending}个${uncertain ? '；有站点或SKU需核对' : ''}`;
      return `<td><button class="matrix-cell ${cls}" data-matrix="${esc(g.id)}" data-matrix-shop="${esc(s.name)}" title="${esc(title)}">${text}</button></td>`;
    }).join('')}</tr>`;
  }).join('')}</tbody></table>${matrixGroups.length ? '' : '<div class="empty">当前筛选范围没有款式记录</div>'}</div>${pagination(matrixGroups.length)}</section>`;
}
function dataView() {
  const poolOptions = [...new Set([...Object.values(data.warehouses), ...Object.values(data.settings.sitePools)])].filter(Boolean).sort();
  const missingShops = [...new Set([...(data.issues['在售记录缺少站点'] || []).map(x => x.shop), ...Object.keys(data.settings.blankSitesByShop)])].sort();
  const aliasShops = [...new Set([...data.shops.map(s => s.name), ...Object.keys(data.settings.shopAliases)])].sort();
  return `<div class="data-grid">${data.meta.sources.map(s => `<section class="source-card"><div class="source-icon">▧</div><h3>${esc(s.folder)}</h3><div class="filename">${esc(s.name)}</div><div class="source-rows">${num(Object.values(s.sheets).reduce((a, b) => a + b, 0))}<small> 行</small></div><small>${Object.entries(s.sheets).map(([name, n]) => `${esc(name)} ${num(n)}`).join(' / ')}</small></section>`).join('')}</div><div class="data-actions"><button class="button primary" id="data-refresh">⟳ 从三个文件夹一键更新</button><button class="button secondary" id="open-upload">↑ 上传新版 Excel</button></div><div class="info-banner"><span>本机更新：把新表放入原来的“产品信息表”“TM在售链接”“万邑通库龄”文件夹，再点击更新。每类使用修改时间最新的 .xlsx；~$ 临时文件会忽略。更新失败时保留当前版本。</span></div>
  <section class="panel data-section"><div class="panel-heading"><div><h2>需要核对的数据</h2><p>源表缺失不会自动补零或推断到某个国家。可下载明细，修正后重新更新。</p></div><span class="panel-badge">${num(data.meta.counts.links)} 个去重链接</span></div><div class="panel-content"><div class="quality-list">${Object.entries(data.meta.issueCounts).map(([label, count]) => `<div class="quality-item"><span>${esc(label)}</span><b>${num(count)}</b><button data-export-issue="${esc(label)}">导出</button></div>`).join('') || '<div class="muted">没有发现需要核对的项目</div>'}</div><div class="help-note">各问题可能涉及同一行，不相加作为异常记录总数。大小写不同的店铺名称保留原值；确认后可设置别名合并。</div></div></section>
  <div class="mapping-grid data-section"><section class="panel"><div class="panel-heading"><div><h2>站点 → 库存池</h2><p>仅在确认可共享库存时，将多个站点配置到同一库存池。</p></div></div><div class="panel-content"><p class="mapping-help">例如确认法国站由德国仓发货后，可将 FR 关联到 DE。共享库存跨站汇总时只计算一次。</p><div class="mapping-scroll">${data.sites.filter(s => s.code !== '待确认').map(s => `<label class="mapping-row"><span>${esc(siteName(s.code))}</span><select data-map-site="${esc(s.code)}">${option('', '未提供库存', data.settings.sitePools[s.code] || '')}${poolOptions.map(p => option(p, p + ' 库存池', data.settings.sitePools[s.code] || '')).join('')}</select></label>`).join('')}</div></div></section><section class="panel"><div class="panel-heading"><div><h2>仓库 → 库存池</h2><p>同一库存池的多个仓库按 SKU 合并实物数量。</p></div></div><div class="panel-content"><div class="mapping-scroll">${Object.entries(data.warehouses).map(([warehouse, pool]) => `<label class="mapping-row"><span>${esc(warehouse)}</span><select data-map-warehouse="${esc(warehouse)}">${poolOptions.map(p => option(p, p, pool)).join('')}</select></label>`).join('')}</div><div class="chart-note">US、UK、DE、AU 仓库按仓库名称前缀初始归类。请在首次使用时核对仓库所属国家。</div></div></section></div>
  <section class="panel data-section"><div class="panel-heading"><div><h2>缺失站点与店铺名称</h2><p>缺失站点仅可在整家店铺的空站点记录确属同一国家时批量指定；混合国家请修改源表。</p></div></div><div class="panel-content"><div class="mapping-grid"><div><h3 class="batch-heading">空站点记录归属</h3><div class="mapping-scroll">${missingShops.map(s => `<label class="mapping-row"><span>${esc(s)}</span><select data-map-blank="${esc(s)}">${option('', '继续待确认', data.settings.blankSitesByShop[s] || '')}${data.sites.filter(x => x.code !== '待确认').map(x => option(x.code, siteName(x.code), data.settings.blankSitesByShop[s] || '')).join('')}</select></label>`).join('') || '<p class="muted">当前没有缺失站点的记录</p>'}</div></div><div><h3 class="batch-heading">店铺名称合并</h3><p class="mapping-help">仅当确认是同一店铺时填写统一名称，例如 Benehair → benehair。清空可恢复原名。</p><div class="mapping-scroll">${aliasShops.map(name => `<label class="mapping-row"><span>${esc(name)}</span><input type="text" data-map-alias="${esc(name)}" placeholder="保留原名" value="${esc(data.settings.shopAliases[name] || '')}"></label>`).join('')}</div></div></div><div class="settings-actions"><button class="button primary" id="save-settings">保存关联并重新计算</button><button class="button secondary" id="export-backup">下载当前分析快照</button></div><p class="help-note">快照包含完整业务数据，请只分享给授权人员。本机版数据保存在本机服务中；浏览器刷新会读取相同版本。</p></div></section>`;
}
function render() {
  if (!model) return;
  const selected = model.select(filters);
  const s = summarize(model, selected, filters.shop);
  $('#pending-nav-count').textContent = num(s.counts.pending);
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  const [title, subtitle, crumb] = titles[view];
  $('#page-title').textContent = title; $('#page-subtitle').textContent = subtitle; $('#breadcrumb-current').textContent = crumb;
  $('#filters').hidden = view === 'data';
  $('#export-button').hidden = view === 'data';
  $('#export-button').textContent = view === 'matrix' ? '↓ 导出上架矩阵' : view === 'pending' ? '↓ 导出待上架清单' : '↓ 导出筛选结果';
  $('#snapshot-label').textContent = `分析更新 ${data.meta.generatedAt.replace('T', ' ').slice(0, 19)}`;
  const ageDates = data.meta.inventoryDates['生成库龄时间'] || [];
  $('#source-date').textContent = `库龄快照 ${ageDates.join('、')} · ${data.meta.counts.shops} 家店铺`;
  visibleRows = selected;
  if (view === 'overview') $('#app-content').innerHTML = kpis(s) + qualityBanner() + `<div class="section-grid">${ageChart(selected)}${donutChart(selected)}</div><div class="store-grid">${storeChart(selected)}${miniPending(selected)}</div>`;
  else if (view === 'matrix') $('#app-content').innerHTML = matrixView(selected);
  else if (view === 'detail') $('#app-content').innerHTML = detailTable(selected);
  else if (view === 'pending') $('#app-content').innerHTML = detailTable(selected, true);
  else $('#app-content').innerHTML = dataView();
  if (session.mode === 'shared') {
    $('.workspace-tag').textContent = '共享版';
    $('.connection').innerHTML = '<span></span>共享数据服务';
    $('#update-button').textContent = '↑ 上传并更新';
    if ($('#data-refresh')) $('#data-refresh').hidden = true;
    const importNote = $('.data-actions + .info-banner');
    if (importNote) importNote.textContent = session.canEdit ? '在此上传新版 Excel，核对通过后统一更新。所有运营打开同一网址即可查看最新数据。' : '当前账号可查看、筛选和导出，数据由运营经理统一更新。';
    const storageNote = $('.settings-actions + .help-note');
    if (storageNote) storageNote.textContent = '数据、源表与历史版本统一保存在共享服务中。快照包含完整业务数据，请只分享给授权人员。';
  }
  if (session.mode === 'local' && session.canPublish) $('#update-button').textContent = '⟳ 一键更新并同步线上';
  $('#update-button').hidden = !session.canEdit;
  $('.sidebar-footer b').textContent = session.canEdit ? '运营经理' : '运营查看账号';
  if (!session.canEdit) {
    for (const id of ['data-refresh', 'open-upload', 'save-settings']) if ($('#' + id)) $('#' + id).hidden = true;
    $$('[data-map-site], [data-map-warehouse], [data-map-blank], [data-map-alias]').forEach(input => input.disabled = true);
  }
  const siteCodes = [...new Set(model.rows.map(r => r.site))];
  $('#method-content').innerHTML = `<ol class="note-list">${data.meta.notes.map(n => `<li>${esc(n)}</li>`).join('')}<li>“在售”来自源表商品状态，不实时访问 TEMU；请定期导出完整在售链接。</li><li>款式优先取产品主表 SPU。组合编码与单品分开展示，不把可组合套数加入实物库存。</li><li>未上架包含无库存、无站点记录的产品；有正库存且未售才进入待上架提醒。有未归属站点链接的同 SKU 先标为待核对。</li></ol>`;
}
function populateFilters() {
  if (filters.shop && !data.shops.some(s => s.name === filters.shop)) filters.shop = data.settings.shopAliases[filters.shop] || '';
  if (filters.site && filters.site !== '未分配' && !data.sites.some(s => s.code === filters.site)) filters.site = '';
  $('#filter-site').innerHTML = option('', '全部站点') + data.sites.map(s => option(s.code, siteName(s.code), filters.site)).join('') + option('未分配', '无站点记录', filters.site);
  $('#filter-shop').innerHTML = option('', '全部店铺') + data.shops.map(s => option(s.name, s.name, filters.shop)).join('');
  const cats = new Set(); for (const p of data.products) { const parts = p.category.split('/'); for (let i = 1; i <= parts.length; i++) cats.add(parts.slice(0, i).join('/')); }
  $('#filter-category').innerHTML = option('', '全部品类') + [...cats].sort().map(c => option(c, c, filters.category)).join('');
  for (const name of ['site', 'shop', 'category', 'status', 'stock', 'search']) $('#filter-' + name).value = filters[name] || '';
}
async function loadData() {
  if (loading) return; loading = true;
  try {
    data = await request('/api/data');
    model = createModel(data); lastVersion = data.meta.generatedAt;
    populateFilters(); render();
  } catch (error) { showError(error.message); }
  finally { loading = false; }
}
function showError(message) { $('#error-panel').textContent = message; $('#error-panel').hidden = !message; }
async function poll() {
  try {
    const state = await request('/api/status');
    const wasRunning = running; running = state.running;
    $('#progress-panel').hidden = !state.running;
    $('#progress-bar').value = state.percent; $('#progress-percent').textContent = `${state.percent}%`; $('#progress-message').textContent = state.message;
    $('#update-button').disabled = state.running;
    if ($('#data-refresh')) $('#data-refresh').disabled = state.running;
    if ($('#save-settings')) $('#save-settings').disabled = state.running;
    showError(state.error || '');
    if (state.ready && (!model || (state.updatedAt && state.updatedAt !== lastVersion))) { await loadData(); if (wasRunning && !state.running && !state.error) toast('数据更新完成，所有视图已重新计算'); }
    if (session.canPublish && state.publication?.url && model) {
      const isCurrent = state.publication.status === 'published' && state.publication.sourceGeneratedAt === data.meta.generatedAt;
      $('#snapshot-label').textContent = `分析更新 ${data.meta.generatedAt.replace('T', ' ').slice(0, 19)} · ${isCurrent ? '已同步线上' : '线上同步待完成'}`;
    }
  } catch (error) { showError(session.mode === 'shared' ? '共享数据服务连接中断，请稍后刷新页面。' : '本机数据服务连接中断。请运行“启动看板.cmd”后刷新页面。'); }
  clearTimeout(pollTimer); pollTimer = setTimeout(poll, running || !model ? 1200 : 12000);
}
async function startUpdate(body, endpoint = '/api/update') {
  try { await request(endpoint, body); running = true; showError(''); clearTimeout(pollTimer); await poll(); }
  catch (error) { showError(error.message); toast(error.message); }
}
function setView(name) { if (!titles[name]) return; view = name; page = 1; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function download(contents, name, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function csv(rows, name) { download('\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'), `${name}_${new Date().toLocaleDateString('sv-SE')}.csv`, 'text/csv;charset=utf-8'); toast(`已导出 ${num(rows.length - 1)} 行，可用 Excel 打开`); }
function ageSummaryRows() {
  const pools = new Map();
  for (const r of model.select(filters)) if (r.inv) {
    if (!pools.has(r.pool)) pools.set(r.pool, new Map());
    pools.get(r.pool).set(r.inv.physicalKey, r.inv);
  }
  return [...pools].map(([pool, inventory]) => {
    const bands = [0, 0, 0, 0, 0];
    for (const inv of inventory.values()) inv.bands.forEach((n, i) => bands[i] += n);
    const units = bands.reduce((a, b) => a + b, 0), old = bands.slice(2).reduce((a, b) => a + b, 0);
    const sites = data.sites.filter(s => s.pool === pool && (!filters.site || s.code === filters.site)).map(s => s.code).join('、');
    return { pool, sites, bands, units, old };
  }).sort((a, b) => b.units - a.units);
}
function showAgeSummary() {
  const rows = ageSummaryRows(), sum = summarize(model, model.select(filters), filters.shop);
  $('#detail-content').innerHTML = `<div class="dialog-heading"><div><div class="eyebrow">INVENTORY AGE</div><h2>站点库龄数量汇总</h2><p class="muted">当前筛选范围 · 单位：件 · 共享站点库存按库存池去重</p></div><button class="close-dialog icon-button" aria-label="关闭">×</button></div><div class="table-wrap"><table id="age-summary-table"><thead><tr><th>库存池 / 对应站点</th>${data.meta.bandNames.map(b => `<th class="number">${esc(b)}</th>`).join('')}<th class="number">库存合计</th><th class="number">超180天占比</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.pool)}<span class="subcode">${esc(r.sites)}</span></td>${r.bands.map(n => `<td class="number">${num(n)}</td>`).join('')}<td class="number em-number">${num(r.units)}</td><td class="number old-number">${percent(r.old, r.units)}</td></tr>`).join('')}${rows.length ? `<tr><td><b>合计</b></td>${sum.bands.map(n => `<td class="number">${num(n)}</td>`).join('')}<td class="number em-number">${num(sum.units)}</td><td class="number old-number">${percent(sum.old, sum.units)}</td></tr>` : ''}</tbody></table>${rows.length ? '' : '<div class="empty">当前范围尚未提供实物库存记录</div>'}</div><p class="muted">精确平均库龄和累计库龄天数未提供；此处汇总源表各库龄段的真实数量。</p><div class="dialog-footer"><button class="button secondary close-dialog">关闭</button><button class="button primary" data-age-export>↓ 导出库龄汇总</button></div>`;
  $('#detail-dialog').showModal();
}
function exportRows() {
  if (!model) return;
  if (view === 'matrix') {
    const shops = filters.shop ? data.shops.filter(s => s.name === filters.shop) : data.shops;
    csv([['款式SPU', '品类', '站点', '可见SKU数', '实物库存（跨行按库存池SKU去重）', ...shops.map(s => s.name)], ...matrixGroups.map(g => [g.spu, g.category, g.site, g.rows.length, g.rows.some(r => r.inv) ? [...new Map(g.rows.filter(r => r.inv).map(r => [r.inv.physicalKey, r.inv])).values()].reduce((n, v) => n + total(v), 0) : '', ...shops.map(s => {
      const states = g.rows.map(r => model.status(r, s.name).code);
      return `直接在售${states.filter(x => x === 'active').length}/${g.rows.length};仅组合${states.filter(x => x === 'bundle').length};待上架${states.filter(x => x === 'pending').length};待核对${states.filter(x => x === 'check').length}`;
    })])], 'TEMU_上架矩阵'); return;
  }
  const rows = view === 'overview' ? model.select(filters) : visibleRows;
  const header = ['SKU', '款式SPU', '产品名称', '品类', '产品类型', '产品状态', '站点', '库存池', '上架状态', '状态说明', '所选店铺', '直接在售店铺', '组合成分在售店铺', '实物库存', ...data.meta.bandNames, '超180天数量', '最老库龄段', '可组合套数（独立测算，不可累加）', '实物库存去重键', '库存来源仓库', '在售链接数', '导出快照时间'];
  csv([header, ...rows.map(r => {
    const ls = model.linksFor(r, filters.shop), state = model.status(r, filters.shop), oldest = r.inv?.bands.findLastIndex(v => v > 0) ?? -1;
    return [r.unmatchedLink ? `未匹配:${r.unmatchedLink.platformSku}` : r.sku, r.product.spu, r.product.name, r.product.category, r.product.kind === 'bundle' ? '组合' : '单品', r.product.status, r.site, r.pool || '未提供', state.label, state.reason, filters.shop || '全部店铺', [...new Set(ls.direct.map(l => l.shop))].join(';'), [...new Set(ls.bundle.map(l => l.shop))].join(';'), total(r.inv), ...[0, 1, 2, 3, 4].map(i => r.inv?.bands[i] ?? ''), r.inv ? oldUnits(r.inv) : '', oldest >= 0 ? data.meta.bandNames[oldest] : '', model.capacity(r) ?? '', r.inv?.physicalKey.replace('\u0001', '/') || '', r.inv?.warehouses.map(w => w.name).join(';') || '', new Set([...ls.direct, ...ls.bundle].map(l => l.id)).size, data.meta.generatedAt];
  })], view === 'pending' ? 'TEMU_待上架清单' : 'TEMU_SKU库龄明细');
}
function showRow(r, overrideShop = null) {
  const shop = overrideShop ?? filters.shop;
  const ls = model.linksFor(r, shop), all = model.linksFor(r), status = model.status(r, shop);
  const links = [...new Map([...all.direct, ...all.bundle, ...all.unresolved].map(l => [l.id, l])).values()];
  const componentRows = Object.entries(r.product.components || {});
  $('#detail-content').innerHTML = `<div class="dialog-heading"><div><div class="eyebrow">SKU DETAIL</div><h2>${rowName(r)}</h2><p class="muted detail-title-name">${esc(r.product.name)}</p></div><button class="close-dialog icon-button" aria-label="关闭">×</button></div><div class="pending-summary">${badge(status)}<span>站点 ${esc(siteName(r.site))}</span><span>款式 ${esc(r.product.spu)}</span><span>${shop ? '当前店铺 ' + esc(shop) : '全部店铺'}</span></div><div class="detail-summary"><div>站点实物库存<strong>${num(total(r.inv))} ${r.inv ? '件' : ''}</strong></div><div>超180天数量<strong>${r.inv ? num(oldUnits(r.inv)) + ' 件' : '—'}</strong></div><div>最老库龄段<strong>${r.inv && r.inv.bands.some(v => v > 0) ? data.meta.bandNames[r.inv.bands.findLastIndex(v => v > 0)] : '—'}</strong></div></div><h3 class="batch-heading">库龄与仓库</h3><div class="table-wrap"><table><thead><tr><th>仓库</th>${data.meta.bandNames.map(b => `<th class="number">${b}</th>`).join('')}</tr></thead><tbody>${(r.inv?.warehouses || []).map(w => `<tr><td>${esc(w.name)}</td>${w.bands.map(v => `<td class="number">${num(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>${r.inv ? '' : `<div class="empty">${r.pool ? '此库存池没有该 SKU 的实物库存记录' : '此站点尚未提供或关联库存数据'}</div>`}</div>${componentRows.length ? `<h3 class="batch-heading" style="margin-top:24px">组合成分与独立可组套数</h3><p class="muted">${componentRows.map(([sku, qty]) => `${esc(sku)} × ${qty}`).join('；')}。当前可组 ${num(model.capacity(r))} 套，不计入实物合计，不能与其他组合重复占用库存。</p>` : ''}<h3 class="batch-heading" style="margin-top:24px">对应在售链接 · 所有店铺 ${num(links.length)} 个</h3><div class="table-wrap"><table class="detail-table"><thead><tr><th>店铺 / 站点</th><th>销售方式</th><th>平台SKU</th><th>平台SKU ID / SPU ID</th><th>运营</th><th>源表位置</th></tr></thead><tbody>${links.map(l => `<tr><td>${esc(l.shop)}<span class="subcode">${esc(l.site)}</span></td><td>${esc(l.kind === 'bundle' ? `组合 ${Object.entries(l.components).map(([s, q]) => `${s}×${q}`).join('; ')}` : '单品直接在售')}<span class="subcode">${esc(l.status)}</span></td><td>${esc(l.platformSku)}${/^https?:\/\//.test(l.url) ? `<br><a class="link-button" target="_blank" rel="noopener noreferrer" href="${esc(l.url)}">查看源表商品链接</a>` : ''}</td><td>${esc(l.platformId || '未提供')}<span class="subcode">${esc(l.parentId || '未提供')}</span></td><td>${esc(l.operator)}</td><td>${esc(l.source)}<span class="subcode">第 ${l.sourceRow} 行</span></td></tr>`).join('')}</tbody></table>${links.length ? '' : '<div class="empty">该 SKU 在此站点暂无关联在售链接</div>'}</div><div class="dialog-footer"><button class="button secondary close-dialog">关闭</button></div>`;
  $('#detail-dialog').showModal();
}
function showGroup(id, shop) {
  const group = matrixGroups.find(g => g.id === id); if (!group) return;
  $('#detail-content').innerHTML = `<div class="dialog-heading"><div><div class="eyebrow">STORE COVERAGE</div><h2>${esc(group.spu)} · ${esc(shop)}</h2><p class="muted">${esc(siteName(group.site))} · ${group.rows.length} 个可见 SKU</p></div><button class="close-dialog icon-button" aria-label="关闭">×</button></div><div class="table-wrap"><table><thead><tr><th>SKU</th><th>该店铺状态</th><th class="number">站点库存</th><th class="number">超180天</th><th>全部在售店铺</th><th>详情</th></tr></thead><tbody>${group.rows.map(r => `<tr><td>${productCell(r)}</td><td>${badge(model.status(r, shop))}</td><td class="number">${stockCell(r)}</td><td class="number">${r.inv ? num(oldUnits(r.inv)) : '—'}</td><td>${[...new Set([...model.linksFor(r).direct, ...model.linksFor(r).bundle].map(l => l.shop))].map(s => `<span class="shop-badge">${esc(s)}</span>`).join('') || '暂无'}</td><td><button class="link-button" data-dialog-detail="${esc(r.id)}">详情 ›</button></td></tr>`).join('')}</tbody></table></div><div class="dialog-footer"><button class="button secondary close-dialog">关闭</button></div>`;
  $('#detail-dialog').showModal();
}

$('#navigation').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
for (const name of ['site', 'shop', 'category', 'status', 'stock']) $('#filter-' + name).addEventListener('change', e => { filters[name] = e.target.value; page = 1; render(); });
$('#filter-search').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { filters.search = e.target.value; page = 1; render(); }, 220); });
$('#reset-filters').addEventListener('click', () => { filters = { site: '', shop: '', category: '', status: '', stock: '', search: '' }; page = 1; populateFilters(); render(); });
$('#update-button').addEventListener('click', () => { if (session.mode === 'shared') { $('#upload-message').textContent = ''; $('#upload-dialog').showModal(); } else startUpdate({ fromFolders: true }); });
$('#export-button').addEventListener('click', exportRows);
$('#method-button').addEventListener('click', () => $('#method-dialog').showModal());
document.addEventListener('click', e => {
  const close = e.target.closest('.close-dialog'); if (close) { close.closest('dialog').close(); return; }
  if (e.target.closest('[data-age-summary]')) { showAgeSummary(); return; }
  if (e.target.closest('[data-age-export]')) { const rows = ageSummaryRows(); csv([['库存池', '对应站点', ...data.meta.bandNames, '库存合计', '超180天数量', '超180天占比'], ...rows.map(r => [r.pool, r.sites, ...r.bands, r.units, r.old, percent(r.old, r.units)])], 'TEMU_站点库龄汇总'); return; }
  const go = e.target.closest('[data-go]'); if (go) { setView(go.dataset.go); return; }
  const shop = e.target.closest('[data-shop]'); if (shop) { filters.shop = shop.dataset.shop; page = 1; populateFilters(); render(); return; }
  const pagination = e.target.closest('[data-page]'); if (pagination && !pagination.disabled) { page = Number(pagination.dataset.page); render(); return; }
  const matrix = e.target.closest('[data-matrix]'); if (matrix) { showGroup(matrix.dataset.matrix, matrix.dataset.matrixShop); return; }
  const detail = e.target.closest('[data-detail]'); if (detail) { const row = model.select(filters).find(r => r.id === detail.dataset.detail) || model.rows.find(r => r.id === detail.dataset.detail); if (row) showRow(row); return; }
  const dialogDetail = e.target.closest('[data-dialog-detail]'); if (dialogDetail) { $('#detail-dialog').close(); const row = model.select(filters).find(r => r.id === dialogDetail.dataset.dialogDetail) || model.rows.find(r => r.id === dialogDetail.dataset.dialogDetail); if (row) showRow(row); return; }
  const issue = e.target.closest('[data-export-issue]'); if (issue) { const items = data.issues[issue.dataset.exportIssue] || []; const keys = [...new Set(items.flatMap(x => Object.keys(x)))]; const labels = { sheet: '源表工作表', row: '源表行号', shop: '店铺', site: '站点', platformSku: '平台SKU', sku: '产品SKU', warehouse: '仓库', component: '组合成分SKU' }; csv([keys.map(k => labels[k] || k), ...items.map(x => keys.map(k => x[k] ?? ''))], `TEMU_核对_${issue.dataset.exportIssue}`); return; }
  if (e.target.closest('#data-refresh')) startUpdate({ fromFolders: true });
  if (e.target.closest('#open-upload')) { $('#upload-message').textContent = ''; $('#upload-dialog').showModal(); }
  if (e.target.closest('#include-bundle-button')) { filters.status = filters.status === 'bundle' ? '' : 'bundle'; page = 1; populateFilters(); render(); }
  if (e.target.closest('#export-backup')) download(JSON.stringify(data), `TEMU_完整分析快照_${data.meta.generatedAt.slice(0, 10)}.json`, 'application/json');
  if (e.target.closest('#save-settings')) {
    const settings = structuredClone(data.settings);
    $$('[data-map-site]').forEach(s => settings.sitePools[s.dataset.mapSite] = s.value);
    $$('[data-map-warehouse]').forEach(s => settings.warehousePools[s.dataset.mapWarehouse] = s.value);
    $$('[data-map-blank]').forEach(s => settings.blankSitesByShop[s.dataset.mapBlank] = s.value);
    $$('[data-map-alias]').forEach(s => { if (s.value.trim()) settings.shopAliases[s.dataset.mapAlias] = s.value.trim(); else delete settings.shopAliases[s.dataset.mapAlias]; });
    startUpdate(settings, '/api/settings');
  }
});
document.addEventListener('change', e => { if (e.target.id === 'matrix-empty') { matrixIncludeEmpty = e.target.checked; page = 1; render(); } });
$('#upload-form').addEventListener('submit', async e => {
  e.preventDefault(); const uploads = {}; const inputs = [...e.target.querySelectorAll('input[type=file]')].filter(i => i.files.length);
  if (!inputs.length) { $('#upload-message').textContent = '请至少选择一份需要替换的 Excel。'; return; }
  $('#upload-submit').disabled = true;
  try {
    for (const input of inputs) {
      const file = input.files[0]; $('#upload-message').textContent = `正在上传 ${file.name}…`;
      const response = await fetch(`/api/upload?kind=${encodeURIComponent(input.name)}&name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'X-Dashboard-Request': '1', 'Content-Type': 'application/octet-stream' }, body: file });
      const result = await response.json(); if (!response.ok) throw new Error(result.error); uploads[input.name] = result.token;
    }
    const result = await request('/api/update', { uploads });
    $('#upload-dialog').close(); e.target.reset(); clearTimeout(pollTimer); await poll();
  } catch (error) { $('#upload-message').textContent = error.message; }
  finally { $('#upload-submit').disabled = false; }
});
for (const dialog of $$('dialog')) dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } });
async function bootstrap() {
  try { session = await request('/api/session'); await poll(); }
  catch (error) { showError('数据服务暂时无法连接，请重新打开看板或稍后刷新。'); }
}
bootstrap();

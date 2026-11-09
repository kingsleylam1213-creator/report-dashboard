export const key = (site, sku) => `${site}\u0001${sku}`;
export const total = inv => inv ? inv.bands.reduce((a, b) => a + b, 0) : null;
export const oldUnits = inv => inv ? inv.bands.slice(2).reduce((a, b) => a + b, 0) : 0;
export const UNKNOWN_COMPANY = '__unmatched__';

export function createModel(data) {
  const products = new Map(data.products.map(p => [p.sku, p]));
  const inventory = new Map(data.inventory.map(v => [key(v.pool, v.sku), { ...v, physicalKey: key(v.pool, v.sku) }]));
  const sites = new Map(data.sites.map(s => [s.code, s]));
  const shops = new Map(data.shops.map(s => [s.name, new Set(s.sites)]));
  const shopInfo = new Map(data.shops.map(s => [s.name, s]));
  const companyOf = shop => shopInfo.get(shop)?.company || UNKNOWN_COMPANY;
  const scopeOf = scope => typeof scope === 'string' ? { shop: scope } : scope || {};
  const matchesShop = (shop, scope = {}) => {
    const f = scopeOf(scope);
    return (!f.shop || shop === f.shop) && (!f.company || companyOf(shop) === f.company);
  };
  const shopsFor = (scope = {}) => data.shops.filter(s => matchesShop(s.name, scope));
  const companySites = new Map();
  for (const s of data.shops) {
    const company = companyOf(s.name);
    if (!companySites.has(company)) companySites.set(company, new Set());
    s.sites.forEach(site => companySites.get(company).add(site));
  }
  const direct = new Map(), component = new Map(), unresolved = new Map();
  const add = (map, k, value) => { if (!map.has(k)) map.set(k, []); map.get(k).push(value); };
  for (const l of data.listings) {
    if (!l.active) continue;
    if (l.sku) add(direct, key(l.site, l.sku), l);
    for (const sku of Object.keys(l.components || {})) add(component, key(l.site, sku), l);
    if (l.site === '待确认') {
      if (l.sku) add(unresolved, l.sku, l);
      for (const sku of Object.keys(l.components || {})) add(unresolved, sku, l);
    }
  }
  const pairs = new Map();
  const make = (site, sku) => {
    const k = key(site, sku);
    if (!pairs.has(k)) {
      const product = products.get(sku) || { sku, spu: sku, category: '未分类', name: '产品信息待补充', kind: 'single', unmatched: true };
      const pool = sites.get(site)?.pool;
      pairs.set(k, { id: k, sku, site, product, pool, inv: pool ? inventory.get(key(pool, sku)) : null });
    }
    return pairs.get(k);
  };
  for (const inv of inventory.values()) {
    const matching = data.sites.filter(s => s.pool === inv.pool);
    for (const s of matching.length ? matching : [{ code: inv.pool }]) {
      const row = make(s.code, inv.sku);
      row.inv = inv;
      row.pool = inv.pool;
    }
  }
  for (const l of data.listings) {
    if (l.sku) make(l.site, l.sku);
    else {
      const r = make(l.site, `未匹配:${l.id}`);
      r.product = { sku: '未匹配', spu: '未匹配', name: l.name, category: '未分类', kind: l.kind, unmatched: true };
      r.unmatchedLink = l;
    }
  }
  // Component coverage should also be visible for catalog items without an inventory row.
  for (const [k] of component) { const [site, sku] = k.split('\u0001'); if (products.has(sku)) make(site, sku); }
  const used = new Set([...pairs.values()].map(r => r.sku));
  for (const p of products.values()) if (!used.has(p.sku)) make('未分配', p.sku).unassigned = true;
  const rows = [...pairs.values()];
  const linksFor = (r, scope = '') => {
    const filter = ls => ls.filter(l => matchesShop(l.shop, scope));
    return { direct: filter(r.unmatchedLink ? [r.unmatchedLink].filter(l => l.active) : direct.get(key(r.site, r.sku)) || []),
      bundle: filter(component.get(key(r.site, r.sku)) || []),
      unresolved: filter(unresolved.get(r.sku) || []) };
  };
  function status(r, scope = '') {
    const f = scopeOf(scope);
    const links = linksFor(r, f);
    if (r.site === '待确认' || r.unmatchedLink) return { code: 'check', label: '待核对', reason: r.unmatchedLink ? '在售记录缺少产品SKU关联' : '在售记录缺少站点' };
    if (links.direct.length) return { code: 'active', label: r.product.kind === 'bundle' ? '组合在售' : '在售', reason: `${links.direct.length} 个在售链接` };
    if (links.bundle.length) return { code: 'bundle', label: '仅组合在售', reason: '作为组合成分在售，尚无单品在售链接' };
    const eligible = f.shop ? matchesShop(f.shop, f) && shops.get(f.shop)?.has(r.site) : f.company ? companySites.get(f.company)?.has(r.site) : true;
    if ((f.shop || f.company) && r.site !== '未分配' && !eligible) return { code: 'check', label: '站点待确认', reason: '源表未见所选店铺范围在此站点的经营记录' };
    if (total(r.inv) > 0 && links.unresolved.length) return { code: 'check', label: '站点待核对', reason: '此SKU有未归属站点的在售记录，请先补齐站点' };
    if (total(r.inv) > 0) return { code: 'pending', label: '有货待上架', reason: '此站点有库存，所选店铺范围未匹配到单品或组合在售链接' + (r.product.status === '不可用' ? '；产品主表标记不可用，请先核对产品状态' : '') };
    return { code: 'unlisted', label: '未上架', reason: r.unassigned ? '产品库已有SKU，尚无库存或刊登记录' : '无在售链接，暂无已知正库存' };
  }
  function capacity(r) {
    if (r.product.kind !== 'bundle' || !r.pool) return null;
    const bom = Object.entries(r.product.components || {});
    if (!bom.length) return null;
    let count = Infinity;
    for (const [sku, qty] of bom) {
      const inv = inventory.get(key(r.pool, sku));
      if (!inv || !(qty > 0)) return null;
      count = Math.min(count, Math.floor(total(inv) / qty));
    }
    return Number.isFinite(count) ? count : null;
  }
  function select(filters = {}) {
    const q = (filters.search || '').toLowerCase().trim();
    const result = [];
    let candidates = rows;
    if (filters.site) {
      candidates = rows.filter(r => r.site === filters.site);
      if (!['待确认', '未分配'].includes(filters.site)) {
        // Every catalog SKU must be inspectable at the selected station, including
        // products already sold at another station but not at this one.
        const present = new Set(candidates.map(r => r.sku));
        const pool = sites.get(filters.site)?.pool;
        for (const product of products.values()) if (!present.has(product.sku)) {
          candidates.push({ id: key(filters.site, product.sku), sku: product.sku,
            site: filters.site, pool, product, inv: pool ? inventory.get(key(pool, product.sku)) : null, unassigned: true });
        }
      }
    }
    for (const row of candidates) {
      if (row.unmatchedLink && !matchesShop(row.unmatchedLink.shop, filters)) continue;
      if (filters.category && row.product.category !== filters.category && !row.product.category.startsWith(filters.category + '/')) continue;
      if (q && !`${row.sku} ${row.product.spu} ${row.product.name} ${row.product.category}`.toLowerCase().includes(q)) continue;
      const s = status(row, filters);
      if (filters.status && s.code !== filters.status) continue;
      if (filters.stock === 'positive' && !(total(row.inv) > 0)) continue;
      if (filters.stock === 'old' && !oldUnits(row.inv)) continue;
      if (filters.stock === 'old365' && !(row.inv?.bands[4] > 0)) continue;
      if (filters.stock === 'unknown' && row.inv) continue;
      result.push(row);
    }
    return result;
  }
  return { data, products, inventory, sites, shops, shopInfo, companyOf, matchesShop, shopsFor, rows, linksFor, status, capacity, select };
}

export function summarize(model, rows, scope = '') {
  const physical = new Map(), pendingPhysical = new Map();
  const counts = { active: 0, bundle: 0, pending: 0, check: 0, unlisted: 0 };
  const styles = new Set(), skus = new Set(), activeSkus = new Set();
  for (const r of rows) {
    if (!r.unmatchedLink) { styles.add(r.product.spu); skus.add(r.sku); }
    const status = model.status(r, scope).code;
    counts[status]++;
    if (status === 'active' || status === 'bundle') activeSkus.add(r.sku);
    if (r.inv) {
      physical.set(r.inv.physicalKey, r.inv);
      if (status === 'pending') pendingPhysical.set(r.inv.physicalKey, r.inv);
    }
  }
  const bands = [0, 0, 0, 0, 0];
  for (const inv of physical.values()) inv.bands.forEach((v, i) => bands[i] += v);
  return { counts, styles: styles.size, skus: skus.size, activeSkus: activeSkus.size, bands,
    units: bands.reduce((a, b) => a + b, 0), old: bands.slice(2).reduce((a, b) => a + b, 0),
    pendingUnits: [...pendingPhysical.values()].reduce((n, v) => n + total(v), 0), physical };
}

export function csvCell(value) {
  const text = String(value ?? '');
  const safe = typeof value === 'string' && /^\s*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

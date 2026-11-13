'use strict';
(async () => {
try{if(window.DASHBOARD_DATA_READY)await window.DASHBOARD_DATA_READY;}catch(e){document.getElementById('content').textContent='数据加载失败，请刷新重试或使用新版 Edge / Chrome。';return;}
const D=window.DASHBOARD_DATA;
if(!D){document.getElementById('content').innerHTML='<div class="error-panel">未能读取数据。请检查 data.js 是否与看板页面放在同一目录。</div>';return;}
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:1});
const pct=(n,d)=>d?(n/d*100).toFixed(1)+'%':'—';
const sum=(arr,f)=>arr.reduce((s,r)=>s+(Number(typeof f==='function'?f(r):r[f])||0),0);
const unique=a=>[...new Set(a.filter(x=>x!==null&&x!==undefined&&x!==''))];
const productMap=new Map(D.products.map(p=>[p.sku,p]));
const paths={overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',sales:'<path d="M4 19V5m0 14h17M8 15l4-5 4 2 5-7"/><path d="M17 5h4v4"/>',inventory:'<path d="m3 7 9-4 9 4v11l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v11M7 5l10 4"/>',listings:'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>',audit:'<path d="m12 3 8 4v6c0 5-8 9-8 9S4 18 4 13V7l8-4Z"/><path d="m8 12 3 3 5-6"/>',sources:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',reset:'<path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',order:'<path d="M6 3h12v19l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.info}</svg>`;
const TABS={overview:{title:'经营总览',en:'BUSINESS OVERVIEW',desc:'连接销量、库存与刊登，掌握服饰经营全貌。',accent:'#317264',soft:'#eaf3ed'},sales:{title:'订单销量',en:'SALES PERFORMANCE',desc:'从平台到单品，查看实际发货销量与订单表现。',accent:'#5379ae',soft:'#eaf0f8'},inventory:{title:'库存与库龄',en:'INVENTORY HEALTH',desc:'看清库存结构，识别高库龄商品与积压风险。',accent:'#b38a43',soft:'#f8f1e4'},listings:{title:'刊登与在售',en:'LISTING COVERAGE',desc:'按渠道检查库存商品的在售覆盖，发现待刊登产品。',accent:'#8a73ad',soft:'#f1edf8'},audit:{title:'SKU 匹配校验',en:'DATA RECONCILIATION',desc:'追溯每条匹配依据，保留未匹配记录与源文件行号。',accent:'#b67d65',soft:'#f8eee8'},sources:{title:'数据与口径',en:'DATA SOURCES',desc:'查看数据来源、统计口径与本地更新方式。',accent:'#667d67',soft:'#edf2e9'}};
let tab=TABS[location.hash.slice(1)]?location.hash.slice(1):'overview';
const states={}; const tableViews=new Map(); let visibleRows=[], visibleColumns=[], activeTable='', toastTimer, metricIndex=0;
let font='medium';try{font=localStorage.getItem('apparel-font')||font;}catch{}
const ageColors=['#bfd0a9','#90ac81','#d1b77b','#c59362','#a36b52'];
function defaults(t){return {platform:'',shop:'',site:'',category:'',size:'',color:'',warehouse:'',search:'',status:t==='sales'?'已发货':'',age:'',stock:'positive',dateField:'paidAt',start:'',end:'',view:t==='sales'?'sku':t==='listings'?'coverage':'',page:1,pageSize:12,sort:'',sortDir:-1,method:''};}
function state(){return states[tab]||(states[tab]=defaults(tab));}
function tableState(context='main'){return context==='summary'?(state().summaryTable||={page:1,pageSize:12,sort:'',sortDir:-1}):state();}
function product(sku){return productMap.get(sku)||{sku,name:'未建档产品',category:'未匹配',color:'',size:'',spu:'',skc:''};}
function channelOK(r,s){return (!s.platform||r.platform===s.platform)&&(!s.shop||r.shop===s.shop)&&(!s.site||r.site===s.site);}
function productOK(p,s){const q=s.search.trim().toLowerCase();return (!s.category||p.category===s.category)&&(!s.size||p.size===s.size)&&(!s.color||p.color===s.color)&&(!q||[p.sku,p.spu,p.skc,p.name,p.color,p.size].join(' ').toLowerCase().includes(q));}
function orderRows(s){return D.orders.filter(r=>channelOK(r,s)&&productOK(product(r.sku),s)&&(!s.warehouse||r.warehouse===s.warehouse)&&(!s.status||r.status===s.status)&&(!(s.start||s.end)||r[s.dateField])&&(!s.start||r[s.dateField]>=s.start)&&(!s.end||r[s.dateField]<=s.end));}
function inventoryRows(s){return D.inventory.filter(r=>productOK(product(r.sku),s)&&(!s.warehouse||r.warehouse===s.warehouse));}
function inventoryBySKU(s){const m=new Map();for(const r of inventoryRows(s)){let p=m.get(r.sku);if(!p){p={...product(r.sku),qty:0,ages:[0,0,0,0,0],warehouses:[],asOf:r.asOf,goodsCodes:[],complete:true};m.set(r.sku,p);}if(r.qty===null)p.complete=false;else p.qty+=r.qty;r.ages.forEach((n,i)=>{if(n!==null)p.ages[i]+=n;else p.complete=false;});p.warehouses.push(r.warehouse);p.goodsCodes.push(r.goodsCode);}return [...m.values()].map(p=>({...p,warehouses:unique(p.warehouses),goodsCodes:unique(p.goodsCodes),old:p.ages[2]+p.ages[3]+p.ages[4],over365:p.ages[4]}));}
function listingRows(s, includeUnmatched=false){return D.listings.filter(r=>channelOK(r,s)&&(includeUnmatched||Object.keys(r.components).length)&&(!s.mapping||(s.mapping==='matched')===!!Object.keys(r.components).length)&&(!s.status||r.status===s.status)&&(!s.method||r.methods.includes(s.method))&&(!s.search||[r.platformSKU,r.itemId,r.title,...Object.keys(r.components)].join(' ').toLowerCase().includes(s.search.toLowerCase()))&&(!s.category||Object.keys(r.components).some(k=>product(k).category===s.category))&&(!s.size||Object.keys(r.components).some(k=>product(k).size===s.size)));}
function coverage(s){
  const inv=new Map(inventoryBySKU(s).map(r=>[r.sku,r]));const links=new Map();
  for(const r of D.listings){if(!channelOK(r,s))continue;for(const sku of Object.keys(r.components)){if(!links.has(sku))links.set(sku,[]);links.get(sku).push(r);}}
  const pending=new Set();for(const r of D.issues)if(channelOK(r,s))for(const k of r.candidates||[])pending.add(k);
  const rows=[];for(const p of D.products){if(!productOK(p,s))continue;const stock=inv.get(p.sku);const qty=stock?stock.qty:0;if(s.stock==='positive'&&qty<=0)continue;if(s.stock==='zero'&&qty>0)continue;
    const all=links.get(p.sku)||[];const live=all.filter(r=>r.status==='在售');const direct=live.filter(r=>r.kind==='单品');const combo=live.filter(r=>r.kind==='组合');
    const status=direct.length?'已在售':combo.length?'仅组合在售':pending.has(p.sku)?'刊登待核对':all.length?'已刊登未在售':'待刊登';
    const row={...p,qty:stock?.complete===false?null:qty,old:stock?.old||0,ages:stock?.ages||[0,0,0,0,0],warehouses:stock?.warehouses||[],status,direct:direct.length,combo:combo.length,listingCount:all.length,links:all,stockKnown:!!stock};
    if(!s.status||status===s.status)rows.push(row);
  }return rows;
}
function salesBySKU(rows){const m=new Map();for(const r of rows){let p=m.get(r.sku);if(!p){p={...product(r.sku),qty:0,orders:new Set(),platforms:new Set(),shops:new Set()};m.set(r.sku,p);}p.qty+=r.qty||0;p.orders.add([r.platform,r.shop,r.orderId||r.fulfillmentId].join('|'));p.platforms.add(r.platform);p.shops.add(r.shop);}return [...m.values()].map(r=>({...r,orderCount:r.orders.size,platforms:[...r.platforms].join(' / '),shops:[...r.shops].join(' / ')}));}
const orderKey=r=>[r.platform,r.shop,r.orderId||r.fulfillmentId].join('|');
const orderCount=rows=>new Set(rows.map(orderKey)).size;
function metric(label,value,unit,note,ico,emphasis=false){const key=String(metricIndex++),selected=state().summary===key;return `<button type="button" class="metric ${emphasis?'emphasis':''} ${selected?'selected':''}" data-summary="${key}" aria-expanded="${selected}" aria-controls="summary-detail" aria-label="${escape(label)}：${escape(value)}${escape(unit)}，${selected?'收起':'查看'}明细"><span class="metric-label">${label}<span class="metric-icon">${icon(ico)}</span></span><span class="metric-value">${value}<small>${unit}</small></span><span class="metric-note">${note}</span><span class="metric-hint">${selected?'收起明细':'查看明细'}${icon('arrow')}</span></button>`;}
function metrics(items){return `<div class="metric-grid">${items.join('')}</div>`;}
function banner(text,warning=false,action=''){return `<div class="banner ${warning?'warning':''}">${icon('info')}<span>${text}</span>${action}</div>`;}
function panelHead(title,sub='',extra=''){return `<div class="panel-head"><div><h2>${title}</h2>${sub?`<div class="sub">${sub}</div>`:''}</div>${extra}</div>`;}
function empty(message='当前筛选下暂无数据',help='可调整筛选条件或点击重置筛选'){return `<div class="empty">${icon('search')}<span>${message}</span><small>${help}</small></div>`;}
function badge(text){const c={'已在售':'green','在售':'green','仅组合在售':'purple','待刊登':'orange','刊登待核对':'red','已刊登未在售':'red','已发货':'green','已取消':'red','未匹配':'orange'}[text]||'blue';return `<span class="badge ${c}">${escape(text||'未提供')}</span>`;}
function skuCell(r){return `<button class="sku-link" data-sku="${escape(r.sku)}">${escape(r.sku)}</button><span class="subtext">${escape(r.name||product(r.sku).name)}</span>`;}
function ageBar(ages){const n=sum(ages,x=>x);return `<div class="age-bar" aria-label="库龄分布">${ages.map((x,i)=>`<i title="${D.meta.ageLabels[i]}：${fmt(x)}" style="width:${n?x/n*100:0}%;background:${ageColors[i]}"></i>`).join('')}</div>`;}
function donut(segments,total,label){let cursor=0;const n=sum(segments,'value');const stops=segments.map(x=>{const a=cursor;cursor+=n?x.value/n*100:0;return `${x.color} ${a}% ${cursor}%`;});return `<div class="donut-wrap"><div class="donut" style="background:${n?'conic-gradient('+stops.join(',')+')':'#edf0e7'}"><div class="donut-center"><strong>${fmt(total)}</strong><span>${label}</span></div></div><div class="donut-legend">${segments.map(x=>`<div class="legend-row"><span class="legend-name"><i style="background:${x.color}"></i>${escape(x.label)}</span><strong>${fmt(x.value)}</strong></div>`).join('')}</div></div>`;}
function trendChart(rows){
  if(!rows.length)return empty();const counts=new Map();for(const r of rows){const date=r[state().dateField||'paidAt'];if(date){const m=date.slice(0,7);counts.set(m,(counts.get(m)||0)+(r.qty||0));}}
  if(!counts.size)return empty('所选日期口径下没有有效日期','请切换日期口径');
  let months=[...counts.keys()].sort();const start=months[0],end=months.at(-1);const [sy,sm]=start.split('-').map(Number),[ey,em]=end.split('-').map(Number);months=[];for(let n=sy*12+sm-1;n<=ey*12+em-1;n++)months.push(`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`);
  const w=650,h=240,L=44,R=15,T=22,B=39,max=Math.max(...counts.values(),1),step=Math.max(1,Math.ceil(max/4/10)*10),ceil=step*4;const x=i=>L+i*(w-L-R)/Math.max(months.length-1,1), y=n=>h-B-n/ceil*(h-T-B);const pts=months.map((m,i)=>[x(i),y(counts.get(m)||0)]);const d=pts.map((p,i)=>(i?'L':'M')+p.join(',')).join(' ');const area=d+` L${x(months.length-1)},${h-B} L${L},${h-B} Z`;
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="月度单品销量趋势"><defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${TABS[tab].accent}" stop-opacity=".17"/><stop offset="100%" stop-color="${TABS[tab].accent}" stop-opacity=".01"/></linearGradient></defs>${[0,1,2,3,4].map(i=>`<line class="grid-line" x1="${L}" x2="${w-R}" y1="${y(i*step)}" y2="${y(i*step)}"/><text x="${L-10}" y="${y(i*step)+4}" text-anchor="end">${fmt(i*step)}</text>`).join('')}<path d="${area}" fill="url(#trend-fill)"/><path d="${d}" fill="none" stroke="${TABS[tab].accent}" stroke-width="2.5" stroke-linejoin="round"/>${pts.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="3.5" stroke="${TABS[tab].accent}" stroke-width="2" fill="white"><title>${months[i]}：${fmt(counts.get(months[i])||0)} 件</title></circle>`).join('')}${months.map((m,i)=>`<text x="${x(i)}" y="${h-13}" text-anchor="middle">${Number(m.slice(5))}月</text>`).join('')}<text x="${L}" y="11">单位：件 · ${start.slice(0,4)}年</text></svg></div>`;
}
function rankChart(rows,field,value='qty',limit=5){const m=new Map();for(const r of rows){const k=r[field]||'未提供';m.set(k,(m.get(k)||0)+(Number(r[value])||0));}const sorted=[...m].sort((a,b)=>b[1]-a[1]).slice(0,limit);const max=Math.max(...sorted.map(x=>x[1]),1);return sorted.length?`<div class="ranking">${sorted.map(([k,v],i)=>`<div class="rank-row"><span class="rank-no">${String(i+1).padStart(2,'0')}</span><span>${escape(k)}</span><div class="rank-bar"><i style="width:${v/max*100}%"></i></div><span class="rank-value">${fmt(v)}</span></div>`).join('')}</div>`:empty();}
function selectField(key,label,options,all){const s=state();return `<div class="filter-field"><label for="f-${key}">${label}</label><select id="f-${key}" data-filter="${key}"><option value="">${all||'全部'}</option>${options.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o];return `<option value="${escape(v)}" ${s[key]===v?'selected':''}>${escape(l)}</option>`;}).join('')}</select></div>`;}
function renderFilters(){const s=state();const channels=[...D.listings,...D.orders,...D.salesCodes];let f='';
  if(['overview','sales','listings','audit'].includes(tab)){
    f+=selectField('platform','平台',unique(channels.map(r=>r.platform)).sort(),'全部平台');
    f+=selectField('shop','店铺',unique(channels.filter(r=>!s.platform||r.platform===s.platform).map(r=>r.shop)).sort(),'全部店铺');
    f+=selectField('site','站点',unique(channels.filter(r=>(!s.platform||r.platform===s.platform)&&(!s.shop||r.shop===s.shop)).map(r=>r.site)).sort(),'全部站点');
  }
  if(!['audit','sources'].includes(tab)){
    f+=selectField('category','产品分类',unique(D.products.map(r=>r.category)).sort(),'全部分类');
    if(tab!=='overview'){f+=selectField('size','尺码',unique(D.products.map(r=>r.size)).sort(),'全部尺码');f+=selectField('color','颜色',unique(D.products.map(r=>r.color)).sort(),'全部颜色');}
    if(['inventory','listings','sales'].includes(tab))f+=selectField('warehouse','仓库',unique(D.inventory.map(r=>r.warehouse)).sort(),'全部仓库');
  }
  if(['sales','overview'].includes(tab)){
    f+=`<div class="filter-field"><label for="f-dateField">日期口径</label><select id="f-dateField" data-filter="dateField">${[['paidAt','付款日期'],['createdAt','创建日期'],['shippedAt','发货日期']].map(([v,l])=>`<option value="${v}" ${s.dateField===v?'selected':''}>${l}</option>`).join('')}</select></div>`;
    for(const [key,label] of [['start','开始日期'],['end','结束日期']])f+=`<div class="filter-field"><label for="f-${key}">${label}</label><input type="date" id="f-${key}" data-filter="${key}" value="${escape(s[key])}"></div>`;
    if(tab==='sales')f+=selectField('status','履约单状态',unique(D.orders.map(r=>r.status)),'全部状态');
  }
  if(tab==='inventory')f+=selectField('age','库龄筛选',[['2','181天及以上'],['3','271天及以上'],['4','365天以上']],'全部库龄');
  if(tab==='listings'){
    f+=`<div class="filter-field"><label for="f-stock">库存范围</label><select id="f-stock" data-filter="stock">${[['positive','有库存产品'],['','全部档案产品'],['zero','未见正库存产品']].map(([v,l])=>`<option value="${v}" ${s.stock===v?'selected':''}>${l}</option>`).join('')}</select></div>`;
    f+=selectField('status','刊登状态',['已在售','仅组合在售','已刊登未在售','待刊登','刊登待核对'],'全部状态');
  }
  if(tab==='audit'){f+=selectField('mapping','匹配状态',[['matched','已匹配'],['unmatched','待核对']],'全部状态');f+=selectField('method','匹配方式',unique(D.listings.flatMap(r=>r.methods)).sort(),'全部方式');}
  if(tab!=='sources')f+=`<div class="filter-field search"><label for="f-search">搜索</label><input id="f-search" data-filter="search" placeholder="${tab==='audit'?'平台 SKU / 商品标题':'SKU / SPU / 商品名称'}" value="${escape(s.search)}" autocomplete="off"></div>`;
  if(tab==='sources')f=`<div class="filter-field search"><label for="f-search">查找来源或口径</label><input id="f-search" data-filter="search" placeholder="输入来源或口径关键字" value="${escape(s.search)}"></div>`;
  $('#filters').innerHTML=f;
}
const C={
 sku:{key:'sku',label:'单品 SKU / 商品',exportLabel:'单品SKU',render:skuCell},
 category:{key:'category',label:'产品分类'},color:{key:'color',label:'颜色'},size:{key:'size',label:'尺码'},spu:{key:'spu',label:'SPU'},skc:{key:'skc',label:'SKC'},
 qty:{key:'qty',label:'销量（件）',numeric:true,render:r=>`<strong>${fmt(r.qty)}</strong>`},stock:{key:'qty',label:'库存（件）',numeric:true,render:r=>`<strong>${fmt(r.qty)}</strong>`},
 status:{key:'status',label:'状态',render:r=>badge(r.status)},orderCount:{key:'orderCount',label:'订单数',numeric:true},
};
function table(rows,columns,{title='数据明细',view='',note='',defaultSort='qty',id='detail',context='main',controls='',caption=''}={}){
  const s=tableState(context);if(context==='main'){visibleRows=rows;visibleColumns=columns;activeTable=id;}
  const sortKey=s.sort||defaultSort;const sortColumn=columns.find(c=>c.key===sortKey);
  rows=[...rows].sort((a,b)=>{let av=sortColumn?.value?sortColumn.value(a):a[sortKey],bv=sortColumn?.value?sortColumn.value(b):b[sortKey];if(sortColumn?.numeric||typeof av==='number'||typeof bv==='number')return ((av??-Infinity)-(bv??-Infinity))*s.sortDir;return String(av??'').localeCompare(String(bv??''),'zh-CN')*s.sortDir;});
  tableViews.set(context,{rows,columns,title});if(context==='main')visibleRows=rows;
  const pages=Math.max(1,Math.ceil(rows.length/s.pageSize));s.page=Math.max(1,Math.min(s.page,pages));const start=(s.page-1)*s.pageSize;const page=rows.slice(start,start+s.pageSize);
  return `<section class="panel" data-table="${context}"><div class="table-toolbar"><div><div class="table-heading"><h2>${title}</h2><span class="table-count">${fmt(rows.length)} 条</span></div>${caption?`<div class="summary-caption">${caption}</div>`:''}</div><div class="table-actions">${view}<button class="button secondary mini" data-action="export">${icon('download')}${context==='summary'?'导出本项全部明细':'导出筛选结果'}</button>${controls}</div></div>${rows.length?`<div class="table-scroll"><table><thead><tr>${columns.map(c=>`<th class="${c.numeric?'num':''}"><button data-sort="${c.key}" aria-label="按${c.label}排序">${c.label}<span>${sortKey===c.key?(s.sortDir===1?'↑':'↓'):'↕'}</span></button></th>`).join('')}</tr></thead><tbody>${page.map(r=>`<tr>${columns.map(c=>`<td class="${c.numeric?'num':''}" title="${escape(c.title?c.title(r):Array.isArray(r[c.key])?r[c.key].join(' / '):r[c.key]??'')}">${c.render?c.render(r):escape(c.numeric?fmt(r[c.key]):Array.isArray(r[c.key])?r[c.key].join(' / '):r[c.key]||'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:empty()}<div class="pagination"><span>共 ${fmt(rows.length)} 条${rows.length?`，显示 ${start+1}–${Math.min(start+s.pageSize,rows.length)} 条`:''}</span><div class="pagination-controls"><label>每页 <select data-action="page-size">${[12,25,50,100].map(n=>`<option ${s.pageSize===n?'selected':''}>${n}</option>`).join('')}</select></label><button data-action="prev" ${s.page<=1?'disabled':''}>上一页</button><span>${s.page} / ${pages}</span><button data-action="next" ${s.page>=pages?'disabled':''}>下一页</button></div></div>${note?`<div class="table-note">${note}</div>`:''}</section>`;
}
function segments(options){return `<div class="segmented">${options.map(([key,label])=>`<button data-view="${key}" class="${state().view===key?'active':''}">${label}</button>`).join('')}</div>`;}
function overview(){const s={...state(),status:'已发货',stock:'positive'};const orders=orderRows(s),inv=inventoryBySKU(s),cov=coverage({...s,status:''});const total=sum(inv,'qty'),old=sum(inv,'old'),covered=cov.filter(r=>r.status==='已在售'||r.status==='仅组合在售'),waiting=cov.filter(r=>r.status==='待刊登');
  const ages=D.meta.ageLabels.map((label,i)=>({label,value:sum(inv,r=>r.ages[i]),color:ageColors[i]}));
  let html=metrics([metric('已发货单品销量',fmt(sum(orders,'qty')),'件',`${fmt(orderCount(orders))} 个平台订单 · 排除已取消`,'sales',true),metric('库龄库存总量',fmt(total),'件',`${fmt(inv.filter(r=>r.qty>0).length)} 个有库存单品 SKU`,'inventory'),metric('高库龄库存',fmt(old),'件',`181天及以上 · 占比 ${pct(old,total)}`,'order'),metric('有库存待刊登',fmt(waiting.length),'SKU',`在售覆盖率 ${pct(covered.length,cov.length)} · 含组合覆盖`,'listings')]);
  html+=`<div class="grid-two"><section class="panel">${panelHead('销量走势','按月汇总已发货单品数量',`<span class="small-pill">${{paidAt:'付款日期',createdAt:'创建日期',shippedAt:'发货日期'}[s.dateField]}</span>`)}${trendChart(orders)}</section><section class="panel">${panelHead('库存库龄结构','库龄快照 · '+escape(D.inventory[0]?.asOf||'未提供'))}${donut(ages,total,'库龄库存 / 件')}<div class="insight-strip">365天以上库存 <strong>${fmt(sum(inv,'over365'))} 件</strong>，占总库存 ${pct(sum(inv,'over365'),total)}。</div></section></div>`;
  html+=`<div class="grid-equal"><section class="panel">${panelHead('平台销量分布','按当前筛选范围统计，单位：件')}${rankChart(orders,'platform')}</section><section class="panel">${panelHead('库存商品刊登覆盖','组合商品覆盖单独标记')} ${donut([{label:'已在售',value:cov.filter(r=>r.status==='已在售').length,color:'#73966b'},{label:'仅组合在售',value:cov.filter(r=>r.status==='仅组合在售').length,color:'#a896c0'},{label:'待刊登',value:waiting.length,color:'#d5b879'},{label:'其他 / 待核对',value:cov.filter(r=>!['已在售','仅组合在售','待刊登'].includes(r.status)).length,color:'#c58d77'}],cov.length,'有库存 / SKU')}</section></div>`;
  const saleMap=new Map(salesBySKU(orders).map(r=>[r.sku,r.qty]));const rows=cov.map(r=>({...r,sales: saleMap.get(r.sku)||0}));
  html+=table(rows,[C.sku,C.category,C.size,{key:'sales',label:'已发货销量',numeric:true},C.stock,{key:'old',label:'181天及以上',numeric:true},C.status],{title:'库存商品经营明细',defaultSort:'sales',note:'销量受所选日期与渠道筛选影响；库存为共享仓快照。点击 SKU 可查看产品、库龄与原始刊登信息。'});return html;
}
function sales(){const s=state();const rows=orderRows(s),qty=sum(rows,'qty'),cancelled=orderRows({...s,status:'已取消'});let html=metrics([metric(s.status==='已发货'?'已发货单品销量':'所选状态单品数量',fmt(qty),'件','直接汇总对应单品 SKU 数量','sales',true),metric('平台订单数',fmt(orderCount(rows)),'单','按平台 + 店铺 + 平台订单号去重','order'),metric('销售单品',fmt(unique(rows.map(r=>r.sku)).length),'SKU',`${fmt(rows.length)} 条单品明细`,'inventory'),metric('已取消单品数量',fmt(sum(cancelled,'qty')),'件','同一日期和渠道范围；默认不计入销量','info')]);
  const missing=D.orders.filter(r=>!r[s.dateField]&&channelOK(r,s)&&(!s.status||s.status===r.status)).length;
  if(missing)html+=banner(`${fmt(missing)} 条源记录缺少所选日期；指定日期区间时这些记录不参与统计，未指定区间时保留在总量中。`,true);
  html+=`<div class="grid-two"><section class="panel">${panelHead('月度单品销量','未提供订单金额，不计算销售额或客单价')}${trendChart(rows)}</section><section class="panel">${panelHead('店铺销量排行','所选履约状态 · 单位：件')}${rankChart(rows,'shop', 'qty',6)}</section></div>`;
  const v=segments([['sku','单品汇总'],['rows','订单明细']]);
  if(s.view==='rows')html+=table(rows.map(r=>({...r,name:product(r.sku).name})),[{key:'orderId',label:'平台订单号'},C.sku,{key:'platform',label:'平台'},{key:'shop',label:'店铺'},{key:s.dateField,label:{paidAt:'付款日期',createdAt:'创建日期',shippedAt:'发货日期'}[s.dateField]},C.qty,C.status,{key:'platformSKU',label:'原始平台 SKU'},{key:'sourceRow',label:'源行号',numeric:true}],{title:'订单销量明细',view:v,note:'保留源文件单品行；组合拆分行不重复乘商品数量。订单数按平台、店铺、平台订单号去重；不同 SKU 的订单数不能直接相加。'});
  else html+=table(salesBySKU(rows),[C.sku,C.category,C.color,C.size,C.qty,C.orderCount,{key:'platforms',label:'平台'},{key:'shops',label:'店铺'}],{title:'单品销量明细',view:v,note:'单品订单数分别去重，同一订单可包含多个单品，各行订单数之和可能大于整体订单数。'});return html;
}
function inventory(){const s=state();let rows=inventoryBySKU(s);if(s.age!=='')rows=rows.filter(r=>sum(r.ages.slice(Number(s.age)),x=>x)>0);const qty=sum(rows,'qty'),old=sum(rows,'old');let html=metrics([metric('库龄库存总量',fmt(qty),'件','五个库龄区间数量之和','inventory',true),metric('有库存产品',fmt(rows.filter(r=>r.qty>0).length),'SKU',`${fmt(unique(rows.flatMap(r=>r.warehouses)).length)} 个仓库`,'order'),metric('181天及以上库存',fmt(old),'件',`占总库存 ${pct(old,qty)}`,'info'),metric('365天以上库存',fmt(sum(rows,'over365')),'件',`占总库存 ${pct(sum(rows,'over365'),qty)}`,'inventory')]);
  html+=`<div class="grid-equal"><section class="panel">${panelHead('库龄分布','单位：件 · 生成于 '+escape(D.inventory[0]?.asOf))}${donut(D.meta.ageLabels.map((label,i)=>({label,value:sum(rows,r=>r.ages[i]),color:ageColors[i]})),qty,'库龄库存 / 件')}</section><section class="panel">${panelHead('分类库存排行','按产品档案分类汇总')}${rankChart(rows,'category','qty',6)}</section></div>`;
  html+=table(rows,[C.sku,C.category,C.color,C.size,C.stock,...D.meta.ageLabels.map((label,i)=>({key:'age'+i,label,numeric:true,render:r=>fmt(r.ages[i]),value:r=>r.ages[i]})),{key:'warehouses',label:'仓库'}],{title:'库存库龄明细',note:'库存是库龄报表的实物数量，未扣减锁定量或预留量，不等同于可售库存。库龄筛选保留命中区间有数量的 SKU，并展示这些 SKU 的全部库存。'});return html;
}
function listings(){const s=state();const all=coverage({...s,status:''}),rows=coverage(s),total=all.length,covered=all.filter(r=>['已在售','仅组合在售'].includes(r.status));let html=metrics([metric('库存商品在售覆盖率',pct(covered.length,total),'',`${fmt(covered.length)} / ${fmt(total)} 个所选范围 SKU`,'listings',true),metric('单品独立在售',fmt(all.filter(r=>r.status==='已在售').length),'SKU','有独立的单品在售记录','listings'),metric('仅组合在售',fmt(all.filter(r=>r.status==='仅组合在售').length),'SKU','通过组合商品覆盖，单独标记','inventory'),metric('待刊登产品',fmt(all.filter(r=>r.status==='待刊登').length),'SKU','所选渠道内未查到已匹配的刊登','info')]);
  html+=banner('刊登范围：'+escape(s.platform||'全部平台')+' / '+escape(s.shop||'全部店铺')+' / '+escape(s.site||'全部站点')+'。共享仓库存不按店铺分摊。未匹配商品不会直接计入在售覆盖。',false,`<button data-nav="audit">查看匹配校验 →</button>`);
  const v=segments([['coverage','产品覆盖'],['details','刊登详情']]);
  if(s.view==='details'){
    const skuSet=new Set(rows.map(r=>r.sku));const lr=D.listings.filter(r=>channelOK(r,s)&&Object.keys(r.components).some(k=>skuSet.has(k)));
    html+=table(lr.map(r=>({...r,componentText:Object.entries(r.components).map(([k,q])=>k+' × '+q).join(' / '),methodsText:r.methods.join(' / ')})),[{key:'platformSKU',label:'原始平台 SKU'},{key:'platform',label:'平台'},{key:'shop',label:'店铺'},{key:'site',label:'站点'},{key:'kind',label:'商品类型'},C.status,{key:'componentText',label:'匹配单品与用量'},{key:'methodsText',label:'匹配依据'},{key:'listedAt',label:'上架日期'},{key:'itemId',label:'商品 ID'}],{title:'商品刊登详情',view:v,defaultSort:'listedAt',note:'商品按平台、店铺、站点、商品 ID 与平台 SKU 合并，组合商品的成分行汇总到同一商品。售价未提供币种，不跨平台汇总。'});
  }else html+=table(rows,[C.sku,C.category,C.color,C.size,{...C.stock,render:r=>`<strong>${fmt(r.qty)}</strong>${ageBar(r.ages)}`},C.status,{key:'direct',label:'独立在售刊登数',numeric:true},{key:'combo',label:'组合在售刊登数',numeric:true},{key:'old',label:'181天及以上',numeric:true}],{title:'商品刊登覆盖明细',view:v,note:'“待刊登”表示在已提供且已匹配的商品快照中未查到刊登；未提供的渠道数据与未识别写法仍可能影响结论。“未见正库存”仅代表本次库龄快照。'});return html;
}
function audit(){const s=state();const all=listingRows(s,true);const mapped=all.filter(r=>Object.keys(r.components).length),unmapped=all.filter(r=>!Object.keys(r.components).length);let html=metrics([metric('商品记录匹配率',pct(mapped.length,all.length),'',`${fmt(mapped.length)} / ${fmt(all.length)} 条去重商品记录`,'audit',true),metric('已匹配商品',fmt(mapped.length),'条','可追溯至产品档案与组合成分','listings'),metric('未匹配商品',fmt(unmapped.length),'条','含其他品类与待补充产品档案记录','info'),metric('订单 / 库存匹配率',pct(D.orders.filter(r=>r.matched).length,D.orders.length)+' / '+pct(D.inventory.filter(r=>r.matched).length,D.inventory.length),'','全部源记录 · 与当前渠道筛选无关','inventory')]);
  html+=banner('原始平台 SKU 全程保留。先精确匹配产品档案，再匹配完整边界；内部连接符唯一补配、缩写组合按已确认规则处理。未匹配不自动猜测品类或关联产品。',true);
  const methods=new Map();for(const r of all)for(const m of r.methods)methods.set(m,(methods.get(m)||0)+1);
  html+=`<div class="grid-equal"><section class="panel">${panelHead('商品匹配结果','按商品去重统计')}${donut([{label:'已匹配',value:mapped.length,color:'#86a57b'},{label:'未匹配',value:unmapped.length,color:'#d1b188'}],all.length,'商品记录')}</section><section class="panel">${panelHead('匹配依据','同一商品可能包含多个匹配依据')}${rankChart([...methods].map(([method,qty])=>({method,qty})),'method','qty',6)}</section></div>`;
  const rows=all.map(r=>({...r,componentText:Object.entries(r.components).map(([k,q])=>k+' × '+q).join(' / '),methodsText:r.methods.join(' / '),sourceText:r.sourceRows.join(' / '),mappingStatus:Object.keys(r.components).length?'已匹配':'待核对'}));
  html+=table(rows,[{key:'platformSKU',label:'原始平台 SKU'},{key:'platform',label:'平台'},{key:'shop',label:'店铺'},{key:'mappingStatus',label:'匹配状态',render:r=>badge(r.mappingStatus)},{key:'componentText',label:'匹配单品与用量'},{key:'methodsText',label:'匹配依据'},{key:'candidates',label:'待确认候选（未计入覆盖）'},{key:'siteSource',label:'站点来源'},{key:'sourceText',label:'商品源表 / 行号'},{key:'title',label:'商品标题'}],{title:'SKU 匹配追溯',defaultSort:'mappingStatus',note:'平台 SKU 的前后“-”只用作候选边界，不按固定段数截取；不会把 L、XL、2XL 或不同颜色的 SKU 混为一体。'});return html;
}
const definitions=[
  ['汇总卡片明细','点击各业务页面顶部的汇总卡片，可在卡片下方展开全部对应明细。展开区支持独立排序、分页与导出，导出包含全部分页。再次点击卡片或“收起”可以关闭。比率卡片可切换分子明细与分母全部范围。'],
  ['销量与订单','单品销量直接汇总履约文件的“对应单品sku数量”。默认仅统计已发货，已取消可筛选。组合已拆成单品行，不再次乘商品数量。平台订单数按平台、店铺、平台订单号去重，平台订单号为空时使用履约单号。未提供金额字段，因此不显示销售额。'],
  ['库存与库龄','库存总量为 0–90天、91–180天、181–270天、271–365天、365天以上五个区间之和。高库龄指181天及以上。数据仅覆盖提供的仓库快照，不代表全部仓库或可售库存，未见库存不等于真实零库存。'],
  ['刊登覆盖与组合','按所选平台、店铺、站点检查；未选择时检查全部店铺。有独立单品在售记为“已在售”；仅有组合商品在售记为“仅组合在售”，计入覆盖。有记录但未在售记为“已刊登未在售”；未找到记录记为“待刊登”。候选关系未确认时显示“刊登待核对”。'],
  ['SKU 匹配规则','产品管理文件是单品、SPU、SKC、颜色、尺码和组合成分的依据。产品SKU非空时优先精确匹配；为空时查平台SKU的完整边界候选。严格匹配失败后，允许唯一的内部连接符补配。支持完整 A/B、A*2 及经确认的同SPU唯一前缀缩写组合；多个候选或未知成分保留待核对。'],
  ['渠道与销售代码','平台名称统一大小写及 Tiktok / TIKTOK SHOP 等明确名称。源站点为空且销售代码表中平台+店铺仅有一个站点时补充该站点，保留站点来源。销售代码表是2026年10月的参考表，不替代订单中的实际销售人员。共享仓库存不按销售代码或店铺分摊。'],
  ['筛选与导出','每个业务页独立保存筛选条件。导出当前视图的全部筛选结果，包含全部分页，文件为 UTF-8 BOM CSV，可用 Excel 打开。SKU、商品ID和订单号保留为文本内容，Excel导入时应将这些列指定为文本，避免长数字丢失精度。小、中、大字体会记住当前浏览器选择。'],
  ['更新数据','将最新 Excel 放回五个数据文件夹，双击“更新线上看板.cmd”。脚本会重读数据、提交到 GitHub 并等待 Pages 发布，显示“线上更新成功”后刷新网页即可。无需 GPT 或 Codex，需联网且 GitHub CLI 已登录。原“更新看板.cmd”只更新本地。'],
];
function sourceRows(){const keys={products:'产品档案',listings:'商品刊登',inventory:'库存库龄',orders:'履约订单',salesCodes:'销售代码'};return Object.entries(D.meta.sources).map(([key,file])=>({source:keys[key],file,records:{products:D.meta.counts.products,listings:D.meta.counts.listingRows,inventory:D.meta.counts.inventoryRows,orders:D.meta.counts.orderRows,salesCodes:D.meta.counts.salesCodeRows}[key],description:{products:`另有 ${fmt(D.meta.counts.combos)} 个组合SKU`,listings:`去重后 ${fmt(D.meta.counts.listings)} 个商品`,inventory:'五个库龄区间',orders:'已拆分至单品SKU维度',salesCodes:'2026年10月参考表'}[key]}));}
function sources(){const s=state(),q=s.search.toLowerCase();const sr=sourceRows().filter(r=>[r.source,r.file,r.description].join(' ').toLowerCase().includes(q));visibleRows=sr;visibleColumns=[{key:'source',label:'数据来源'},{key:'file',label:'源文件'},{key:'records',label:'记录数'},{key:'description',label:'说明'}];let html=`<div class="source-cards">${sr.map(r=>`<section class="panel source-card"><h3>${escape(r.source)}<span class="small-pill">XLSX</span></h3><div class="filename">${escape(r.file)}</div><div class="source-meta"><span>记录数<strong>${fmt(r.records)}</strong></span><span>${escape(r.description)}</span></div></section>`).join('')}</div>`;html+=`<section class="panel">${panelHead('统计口径与使用说明','数据按源文件快照展示，未连接实时业务系统')}<div class="definitions">${definitions.filter(r=>r.join(' ').toLowerCase().includes(q)).map(([h,p])=>`<div class="definition"><strong>${escape(h)}</strong>${escape(p)}</div>`).join('')}</div></section>`;return html;}
function inventoryViewRows(s){let rows=inventoryBySKU(s);if(s.age!=='')rows=rows.filter(r=>sum(r.ages.slice(Number(s.age)),x=>x)>0);return rows;}
function ordersByOrder(rows){
  const groups=new Map();
  for(const r of rows){const key=orderKey(r);let g=groups.get(key);if(!g){g={platform:r.platform,shop:r.shop,site:r.site,orderId:r.orderId||r.fulfillmentId,qty:0,skus:new Set(),statuses:new Set(),sourceRows:[],fulfillments:new Set()};groups.set(key,g);}g.qty+=r.qty||0;g.skus.add(r.sku);g.statuses.add(r.status);g.sourceRows.push(r.sourceRow);g.fulfillments.add(r.fulfillmentId);}
  return [...groups.values()].map(g=>({...g,skuCount:g.skus.size,skuText:[...g.skus].join(' / '),status:[...g.statuses].join(' / '),fulfillmentText:[...g.fulfillments].join(' / ')}));
}
function summaryOrderColumns(s){return [{key:'orderId',label:'平台订单号'},{key:'fulfillmentId',label:'履约单号'},C.sku,{key:'platform',label:'平台'},{key:'shop',label:'店铺'},{key:'site',label:'站点'},{key:s.dateField,label:{paidAt:'付款日期',createdAt:'创建日期',shippedAt:'发货日期'}[s.dateField]},C.qty,C.status,{key:'platformSKU',label:'原始平台 SKU'},{key:'sourceRow',label:'源行号',numeric:true}];}
function summaryInventoryColumns(focus=''){
  const amounts=focus?[{key:'focusQty',label:focus==='old'?'181天及以上（件）':'365天以上（件）',numeric:true,value:r=>r[focus],render:r=>`<strong>${fmt(r[focus])}</strong>`},{...C.stock,label:'SKU全部库存（件）'}]:[C.stock];
  return [C.sku,C.category,C.color,C.size,...amounts,...D.meta.ageLabels.map((label,i)=>({key:'age'+i,label,numeric:true,value:r=>r.ages[i],render:r=>fmt(r.ages[i])})),{key:'warehouses',label:'仓库'}];
}
function summaryCoverageColumns(){return [C.sku,C.category,C.color,C.size,C.stock,C.status,{key:'direct',label:'独立在售刊登数',numeric:true},{key:'combo',label:'组合在售刊登数',numeric:true},{key:'listingCount',label:'全部刊登数',numeric:true},{key:'warehouses',label:'仓库'}];}
function auditRows(rows){return rows.map(r=>({...r,componentText:Object.entries(r.components).map(([k,q])=>k+' × '+q).join(' / '),methodsText:r.methods.join(' / '),sourceText:r.sourceRows.join(' / '),mappingStatus:Object.keys(r.components).length?'已匹配':'待核对'}));}
function summaryAuditColumns(){return [{key:'platformSKU',label:'原始平台 SKU'},{key:'platform',label:'平台'},{key:'shop',label:'店铺'},{key:'site',label:'站点'},{key:'mappingStatus',label:'匹配状态',render:r=>badge(r.mappingStatus)},{key:'componentText',label:'匹配单品与用量'},{key:'methodsText',label:'匹配依据'},{key:'candidates',label:'待确认候选'},{key:'sourceText',label:'源表 / 行号'},{key:'title',label:'商品标题'}];}
function summaryData(){
  const s=state(),i=Number(s.summary);if(s.summary==null||!Number.isInteger(i)||i<0||i>3)return null;
  const result=(title,rows,columns,caption,note='',extra={})=>({title,rows,columns,caption,note,...extra});
  const lineDetails=(rows,title)=>result(title,rows.map(r=>({...r,name:product(r.sku).name})),summaryOrderColumns(s),`合计 ${fmt(sum(rows,'qty'))} 件 · ${fmt(orderCount(rows))} 个平台订单`,'数量直接汇总对应单品 SKU 数量；组合拆分行不重复乘算。日期缺失记录的处理与卡片一致。');
  const stockDetails=(rows,title,focus='')=>result(title,rows,summaryInventoryColumns(focus),`合计 ${fmt(sum(rows,focus||'qty'))} 件 · ${fmt(rows.length)} 个 SKU`,focus?'本项合计仅统计所选高库龄区间；“SKU全部库存”与较新库龄数量供核对，不重复计入本项合计。':'库存为所选仓库与产品范围的库龄快照，不按平台、店铺或订单日期分摊。',{defaultSort:focus||'qty'});
  const coverageDetails=(rows,title)=>result(title,rows,summaryCoverageColumns(),`${fmt(rows.length)} 个 SKU · 库存 ${fmt(sum(rows,'qty'))} 件`,'按当前平台、店铺、站点与产品范围核对；状态范围与所点卡片一致，组合覆盖单独标记。');
  if(tab==='overview'){
    const scope={...s,status:'已发货',stock:'positive'},inv=inventoryBySKU(scope);
    if(i===0)return lineDetails(orderRows(scope),'已发货单品销量明细');
    if(i===1)return stockDetails(inv,'库龄库存总量明细');
    if(i===2)return stockDetails(inv.filter(r=>r.old>0),'高库龄库存明细','old');
    return coverageDetails(coverage({...scope,status:'待刊登'}),'有库存待刊登明细');
  }
  if(tab==='sales'){
    const rows=orderRows(s);
    if(i===0)return lineDetails(rows,s.status==='已发货'?'已发货单品销量明细':'所选状态单品数量明细');
    if(i===1){const orders=ordersByOrder(rows);return result('平台订单明细',orders,[{key:'orderId',label:'平台订单号'},{key:'platform',label:'平台'},{key:'shop',label:'店铺'},{key:'site',label:'站点'},C.qty,{key:'skuCount',label:'单品数',numeric:true},{key:'skuText',label:'包含单品 SKU'},C.status,{key:'fulfillmentText',label:'履约单号'},{key:'sourceRows',label:'源行号'}],`${fmt(orders.length)} 个去重平台订单 · ${fmt(sum(orders,'qty'))} 件`,'按平台 + 店铺 + 平台订单号去重，缺少平台订单号时使用履约单号；每行数量为当前筛选范围内该订单的单品数量之和。');}
    if(i===2){const products=salesBySKU(rows);return result('销售单品明细',products,[C.sku,C.category,C.color,C.size,C.qty,C.orderCount,{key:'platforms',label:'平台'},{key:'shops',label:'店铺'}],`${fmt(products.length)} 个 SKU · ${fmt(sum(products,'qty'))} 件`,'同一订单可以包含多个单品，各行单品订单数不能直接相加作为整页订单数。');}
    return lineDetails(orderRows({...s,status:'已取消'}),'已取消单品明细');
  }
  if(tab==='inventory'){
    const inv=inventoryViewRows(s);
    if(i===0)return stockDetails(inv,'库龄库存总量明细');
    if(i===1)return stockDetails(inv.filter(r=>r.qty>0),'有库存产品明细');
    if(i===2)return stockDetails(inv.filter(r=>r.old>0),'181天及以上库存明细','old');
    return stockDetails(inv.filter(r=>r.over365>0),'365天以上库存明细','over365');
  }
  if(tab==='listings'){
    const all=coverage({...s,status:''});
    if(i===0){const covered=all.filter(r=>['已在售','仅组合在售'].includes(r.status)),mode=s.summaryView||'covered';const data=coverageDetails(mode==='all'?all:covered,'库存商品在售覆盖明细');return {...data,caption:`覆盖 ${fmt(covered.length)} / ${fmt(all.length)} 个 SKU · 覆盖率 ${pct(covered.length,all.length)}`,options:[['covered','已覆盖（分子）'],['all','全部范围（分母）']],mode};}
    const status=['','已在售','仅组合在售','待刊登'][i];return coverageDetails(all.filter(r=>r.status===status),`${status==='已在售'?'单品独立在售':status==='待刊登'?'待刊登产品':status}明细`);
  }
  if(tab==='audit'){
    if(i===3){const mode=s.summaryView||'orders',orders=D.orders.filter(r=>r.matched).length,inventory=D.inventory.filter(r=>r.matched).length;
      const rows=mode==='orders'?D.orders.map(r=>({...product(r.sku),...r,mappingStatus:r.matched?'已匹配':'待核对'})):D.inventory.map(r=>({...product(r.sku),...r,mappingStatus:r.matched?'已匹配':'待核对'}));
      const columns=mode==='orders'?[...summaryOrderColumns(s),{key:'mappingStatus',label:'主档匹配',render:r=>badge(r.mappingStatus)}]:[C.sku,{key:'warehouse',label:'仓库'},C.stock,...D.meta.ageLabels.map((label,j)=>({key:'age'+j,label,numeric:true,value:r=>r.ages[j],render:r=>fmt(r.ages[j])})),{key:'mappingStatus',label:'主档匹配',render:r=>badge(r.mappingStatus)},{key:'sourceRow',label:'源行号',numeric:true}];
      return result('订单 / 库存主档匹配明细',rows,columns,`订单已匹配 ${fmt(orders)} / ${fmt(D.orders.length)} 条 · 库存已匹配 ${fmt(inventory)} / ${fmt(D.inventory.length)} 条`,'此项与卡片一致，核对全部源记录，不受当前页面的平台、店铺、站点或搜索条件限制。',{options:[['orders','订单记录'],['inventory','库存记录']],mode});
    }
    const all=listingRows(s,true),mapped=all.filter(r=>Object.keys(r.components).length);
    let rows,title,extra={};
    if(i===0){const mode=s.summaryView||'matched';rows=mode==='all'?all:mapped;title='商品记录匹配率明细';extra={options:[['matched','已匹配（分子）'],['all','全部范围（分母）']],mode};}
    else{rows=i===1?mapped:all.filter(r=>!Object.keys(r.components).length);title=i===1?'已匹配商品明细':'未匹配商品明细';}
    return result(title,auditRows(rows),summaryAuditColumns(),i===0?`已匹配 ${fmt(mapped.length)} / ${fmt(all.length)} 条 · 匹配率 ${pct(mapped.length,all.length)}`:`${fmt(rows.length)} 条商品记录`,'保留原始平台 SKU、源表行号与匹配依据；未匹配记录不推断为在售覆盖。',{defaultSort:'platformSKU',...extra});
  }
  return null;
}
function renderSummary(){
  const data=summaryData();if(!data)return '<div id="summary-detail" hidden></div>';
  const view=data.options?`<div class="segmented">${data.options.map(([key,label])=>`<button data-summary-view="${key}" class="${data.mode===key?'active':''}">${label}</button>`).join('')}</div>`:'';
  return `<div id="summary-detail" class="summary-detail" role="region" aria-label="${escape(data.title)}">${table(data.rows,data.columns,{title:data.title,caption:data.caption,note:data.note,defaultSort:data.defaultSort||'qty',context:'summary',view,controls:'<button class="button secondary mini" data-action="close-summary" aria-label="收起汇总明细">收起 ×</button>'})}</div>`;
}
function updateContent(){const s=state();tableViews.clear();metricIndex=0;if(s.start&&s.end&&s.start>s.end){visibleRows=[];$('#content').innerHTML=banner('开始日期不能晚于结束日期，请调整日期范围。',true);return;}const html={overview,sales,inventory,listings,audit,sources}[tab]();$('#content').innerHTML=html;
  if($('.metric-grid'))$('.metric-grid').insertAdjacentHTML('afterend',renderSummary());
  const scoped=['overview','sales','listings','audit'].includes(tab);$('#active-scope').innerHTML=`<span>${scoped?`当前范围：<strong>${escape(s.platform||'全部平台')} / ${escape(s.shop||'全部店铺')} / ${escape(s.site||'全部站点')}</strong>`:`当前范围：<strong>${escape(s.warehouse||'全部仓库')} · ${escape(s.category||'全部分类')}</strong>`}</span><span class="${scoped&&tab!=='sales'?'scope-warning':''}">${tab==='sales'?'销量来自履约单品明细':tab==='audit'?'未匹配记录保留，支持导出':tab==='sources'?'源文件不包含在网页下载包中':'库存快照 '+escape(D.inventory[0]?.asOf||'未提供')+' · API同步 '+escape(D.inventory[0]?.syncedAt||'未提供')}</span>`;
}
function render(){const t=TABS[tab];document.documentElement.style.setProperty('--accent',t.accent);document.documentElement.style.setProperty('--accent-soft',t.soft);$('#breadcrumb').textContent=t.title;$('#page-title').textContent=t.title;$('#eyebrow').textContent=t.en;$('#page-description').textContent=t.desc;$('#reset-filters').innerHTML=icon('reset')+'重置筛选';$('#export').innerHTML=icon('download')+(tab==='sources'?'导出来源清单':'导出数据');$('#navigation').innerHTML=Object.entries(TABS).map(([k,v],i)=>(i===4?'<div class="nav-divider"></div>':'')+`<button class="nav-item ${k===tab?'active':''}" data-nav="${k}" title="${v.title}" ${k===tab?'aria-current="page"':''}>${icon(k)}<span class="nav-text">${v.title}</span>${k==='audit'?`<span class="nav-count">${fmt(D.listings.filter(r=>!Object.keys(r.components).length).length)}</span>`:''}</button>`).join('');renderFilters();updateContent();}
function navigate(next){if(!TABS[next])return;tab=next;if(location.hash.slice(1)!==tab)history.replaceState(null,'','#'+tab);render();}
function showToast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3600);}
function exportData(context='main'){const registered=tableViews.get(context),rows=registered?.rows||(context==='main'?visibleRows:[]),columns=[...(registered?.columns||(context==='main'?visibleColumns:[]))];if(!rows.length){showToast('当前筛选下没有可导出的记录');return;}if(columns.some(c=>c.key==='sku')&&!columns.some(c=>c.key==='name'))columns.splice(1,0,{key:'name',label:'产品名称',value:r=>r.name||product(r.sku).name});
  const csvValue=v=>{if(v==null)return '""';if(Array.isArray(v))v=v.join(' / ');if(typeof v==='string'&&/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+String(v).replace(/"/g,'""')+'"';};
  const csv='\ufeff'+[columns.map(c=>csvValue(c.exportLabel||c.label)).join(','),...rows.map(r=>columns.map(c=>csvValue(c.value?c.value(r):r[c.key])).join(','))].join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;const name=context==='summary'?registered.title:`${TABS[tab].title}_${state().view||'明细'}`;a.download=`${name.replace(/[\\/:*?"<>|]/g,'_')}_${D.meta.exportDate}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);showToast(`已导出 ${fmt(rows.length)} 条${context==='summary'?'本项明细':'筛选结果'}，包含全部分页`);
}
function showDetail(sku){const p=product(sku),stock=D.inventory.filter(r=>r.sku===sku),links=D.listings.filter(r=>r.components[sku]),orders=D.orders.filter(r=>r.sku===sku&&r.status==='已发货');$('#modal-title').textContent=sku;$('#modal-body').innerHTML=`<div class="detail-grid">${[['产品名称',p.name],['SPU',p.spu],['SKC',p.skc],['产品分类',p.category],['颜色',p.color],['尺码',p.size],['产品状态',p.productStatus],['采购状态',p.purchaseStatus]].map(([label,value])=>`<div><label>${label}</label><span>${escape(value||'未提供')}</span></div>`).join('')}</div><div class="banner">${icon('info')}详情展示该 SKU 的全部源数据，包含全部渠道和日期。已发货销量 ${fmt(sum(orders,'qty'))} 件。</div><section class="modal-section"><h3>库存库龄</h3>${stock.length?`<div class="table-scroll"><table><thead><tr><th>仓库</th>${D.meta.ageLabels.map(k=>`<th>${k}</th>`).join('')}<th>生成日期</th></tr></thead><tbody>${stock.map(r=>`<tr><td>${escape(r.warehouse)}</td>${r.ages.map(n=>`<td>${fmt(n)}</td>`).join('')}<td>${escape(r.asOf)}</td></tr>`).join('')}</tbody></table></div>`:empty('本次库龄快照未提供该 SKU','未提供库存不等于真实零库存')}</section><section class="modal-section"><h3>商品刊登记录 · ${fmt(links.length)} 条</h3>${links.length?`<div class="table-scroll"><table><thead><tr><th>平台 / 店铺</th><th>原始平台 SKU</th><th>类型 / 状态</th><th>匹配依据</th><th>源表行号</th></tr></thead><tbody>${links.map(r=>`<tr><td>${escape(r.platform)} / ${escape(r.shop)}</td><td title="${escape(r.platformSKU)}">${escape(r.platformSKU)}</td><td>${escape(r.kind)} ${badge(r.status)}</td><td>${escape(r.methods.join(' / '))}</td><td>${escape(r.sourceRows.join(' / '))}</td></tr>`).join('')}</tbody></table></div>`:empty('当前商品快照中未查到匹配刊登','可前往 SKU 匹配校验检查未匹配的商品记录')}</section>`;$('#detail-modal').showModal();}
function setFont(value){font=['small','medium','large'].includes(value)?value:'medium';document.documentElement.className='font-'+font;document.body.className='font-'+font;$$('[data-font]').forEach(b=>{b.classList.toggle('selected',b.dataset.font===font);b.setAttribute('aria-pressed',b.dataset.font===font?'true':'false');});try{localStorage.setItem('apparel-font',font);}catch{}}
function closeSummary(){const key=state().summary;state().summary=null;updateContent();const card=$(`[data-summary="${key}"]`);card?.focus({preventScroll:true});card?.scrollIntoView({block:'nearest'});}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;const context=b.closest('[data-table]')?.dataset.table||'main';
  if(b.dataset.summary!==undefined){const s=state();if(s.summary===b.dataset.summary){closeSummary();return;}s.summary=b.dataset.summary;s.summaryView='';s.summaryTable={page:1,pageSize:s.summaryTable?.pageSize||12,sort:'',sortDir:-1};updateContent();$('#summary-detail')?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});$(`[data-summary="${s.summary}"]`)?.focus({preventScroll:true});return;}
  if(b.dataset.summaryView){state().summaryView=b.dataset.summaryView;Object.assign(tableState('summary'),{page:1,sort:'',sortDir:-1});updateContent();return;}
  if(b.dataset.action==='close-summary'){closeSummary();return;}
  if(b.dataset.nav)navigate(b.dataset.nav);if(b.dataset.font)setFont(b.dataset.font);if(b.dataset.sku)showDetail(b.dataset.sku);
  if(b.dataset.sort){const s=tableState(context);s.sortDir=s.sort===b.dataset.sort?-s.sortDir:1;s.sort=b.dataset.sort;s.page=1;updateContent();}
  if(b.dataset.view){Object.assign(state(),{view:b.dataset.view,page:1,sort:''});updateContent();}
  if(b.dataset.action==='export')exportData(context);
  if(['prev','next'].includes(b.dataset.action)){tableState(context).page+=b.dataset.action==='next'?1:-1;updateContent();}
});
$('#filters').addEventListener('change',e=>{const key=e.target.dataset.filter;if(!key||key==='search')return;const s=state();s[key]=e.target.value;s.page=1;if(s.summaryTable)s.summaryTable.page=1;if(key==='platform'){s.shop='';s.site='';}if(key==='shop')s.site='';if(key==='platform'||key==='shop')renderFilters();updateContent();});
let searchTimer;$('#filters').addEventListener('input',e=>{if(e.target.dataset.filter!=='search')return;clearTimeout(searchTimer);const value=e.target.value;const current=tab;searchTimer=setTimeout(()=>{if(tab!==current)return;state().search=value;state().page=1;if(state().summaryTable)state().summaryTable.page=1;updateContent();},180);});
document.addEventListener('change',e=>{if(e.target.dataset.action==='page-size'){const s=tableState(e.target.closest('[data-table]')?.dataset.table);s.pageSize=Number(e.target.value);s.page=1;updateContent();}});
$('#reset-filters').onclick=()=>{clearTimeout(searchTimer);states[tab]=defaults(tab);renderFilters();updateContent();showToast('已重置当前板块筛选');};$('#export').onclick=()=>exportData();$('#close-modal').onclick=()=>$('#detail-modal').close();$('#detail-modal').addEventListener('click',e=>{if(e.target===$('#detail-modal'))$('#detail-modal').close();});window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
$('#snapshot-date').textContent=D.meta.exportDate.replaceAll('-',' . ');$('#footer-info').textContent='文件快照 '+D.meta.exportDate+' · 订单 / 库存 / 刊登 / 产品 / 销售代码';setFont(font);render();
// Read-only diagnostics for data reconciliation and reproducible browser checks.
window.apparelDashboard={data:D,coverage,orderRows,inventoryBySKU,salesBySKU,defaults,navigate,getState:()=>({...state()}),getSummaryData:summaryData};
})();

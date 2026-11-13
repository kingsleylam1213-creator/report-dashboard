'use strict';
((root)=>{
const labels=['0-90天','91-180天','181-270天','271-365天','365天以上'];
const thresholds=['','91天及以上','181天及以上','271天及以上','365天以上'];
const valid=r=>!!r&&Array.isArray(r.ages)&&r.ages.length===5&&r.ages.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0);
const sum=a=>a.reduce((s,n)=>s+n,0), key=r=>JSON.stringify([r.warehouse,r.owner,r.sku]);
const total=r=>valid(r)?sum(r.ages):null;
const add=values=>values.some(n=>n===null||n===undefined)?null:sum(values);
function metrics(rows){const ages=labels.map((_,i)=>add(rows.map(r=>valid(r)?r.ages[i]:null)));return {ages,qty:add(rows.map(total)),old:add(rows.map(r=>valid(r)?sum(r.ages.slice(2)):null)),over365:add(rows.map(r=>valid(r)?r.ages[4]:null)),oldSKUs:new Set(rows.filter(r=>valid(r)&&sum(r.ages.slice(2))>0).map(r=>r.sku)).size,stockSKUs:new Set(rows.filter(r=>valid(r)&&total(r)>0).map(r=>r.sku)).size,invalid:rows.filter(r=>!valid(r)).length};}
function compare(before,after){
  const b=new Map((before?.rows||[]).map(r=>[key(r),r])),a=new Map((after?.rows||[]).map(r=>[key(r),r]));
  return [...new Set([...b.keys(),...a.keys()])].map(k=>{
    const prev=b.get(k),now=a.get(k),r=now||prev,both=valid(prev)&&valid(now),chronological=both&&!!prev.asOf&&!!now.asOf&&now.asOf>prev.asOf;
    const levels=[];
    if(chronological){for(let i=1;i<5;i++){
      const x=sum(prev.ages.slice(i)),y=sum(now.ages.slice(i)),lo=sum(prev.ages.slice(0,i)),hi=sum(now.ages.slice(0,i));
      if(y>x){let kind='increase';if(x===0&&total(prev)>0)kind='first';else if(lo>hi&&lo>0)kind='roll';levels.push({index:i,label:thresholds[i],kind,before:x,after:y,delta:y-x});}
    }}
    let state=!before?'baseline':!prev?'new':!now?'missing':!both?'invalid':!prev.asOf||!now.asOf?'undated':now.asOf===prev.asOf?'revision':now.asOf<prev.asOf?'reversed':'comparable';
    return {...r,key:k,before:prev||null,after:now||null,both,chronological,state,levels,changed:!!before&&(!prev||!now||!both||now.ages.some((n,i)=>n!==prev.ages[i]))};
  });
}
function group(records,level='sku',threshold=2){
  const groups=new Map();
  for(const r of records){const id=level==='spu'?(r.spu||'未提供SPU:'+r.sku):r.sku;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);}
  return [...groups].map(([id,items])=>{
    const first=items.find(r=>r.after)||items[0],before=items.filter(r=>r.before).map(r=>r.before),after=items.filter(r=>r.after).map(r=>r.after),complete=items.every(r=>r.both);
    const bm=before.length?metrics(before):null,am=after.length?metrics(after):null;
    const delta=(x,y)=>complete&&x!==null&&y!==null?y-x:null;
    const signals=items.flatMap(r=>r.levels.filter(l=>l.index>=threshold).map(l=>({...l,sku:r.sku,warehouse:r.warehouse,owner:r.owner})));
    const upgrades=signals.filter(l=>l.kind!=='increase'),increases=signals.filter(l=>l.kind==='increase');
    const warnings=[...new Set(upgrades.map(l=>(l.kind==='first'?'首次出现':'疑似滚入')+l.label))];
    const kinds=new Set(items.map(r=>r.state));
    let state=kinds.size===1?[...kinds][0]:(!complete?'partial':'comparable');
    const stateLabels={baseline:'首期基准',new:'新增记录',missing:'本期未出现',invalid:'库龄缺失或异常',undated:'库龄日期未提供',revision:'同日修订',reversed:'日期倒序',partial:'部分记录不可比',comparable:'两期可比'};
    const warningText=warnings.join('；')||(increases.length?'高库龄数量增加（原因待核对）':stateLabels[state]);
    return {id,sku:first.sku,spu:level==='spu'?id:first.spu,skuText:[...new Set(items.map(r=>r.sku))].join(' / '),name:first.name,category:first.category,color:first.color,size:first.size,
      warehouses:[...new Set(items.map(r=>r.warehouse))],owners:[...new Set(items.map(r=>r.owner))],beforeQty:bm?.qty??null,afterQty:am?.qty??null,deltaQty:delta(bm?.qty??null,am?.qty??null),
      beforeOld:bm?.old??null,afterOld:am?.old??null,deltaOld:delta(bm?.old??null,am?.old??null),before365:bm?.over365??null,after365:am?.over365??null,delta365:delta(bm?.over365??null,am?.over365??null),
      beforeAges:bm?.ages||[null,null,null,null,null],afterAges:am?.ages||[null,null,null,null,null],deltaAges:labels.map((_,i)=>delta(bm?.ages[i]??null,am?.ages[i]??null)),
      changed:items.some(r=>r.changed),isUpgrade:upgrades.length>0,hasIncrease:increases.length>0,state,stateLabel:stateLabels[state],warningText,signals,
      evidence:signals.map(l=>`${l.warehouse} / ${l.sku}：${l.label} ${l.before} → ${l.after}（+${l.delta}）`).join('；')};
  });
}
function defaultBaseline(snapshots,current){return [...snapshots].filter(s=>s.id!==current?.id&&s.asOfEnd&&current?.asOfStart&&s.asOfEnd<current.asOfStart).sort((a,b)=>b.asOfEnd.localeCompare(a.asOfEnd)||b.capturedAt.localeCompare(a.capturedAt))[0]||null;}
const api={labels,thresholds,valid,key,total,metrics,compare,group,defaultBaseline};
root.InventoryHistory=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

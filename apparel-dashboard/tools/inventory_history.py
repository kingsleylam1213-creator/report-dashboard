"""Immutable normalized inventory snapshots. No raw Excel or buyer fields."""
import collections, datetime, hashlib, json, math, pathlib, re, unicodedata
from prepare_data import clean, read_file

AGE=['0-90天','91-180天','181-270天','271-365天','365天以上']
HISTORY_PATH='history/inventory-age'
def number(value):
    try: n=float(value) if value is not None and value!='' else None
    except (TypeError,ValueError): return None
    return n if n is not None and math.isfinite(n) else None
def date(value):
    value=clean(value)[:10].replace('/','-')
    try: return datetime.date.fromisoformat(value).isoformat()
    except ValueError: return ''
def key(row): return (row['warehouse'],row['owner'],row['sku'])
def canonical(rows):
    # Labels and filenames are not business changes; dates and quantities are.
    return sorted([{'sku':r['sku'],'warehouse':r['warehouse'],'owner':r['owner'],'ages':r['ages'],'asOf':r['asOf']} for r in rows],key=key)
def fingerprint(rows):
    return hashlib.sha256(json.dumps(canonical(rows),ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def validate(snapshot):
    if snapshot.get('schemaVersion')!=1 or not re.fullmatch('[0-9a-f]{64}',snapshot.get('id','')): raise ValueError('库龄快照格式错误')
    rows=snapshot.get('rows',[])
    if not isinstance(rows,list): raise ValueError('库龄快照明细格式错误')
    for r in rows:
        if not all(isinstance(r.get(k),str) for k in ['sku','warehouse','owner','asOf']): raise ValueError('库龄快照标识缺失')
        if len(r.get('ages',[]))!=5 or any(v is not None and (not isinstance(v,(int,float)) or not math.isfinite(v)) for v in r['ages']): raise ValueError('库龄区间格式错误')
    if len({key(r) for r in rows})!=len(rows) or fingerprint(rows)!=snapshot['id']: raise ValueError('库龄快照校验失败，不覆盖历史')
    return snapshot
def atomic_write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_bytes(value);temp.replace(path)
def snapshot_from_rows(rows,source,products):
    groups={}
    for raw in rows:
        k=(clean(raw.get('warehouse')),clean(raw.get('owner')),clean(raw.get('sku')))
        if not k[2]: continue
        if k not in groups:
            p=products.get(k[2],{})
            groups[k]={'warehouse':k[0],'owner':k[1],'sku':k[2],'ages':[0]*5,'asOf':'','dates':set(),'goodsCodes':set(),**{f:clean(p.get(f)) for f in ['name','category','color','size','spu','skc']}}
        g=groups[k];ds=date(raw.get('asOf'))
        if ds:g['dates'].add(ds)
        g['goodsCodes'].add(clean(raw.get('goodsCode')))
        for i,v in enumerate(raw['ages']):
            v=number(v)
            g['ages'][i]=None if v is None or g['ages'][i] is None else g['ages'][i]+v
    for g in groups.values():
        # Mixed generation dates for a key are preserved as unknown for aging inference.
        g['asOf']=next(iter(g['dates'])) if len(g['dates'])==1 else ''
        g['asOfDates']=sorted(g.pop('dates'));g['goodsCodes']=sorted(g['goodsCodes'])
        g['qty']=sum(g['ages']) if all(v is not None for v in g['ages']) else None
    records=sorted(groups.values(),key=key)
    dates=sorted({x for r in records for x in r['asOfDates']})
    return {'schemaVersion':1,'id':fingerprint(records),'source':source,'capturedAt':datetime.datetime.now().isoformat(timespec='seconds'),
            'asOfStart':dates[0] if dates else '', 'asOfEnd':dates[-1] if dates else '', 'rows':records}
def normalize_older(rows,products):
    index=collections.defaultdict(list)
    norm=lambda v:unicodedata.normalize('NFKC',clean(v)).upper()
    for sku in products:index[norm(sku)].append(sku)
    result=[]
    for r in rows:
        original=clean(r.get('产品SKU'));candidates=index.get(norm(original),[])
        result.append({'sku':candidates[0] if len(candidates)==1 else original,'warehouse':clean(r.get('仓库名称')),'owner':clean(r.get('货主')),'goodsCode':clean(r.get('货物编码')),'ages':[number(r.get(k)) for k in AGE],'asOf':clean(r.get('生成库龄时间'))})
    return result
def archive_inventory(app,data):
    app=pathlib.Path(app);directory=app/HISTORY_PATH;directory.mkdir(parents=True,exist_ok=True)
    existing={}
    for path in directory.glob('*.json'):
        if path.name=='index.json':continue
        snapshot=validate(json.loads(path.read_text(encoding='utf-8')))
        if path.stem!=snapshot['id']:raise ValueError('库龄历史文件名不符合内容标识')
        existing[snapshot['id']]=snapshot
    products={p['sku']:p for p in data['products']}
    current=snapshot_from_rows(data['inventory'],data['meta']['sources']['inventory'],products)
    candidates=[]
    for path in sorted((app.parent/'库龄管理').glob('*.xlsx'),key=lambda p:p.stat().st_mtime):
        if path.name.startswith('~$') or path.name==current['source']:continue
        sheets=read_file(path)
        candidates.append(snapshot_from_rows(normalize_older(next(iter(sheets.values())),products),path.name,products))
    candidates.append(current)
    for snapshot in candidates:
        validate(snapshot)
        if snapshot['id'] in existing:continue
        atomic_write(directory/(snapshot['id']+'.json'),json.dumps(snapshot,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode())
        existing[snapshot['id']]=snapshot
    snapshots=sorted(existing.values(),key=lambda s:(s['asOfEnd'],s['asOfStart'],s['capturedAt'],s['id']))
    entries=[]
    for s in snapshots:
        content=(directory/(s['id']+'.json')).read_bytes()
        git_sha=hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()
        entries.append({k:s[k] for k in ['id','source','asOfStart','asOfEnd','capturedAt']}|{'sha256':hashlib.sha256(content).hexdigest(),'gitSha':git_sha,'records':len(s['rows'])})
    atomic_write(directory/'index.json',json.dumps({'schemaVersion':1,'snapshots':entries},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
    return {'schemaVersion':1,'currentId':current['id'],'snapshots':snapshots}

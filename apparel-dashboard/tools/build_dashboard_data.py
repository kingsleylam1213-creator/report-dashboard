"""Product-master matching. Never strip or blindly split SKU hyphens."""
import collections, datetime, json, pathlib, unicodedata, re
from prepare_data import clean, read

APP=pathlib.Path(__file__).resolve().parents[1]
AGE=['0-90天','91-180天','181-270天','271-365天','365天以上']

def norm(v): return unicodedata.normalize('NFKC',clean(v)).upper()
def platform(v):
    x=norm(v)
    return {'TIKTOK':'TIKTOK SHOP','WALMART':'Walmart','SHEIN':'SHEIN','TEMU半托管':'TEMU'}.get(x,x)
def num(v):
    if v is None or v=='': return None
    return float(v)

def build(raw, names):
    products={}; combos=collections.defaultdict(dict); index=collections.defaultdict(set)
    for r in raw['products']['单品']:
        sku=clean(r.get('SKU*'))
        if not sku: continue
        p={k:clean(r.get(v)) for k,v in {'sku':'SKU*','spu':'SPU编码*','skc':'SKC编码','category':'产品分类*','name':'产品名称（中文）*','color':'颜色','size':'尺码','productStatus':'产品状态','purchaseStatus':'采购状态','brand':'品牌'}.items()}
        products[sku]=p; index[norm(sku)].add(sku)
    for r in raw['products']['组合SKU']:
        key=clean(r.get('组合SKU编码*')); sku=clean(r.get('包含的SKU*'))
        q=num(r.get('数量*'))
        if key and sku and q is not None:
            combos[key][sku]=q; index[norm(key)].add(key)
    compact=collections.defaultdict(set)
    for k in products: compact[norm(k).replace('-','')].add(k)
    derived={}
    def expand(key): return dict(combos[key]) if key in combos else dict(derived[key]) if key in derived else {key:1}
    def resolve_part(token):
        n=norm(token)
        keys=index.get(n,set())
        if not keys: keys=compact.get(n.replace('-',''),set())
        return next(iter(keys)) if len(keys)==1 else ''
    def expression(text):
        if not any(c in text for c in '/*+'): return None
        parts=re.split(r'[/+]',text); result=collections.Counter(); first=''
        for part in parts:
            m=re.fullmatch(r'(.+?)(?:\*(\d+))?',part)
            if not m: return None
            token=m[1]; q=int(m[2] or 1)
            if q<=0: return None
            key=resolve_part(token)
            if not key and first:
                variants=set()
                for cut in range(1,len(first)):
                    candidate=resolve_part(first[:cut]+token)
                    if candidate in products and products[candidate]['spu']==products[first]['spu']:
                        variants.add(candidate)
                if len(variants)==1: key=next(iter(variants))
            if not key or key not in products: return None
            if not first: first=key
            result[key]+=q
        return dict(result)
    def match(value, bounded=False):
        text=norm(value)
        if text in index:
            keys=sorted(index[text])
            return (keys[0], '精确匹配',keys) if len(keys)==1 else ('','大小写冲突',keys)
        if not bounded or not text: return '', '未匹配', []
        starts=[0]+[i+1 for i,c in enumerate(text) if c=='-']
        ends=[i for i,c in enumerate(text) if c=='-']+[len(text)]
        spans=[(a,b,text[a:b]) for a in starts for b in ends if b>a]
        expressions=[(a,b,x,expression(x)) for a,b,x in spans if any(c in x for c in '/*+')]
        expressions=[x for x in expressions if x[3]]
        if expressions:
            best=max(b-a for a,b,_,_ in expressions)
            found=[x for x in expressions if x[1]-x[0]==best]
            signatures={json.dumps(x[3],sort_keys=True) for x in found}
            if len(signatures)==1:
                key='派生组合:'+found[0][2]; derived[key]=found[0][3]
                return key,'组合表达式（已确认规则）',list(found[0][3])
            return '', '多候选待确认', sorted({k for x in found for k in x[3]})
        # Never partially map an expression containing unknown components.
        if any(c in text for c in '/+'):
            return '', '组合成分待确认', []
        hits=[(a,b,k) for a,b,x in spans for k in index.get(x,[])]
        # An exact larger product key supersedes only substrings wholly inside it.
        hits=[h for h in hits if not any(g[0]<=h[0] and g[1]>=h[1] and g[1]-g[0]>h[1]-h[0] for g in hits)]
        keys=sorted(set(h[2] for h in hits))
        if keys: return (keys[0],'边界完整匹配',keys) if len(keys)==1 else ('','多候选待确认',keys)
        hits=[(a,b,k) for a,b,x in spans for k in compact.get(x.replace('-',''),[])]
        hits=[h for h in hits if not any(g[0]<=h[0] and g[1]>=h[1] and g[1]-g[0]>h[1]-h[0] for g in hits)]
        keys=sorted(set(h[2] for h in hits))
        return (keys[0],'内部连接符唯一补配（已确认）',keys) if len(keys)==1 else ('','多候选待确认' if keys else '未匹配',keys)
    def suggest(value):
        text=norm(value)
        starts=[0]+[i+1 for i,c in enumerate(text) if c in '-/+*']
        ends=[i for i,c in enumerate(text) if c in '-/+*']+[len(text)]
        return sorted({k for a in starts for b in ends if b>a for k in (index.get(text[a:b],set())|compact.get(text[a:b].replace('-',''),set())) if k in products})
    codes=[]
    for r in raw['salesCodes']['Sheet1']:
        codes.append({k:clean(r.get(v)) for k,v in {'shop':'店铺简称','site':'站点','category':'入驻产品','seller':'销售人员','code':'销售代码','business':'业务单元'}.items()} | {'platform':platform(r.get('平台'))})
    def channel(r, shopfield):
        p=platform(r.get('平台')); shop=clean(r.get(shopfield)); site=clean(r.get('站点'))
        candidates=[c for c in codes if c['platform']==p and c['shop']==shop]
        sites=set(c['site'] for c in candidates if c['site'])
        inferred=not site and len(sites)==1
        if inferred: site=next(iter(sites))
        return {'platform':p,'shop':shop,'site':site or '未提供','siteSource':'销售代码表唯一站点' if inferred else '源文件' if site else '未提供'}
    listings={}; issues=[]; matchCounts=collections.Counter(); originalCount=0
    for sheet, rows in raw['listings'].items():
        isCombo=sheet=='组合商品'
        for rownum,r in enumerate(rows,2):
            originalCount+=1
            ch=channel(r,'店铺名称'); ps=clean(r.get('平台SKU')); pid=clean(r.get('子ASIN/Item Number/平台SKU ID'))
            lid='|'.join([ch['platform'],ch['shop'],ch['site'],pid,ps])
            explicit=clean(r.get('包含产品SKU' if isCombo else '产品SKU'))
            key,method,candidates=match(explicit if explicit else ps,not explicit)
            comp=expand(key) if key else {}
            if isCombo and key:
                component_qty=num(r.get('产品sku数量'))
                if component_qty is None or component_qty<=0:
                    key='';method='组合用量待确认';comp={}
                else:
                    comp={sku:q*component_qty for sku,q in comp.items()}
            bad=[s for s in comp if s not in products]
            if bad: key=''; method='组合成分未建档'; candidates=bad; comp={}
            if not key:
                candidates=sorted(set(candidates)|set(suggest(ps)))
                issues.append({'source':'商品刊登','sheet':sheet,'row':rownum,'platformSKU':ps,'explicitSKU':explicit,'method':method,'candidates':candidates,'name':clean(r.get('商品名称')),**ch})
            matchCounts[method]+=1
            if lid not in listings:
                listings[lid]={'id':lid,**ch,'platformSKU':ps,'itemId':pid,'parentId':clean(r.get('父ASIN/平台SPU ID')),'title':clean(r.get('商品名称')),'status':clean(r.get('商品状态')),'listedAt':clean(r.get('上架时间'))[:10],'price':num(r.get('售价')),'components':{},'candidates':[],'kind':'组合' if isCombo or key in combos or key in derived or re.search(r'\*[2-9]',ps) else '单品','methods':[],'sourceRows':[]}
            target=listings[lid]
            for sku,q in comp.items(): target['components'][sku]=q
            if method not in target['methods']: target['methods'].append(method)
            if not key: target['candidates']=sorted(set(target['candidates'])|set(candidates))
            target['sourceRows'].append(f'{sheet}!{rownum}')
    inventory=[]
    for rownum,r in enumerate(next(iter(raw['inventory'].values())),2):
        key,method,candidates=match(r.get('产品SKU'))
        ages=[num(r.get(k)) for k in AGE]
        if not key or key in combos:
            issues.append({'source':'库存','row':rownum,'explicitSKU':clean(r.get('产品SKU')),'method':method,'candidates':candidates})
        inventory.append({'sku':key or clean(r.get('产品SKU')),'matched':key in products,'warehouse':clean(r.get('仓库名称')),'goodsCode':clean(r.get('货物编码')),'owner':clean(r.get('货主')),'category':clean(r.get('一级品类'))+'/'+clean(r.get('二级品类')),'ages':ages,'qty':sum(ages) if all(v is not None for v in ages) else None,'asOf':clean(r.get('生成库龄时间')),'syncedAt':clean(r.get('API同步时间')),'sourceRow':rownum})
    orders=[]
    for rownum,r in enumerate(next(iter(raw['orders'].values())),2):
        key,method,candidates=match(r.get('对应的单品sku'))
        if key not in products:
            issues.append({'source':'订单','row':rownum,'explicitSKU':clean(r.get('对应的单品sku')),'method':method,'candidates':candidates})
        # Export is already exploded to individual SKU quantity; DO NOT multiply again.
        orders.append({'sku':key or clean(r.get('对应的单品sku')),'matched':key in products,**channel(r,'店铺'),'orderId':clean(r.get('平台订单号')),'fulfillmentId':clean(r.get('履约单号')),'lineId':clean(r.get('LineItemId')),'platformSKU':clean(r.get('平台SKU')),'qty':num(r.get('对应单品sku数量')),'status':clean(r.get('履约单状态')),'createdAt':clean(r.get('创建日期'))[:10],'paidAt':clean(r.get('付款时间'))[:10],'shippedAt':clean(r.get('发货时间'))[:10],'warehouse':clean(r.get('发货仓')),'seller':clean(r.get('销售')),'sourceRow':rownum})
    file_dates=[m.group(0) for name in names.values() for m in re.finditer(r'20\d{6}',name)]
    export_date=datetime.datetime.strptime(max(file_dates),'%Y%m%d').date().isoformat() if file_dates else datetime.date.today().isoformat()
    meta={'title':'服饰经营数据看板','exportDate':export_date,'generatedAt':datetime.datetime.now().isoformat(timespec='seconds'),'sources':names,'counts':{'products':len(products),'combos':len(combos),'listingRows':originalCount,'listings':len(listings),'inventoryRows':len(inventory),'orderRows':len(orders),'salesCodeRows':len(codes)},'matchCounts':dict(matchCounts),'ageLabels':AGE}
    return {'meta':meta,'products':list(products.values()),'listings':list(listings.values()),'inventory':inventory,'orders':orders,'issues':issues,'salesCodes':codes}

if __name__=='__main__':
    raw={}; names={}
    cache=APP/'data/raw.json'
    import sys
    if '--cached' in sys.argv and cache.exists():
        raw=json.loads(cache.read_text(encoding='utf-8'))
        folders={'products':'产品管理','listings':'商品管理','inventory':'库龄管理','orders':'新版履约单管理','salesCodes':'销售代码'}
        for k,v in folders.items(): names[k]=max((APP.parent/v).glob('*.xlsx'),key=lambda p:p.stat().st_mtime).name
    else:
        for k,v in [('products','产品管理'),('listings','商品管理'),('inventory','库龄管理'),('orders','新版履约单管理'),('salesCodes','销售代码')]: raw[k],names[k]=read(v)
    d=build(raw,names)
    (APP/'dist').mkdir(exist_ok=True)
    (APP/'dist/data.js').write_text('window.DASHBOARD_DATA='+json.dumps(d,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    (APP/'data').mkdir(exist_ok=True)
    (APP/'data/normalized.json').write_text(json.dumps(d,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'meta':d['meta'],'issues':dict(collections.Counter(x['source']+':'+x['method'] for x in d['issues'])),'ambiguous':[x for x in d['issues'] if x['method']=='多候选待确认'][:12]},ensure_ascii=False,indent=2))

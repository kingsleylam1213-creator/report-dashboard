"""Read ERP exports without trusting Excel's incorrect worksheet dimensions."""
import collections, datetime, json, pathlib, re, warnings, unicodedata
import openpyxl

warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')
ROOT = pathlib.Path(__file__).resolve().parents[2]
APP = ROOT / 'apparel-dashboard'

def read(folder):
    if folder == '新版履约单管理':
        sheets, name, _ = read_orders()
        return sheets, name
    files = sorted((p for p in (ROOT / folder).glob('*.xlsx') if not p.name.startswith('~$')), key=lambda p: p.stat().st_mtime)
    p = files[-1]
    return read_file(p), p.name

def read_orders(folder=None):
    """Union incremental exports. Only unambiguous business lines replace older rows."""
    folder = pathlib.Path(folder) if folder is not None else ROOT / '新版履约单管理'
    files = sorted((p for p in folder.glob('*.xlsx') if not p.name.startswith('~$')),
                   key=lambda p: (p.stat().st_mtime_ns, p.name))
    if not files:
        raise ValueError('未找到履约订单 Excel：' + str(folder))
    fields = ['平台','店铺','平台订单号','履约单号','LineItemId','平台SKU','产品SKU','对应的单品sku']
    def identity(row):
        values = [unicodedata.normalize('NFKC', clean(row.get(k))).upper() for k in fields]
        values[0] = {'TIKTOK':'TIKTOK SHOP','TEMU半托管':'TEMU'}.get(values[0], values[0])
        # A missing line identifier is not evidence that two rows are the same item.
        if any(values[i] in ('', '0', '-') for i in [0,1,2,3,4,5,7]):
            return None
        return tuple(values)
    merged = {}; unidentified = []; reports = []; replaced = 0
    for path in files:
        groups = collections.defaultdict(list); rows = []
        for sheet, source in read_file(path).items():
            if source and not {'履约单号','对应的单品sku','对应单品sku数量'}.issubset(source[0]):
                raise ValueError(f'订单表字段不完整：{path.name} / {sheet}，停止构建以免漏数。')
            for rownum, row in enumerate(source, 2):
                row = dict(row, _sourceFile=path.name, _sourceSheet=sheet, _sourceRow=rownum)
                rows.append(row)
                key = identity(row)
                if key is None:
                    unidentified.append(row)
                else:
                    groups[key].append(row)
        for key, group in groups.items():
            if key in merged:
                old = merged[key]
                if len(old) != 1 or len(group) != 1:
                    raise ValueError(f'订单跨文件存在非唯一明细，无法安全去重：{old[0]["_sourceFile"]} 行 {old[0]["_sourceRow"]} 与 {path.name} 行 {group[0]["_sourceRow"]}，请核对。')
                # Same modification time cannot establish which conflicting version is newer.
                previous = next(p for p in files if p.name == old[0]['_sourceFile'])
                content = lambda r: {k:v for k,v in r.items() if not str(k).startswith('_source')}
                if path.stat().st_mtime_ns == previous.stat().st_mtime_ns and content(old[0]) != content(group[0]):
                    raise ValueError('重叠订单存在同修改时间的不同版本，请确认：' + path.name)
                replaced += 1
            merged[key] = group
        def date_range(field):
            dates = sorted(clean(r.get(field))[:10] for r in rows if r.get(field))
            return {'min':dates[0] if dates else '', 'max':dates[-1] if dates else '',
                    'missing':sum(not r.get(field) for r in rows)}
        reports.append({'file':path.name,'inputRows':len(rows),'modifiedAt':datetime.datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec='seconds'),
                        'dateRanges':{f:date_range(f) for f in ['创建日期','付款时间','发货时间']}})
    rows = [r for group in merged.values() for r in group] + unidentified
    retained = collections.Counter(r['_sourceFile'] for r in rows)
    for report in reports:
        report['retainedRows'] = retained[report['file']]
    report = {'files':reports,'inputRows':sum(r['inputRows'] for r in reports),
              'retainedRows':len(rows),'replacedRows':replaced,'unidentifiedRows':len(unidentified),
              'rule':'合并全部订单文件；同一唯一业务明细取修改时间较新的版本；缺少标识不猜测去重；跨文件非唯一重叠停止构建。'}
    return {'合并订单':rows}, ' / '.join(p.name for p in files), report

def read_file(p):
    w = openpyxl.load_workbook(p, read_only=True, data_only=True)
    result = {}
    for s in w:
        s.reset_dimensions()
        it = iter(s.values)
        header = next(it, ())
        result[s.title] = [dict(zip(header, row)) for row in it if any(v is not None and v != '' for v in row)]
    w.close()
    return result

def clean(v):
    return '' if v is None else str(v).strip()

def count(rows, field):
    return dict(collections.Counter(clean(r.get(field)) for r in rows))

if __name__ == '__main__':
    raw = {}; names = {}
    for key, folder in [('products','产品管理'),('listings','商品管理'),('inventory','库龄管理'),('orders','新版履约单管理'),('salesCodes','销售代码')]:
        raw[key], names[key] = read(folder)
    (APP/'data').mkdir(exist_ok=True)
    (APP/'data'/'raw.json').write_text(json.dumps(raw,ensure_ascii=False,default=str),encoding='utf-8')
    profile = {}
    fields = {
      'products':['产品分类*','产品特性','尺码','产品状态'],
      'listings':['平台','店铺名称','站点','商品状态','业务单元','分类代码','产品SKU'],
      'inventory':['仓库名称','一级品类','二级品类','生成库龄时间','API同步时间'],
      'orders':['平台','店铺','站点','履约单状态','核算分类','币种'],
    }
    for key, sheets in raw.items():
        profile[key]={}
        for sheet, rows in sheets.items():
            profile[key][sheet]={'count':len(rows),'fields':{f:count(rows,f) for f in fields.get(key,[]) if f!='产品SKU'}}
            if key=='listings':
                profile[key][sheet]['blankProductSKU']=sum(not clean(r.get('产品SKU' if sheet=='单品商品' else '包含产品SKU')) for r in rows)
                profile[key][sheet]['blankExamples']=[clean(r.get('平台SKU')) for r in rows if not clean(r.get('产品SKU' if sheet=='单品商品' else '包含产品SKU'))][:20]
    (APP/'data'/'profile.json').write_text(json.dumps(profile,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(profile,ensure_ascii=False,indent=2))

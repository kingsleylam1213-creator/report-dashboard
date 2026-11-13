"""Read ERP exports without trusting Excel's incorrect worksheet dimensions."""
import collections, datetime, json, pathlib, re, warnings
import openpyxl

warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')
ROOT = pathlib.Path(__file__).resolve().parents[2]
APP = ROOT / 'apparel-dashboard'

def read(folder):
    files = sorted((p for p in (ROOT / folder).glob('*.xlsx') if not p.name.startswith('~$')), key=lambda p: p.stat().st_mtime)
    p = files[-1]
    w = openpyxl.load_workbook(p, read_only=True, data_only=True)
    result = {}
    for s in w:
        s.reset_dimensions()
        it = iter(s.values)
        header = next(it, ())
        result[s.title] = [dict(zip(header, row)) for row in it if any(v is not None and v != '' for v in row)]
    w.close()
    return result, p.name

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

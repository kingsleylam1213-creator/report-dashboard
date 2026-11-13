"""Publish an explicit dashboard bundle to GitHub Pages; no model or saved tokens."""
import argparse,base64,datetime,gzip,hashlib,json,os,pathlib,re,shutil,subprocess,sys,time,urllib.request,urllib.error
from html.parser import HTMLParser

APP=pathlib.Path(__file__).resolve().parents[1]
ROOT=APP.parent
REPO='kingsleylam1213-creator/report-dashboard'
BRANCH='master'
PREFIX='apparel-dashboard'
URL='https://kingsleylam1213-creator.github.io/report-dashboard/apparel-dashboard/'
HOME_URL='https://kingsleylam1213-creator.github.io/report-dashboard/home.html'
OLD_URL='https://apparel-operations-kings-1113.kingsleylam1213.chatgpt.site'
FOLDERS=['产品管理','商品管理','库龄管理','新版履约单管理','销售代码']
GH=shutil.which('gh') or str(pathlib.Path(os.environ.get('ProgramFiles','C:/Program Files'))/'GitHub CLI/gh.exe')
LOG=APP/'outputs/github-publish'

class PublishError(RuntimeError): pass
def sha(data): return hashlib.sha256(data).hexdigest()
def api(route,method='GET',body=None):
    args=[GH,'api','--method',method,'-H','Accept: application/vnd.github+json',f'repos/{REPO}'+('/'+route if route else '')]
    payload=None
    if body is not None:
        args+=['--input','-'];payload=json.dumps(body,ensure_ascii=False).encode('utf-8')
    try: r=subprocess.run(args,input=payload,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
    except (OSError,subprocess.TimeoutExpired) as e: raise PublishError('GitHub 调用失败，请检查网络、GitHub CLI 和 gh auth login。') from e
    if r.returncode: raise PublishError(method+' '+route+': '+r.stderr.decode('utf-8',errors='replace').strip())
    return json.loads(r.stdout) if r.stdout.strip() else {}

def source_state():
    result={}
    for folder in FOLDERS:
        files=[p for p in (ROOT/folder).glob('*.xlsx') if not p.name.startswith('~$')]
        if not files: raise PublishError(f'未找到源文件：{folder}/*.xlsx')
        p=max(files,key=lambda p:p.stat().st_mtime)
        result[folder]=(p.name,p.stat().st_size,p.stat().st_mtime_ns)
    return result

def preflight():
    if not pathlib.Path(GH).exists(): raise PublishError('未安装 GitHub CLI。请安装 gh 并运行 gh auth login。')
    if not api('').get('permissions',{}).get('push'): raise PublishError('当前 GitHub 账号没有仓库写入权限，请运行 gh auth login。')
    p=api('pages')
    if p.get('source')!={'branch':BRANCH,'path':'/'} or p.get('build_type')!='legacy': raise PublishError('Pages 配置已改变，预期为 master 分支根目录。未自动修改仓库设置。')
    source_state();print('GitHub 权限、Pages 配置和五类源文件检查通过。',flush=True)

def build_bundle():
    before=source_state();print('正在重新读取五类最新 Excel，不使用缓存...',flush=True)
    r=subprocess.run([sys.executable,'-X','utf8',str(APP/'tools/build_dashboard_data.py')],capture_output=True,text=True,encoding='utf-8',cwd=APP)
    if r.returncode: raise PublishError(r.stderr or r.stdout or '数据构建失败。')
    if before!=source_state(): raise PublishError('构建过程中源文件发生变化，请结束导出操作后重试。')
    d=json.loads((APP/'data/normalized.json').read_text(encoding='utf-8'))
    if not d['products']: raise PublishError('产品主档为空，停止发布。')
    forbidden={'buyerName','email','phone','address','买家姓名','收货人姓名','联系电话','邮箱','地址1','地址2'}
    for key in ['orders','inventory','listings']:
        if any(forbidden & set(r) for r in d[key]): raise PublishError('网页数据含不允许上传的买家联系方式字段。')
    assets={name:(APP/'dist'/name).read_bytes() for name in ['app.js','styles.css']}
    packed=base64.b64encode(gzip.compress(json.dumps(d,ensure_ascii=False,separators=(',',':')).encode('utf-8'),compresslevel=9,mtime=0)).decode('ascii')
    assets['data.js']=("window.DASHBOARD_DATA_READY=(async()=>{const bytes=Uint8Array.from(atob('"+packed+"'),c=>c.charCodeAt(0));const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));window.DASHBOARD_DATA=JSON.parse(await new Response(stream).text());})();\n").encode('utf-8')
    index=(APP/'dist/index.html').read_text(encoding='utf-8')
    for name,value in assets.items():
        index,n=re.subn(r'((?:src|href)=")'+re.escape(name)+r'(?:\?[^\"]*)?"',lambda m:m[1]+name+'?v='+sha(value)[:16]+'"',index)
        if n!=1: raise PublishError('资源引用异常：'+name)
    (APP/'dist/index.html').write_text(index,encoding='utf-8');assets['index.html']=index.encode('utf-8')
    snapshot={'generatedAt':d['meta']['generatedAt'],'sources':d['meta']['sources'],'counts':d['meta']['counts'],'version':sha(assets['data.js']),'assets':{k:sha(v) for k,v in assets.items()},'url':URL}
    assets['snapshot.json']=json.dumps(snapshot,ensure_ascii=False,indent=2).encode('utf-8')
    preview=LOG/'preview';preview.mkdir(parents=True,exist_ok=True)
    for name,value in assets.items(): (preview/name).write_bytes(value)
    bundle={f'{PREFIX}/{k}':v for k,v in assets.items()}
    # Explicit allowlist: raw Excel, local caches and login credentials cannot be uploaded.
    for name in ['publish_github.py','build_dashboard_data.py','prepare_data.py','publish-github.ps1']:
        bundle[f'{PREFIX}/tools/{name}']=(APP/'tools'/name).read_bytes()
    bundle[f'{PREFIX}/README.md']=(APP/'README.md').read_bytes()
    bundle['更新服饰看板.cmd']=(ROOT/'更新线上看板.cmd').read_bytes()
    print(f"数据已构建：订单 {len(d['orders']):,} 行，商品 {d['meta']['counts']['listingRows']:,} 行，库存 {len(d['inventory']):,} 行。",flush=True)
    return bundle,snapshot

class Links(HTMLParser):
    def __init__(self): super().__init__();self.links=[]
    def handle_starttag(self,t,a):
        if t=='a': self.links.append(dict(a))

def update_home(original):
    text=original.decode('utf-8');excluded={OLD_URL,'./apparel-dashboard/',URL}
    pattern=r'<a\b[^>]*href="(?:'+re.escape(OLD_URL)+r'|\./apparel-dashboard/|'+re.escape(URL)+r')"[^>]*>.*?</a>'
    matches=list(re.finditer(pattern,text,re.S))
    if len(matches)>1: raise PublishError('导航中存在多个服饰入口，停止自动覆盖。')
    card='''<a class="card" href="./apparel-dashboard/" target="_blank" rel="noopener noreferrer">
      <div class="icon">👕</div>
      <div class="title">服饰经营数据看板</div>
      <div class="desc">订单销量、库存库龄与商品刊登覆盖，支持筛选、明细展开和导出</div>
    </a>'''
    if '\r\n' in text: card=card.replace('\n','\r\n')
    if matches:
        m=matches[0];updated=text[:m.start()]+card+text[m.end():]
    else:
        if '服饰经营数据看板' in text: raise PublishError('服饰导航入口格式不同，停止自动覆盖。')
        m=re.search(r'  </div>\s*</body>',text)
        if not m: raise PublishError('无法识别导航卡片容器。')
        updated=text[:m.start()]+'\n    '+card+'\n'+text[m.start():]
    a,b=Links(),Links();a.feed(text);b.feed(updated)
    if [x for x in a.links if x.get('href') not in excluded]!=[x for x in b.links if x.get('href') not in excluded]: raise PublishError('导航检查失败：其他报表链接发生变化。')
    return updated.encode('utf-8')

def blob(content):
    if len(content)>90*1024*1024: raise PublishError('网页单文件超过90MB，停止发布。')
    return api('git/blobs','POST',{'content':base64.b64encode(content).decode('ascii'),'encoding':'base64'})['sha']

def push_bundle(bundle,snapshot):
    print('正在上传网页资源到指定 GitHub 仓库...',flush=True)
    entries=[]
    for k,v in bundle.items():
        print(f'上传 {k}（{len(v):,} 字节）',flush=True)
        entries.append({'path':k,'mode':'100644','type':'blob','sha':blob(v)})
    for attempt in range(3):
        head=api(f'git/ref/heads/{BRANCH}')['object']['sha'];parent=api(f'git/commits/{head}')
        home=api(f'contents/home.html?ref={head}')
        home_sha=blob(update_home(base64.b64decode(home['content'])))
        tree=api('git/trees','POST',{'base_tree':parent['tree']['sha'],'tree':entries+[{'path':'home.html','mode':'100644','type':'blob','sha':home_sha}]})
        commit=api('git/commits','POST',{'message':f"Update apparel dashboard data {snapshot['generatedAt']}",'tree':tree['sha'],'parents':[head]})['sha']
        if api(f'git/ref/heads/{BRANCH}')['object']['sha']!=head:
            print('其他报表刚刚更新，保留其最新内容后重试...',flush=True);continue
        try:
            api(f'git/refs/heads/{BRANCH}','PATCH',{'sha':commit,'force':False})
            print('源码已提交：'+commit+'。等待 Pages 发布，尚未报告成功。',flush=True);return commit
        except PublishError:
            if api(f'git/ref/heads/{BRANCH}')['object']['sha']==head: raise
    raise PublishError('仓库存在并发更新，未强制覆盖，请稍后重试。')

def download(url):
    req=urllib.request.Request(url,headers={'Cache-Control':'no-cache','User-Agent':'ApparelDashboardUpdater/1.0'})
    with urllib.request.urlopen(req,timeout=45) as r: return r.read()

def verify_online(snapshot):
    query=f'?v={snapshot["version"][:16]}&t={time.time_ns()}'
    if json.loads(download(URL+'snapshot.json'+query)).get('version')!=snapshot['version']: return False
    for name,expected in snapshot['assets'].items():
        if sha(download(URL+name+query))!=expected: return False
    return './apparel-dashboard/' in download(HOME_URL+query).decode('utf-8')

def wait_for_pages(commit,snapshot,timeout):
    end=time.monotonic()+timeout;last=''
    while time.monotonic()<end:
        try:
            build=api('pages/builds/latest');status=build.get('status','unknown')
            if status!=last: print('Pages 状态：'+status,flush=True);last=status
            if status=='errored' and build.get('commit')==commit: raise PublishError('Pages 发布失败：'+str(build.get('error',{}).get('message')))
            if status=='built' and verify_online(snapshot): return
        except (urllib.error.URLError,TimeoutError,ValueError): pass
        time.sleep(5)
    raise PublishError('源码已提交，但尚未核实网页完成发布。没有报告成功；请查看 GitHub Pages 构建状态或稍后重试。')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check-only',action='store_true');p.add_argument('--build-only',action='store_true');p.add_argument('--no-open',action='store_true');p.add_argument('--timeout',type=int,default=900);args=p.parse_args()
    result={'status':'failed','url':URL,'repo':REPO};LOG.mkdir(parents=True,exist_ok=True);lock=None
    try:
        import msvcrt
        lock=open(LOG/'publish.lock','a+b');lock.seek(0,os.SEEK_END)
        if not lock.tell(): lock.write(b'0');lock.flush()
        lock.seek(0)
        try: msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        except OSError as e: raise PublishError('另一个线上更新正在运行，请等待完成。') from e
        if not args.build_only: preflight()
        if args.check_only: print('配置检查完成，没有上传数据。');return 0
        bundle,snapshot=build_bundle();result['snapshot']=snapshot
        if args.build_only: print('本地构建及上传文件范围检查完成，没有上传数据。');return 0
        result['commit']=push_bundle(bundle,snapshot);wait_for_pages(result['commit'],snapshot,args.timeout)
        result['status']='succeeded';print('\n线上更新成功：'+URL,flush=True)
        if not args.no_open:
            import webbrowser
            webbrowser.open(URL+'?v='+snapshot['version'][:16])
        return 0
    except Exception as e:
        result['error']=str(e);print('\n更新失败：'+str(e),file=sys.stderr,flush=True);return 1
    finally:
        if lock: lock.close()
        if not args.check_only and not args.build_only: (LOG/'last-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__': sys.exit(main())

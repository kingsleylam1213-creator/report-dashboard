/**
 * encrypt.js — 用 AES-256-GCM + PBKDF2 加密 HTML 文件
 * 输出：自包含的加密页（源码只有密文，无明文密码）
 */
const crypto = require('crypto');
const fs = require('fs');

const ITERATIONS = 100000;

function encryptHtml(inputPath, outputPath, password, title) {
  const content = fs.readFileSync(inputPath, 'utf8');

  const salt = crypto.randomBytes(16);
  const iv   = crypto.randomBytes(12);
  const key  = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');

  const cipher     = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()]);
  const tag        = cipher.getAuthTag();

  // 格式：salt(16) + iv(12) + ciphertext + tag(16)
  const blob = Buffer.concat([salt, iv, ciphertext, tag]);
  const b64  = blob.toString('base64');

  const page = buildPage(b64, title, ITERATIONS);
  fs.writeFileSync(outputPath, page, 'utf8');
  console.log('✓', title.padEnd(20), '→', outputPath, ' (', (blob.length/1024).toFixed(0), 'KB)');
}

function buildPage(b64, title, iters) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;
  background:#0f0a1a;color:#e2e8f0;
  min-height:100vh;display:flex;align-items:center;justify-content:center;
  padding:1.5rem;
}
.box{
  background:rgba(30,20,50,.9);
  border:1px solid rgba(167,139,250,.35);
  border-radius:20px;padding:2.5rem 2rem;
  width:360px;max-width:100%;
  box-shadow:0 16px 48px rgba(0,0,0,.5);
  display:flex;flex-direction:column;gap:1.2rem;
  animation:pop .2s ease;
}
@keyframes pop{from{transform:scale(.94);opacity:0}to{transform:scale(1);opacity:1}}
.lock{font-size:2.8rem;text-align:center;}
.heading{text-align:center;}
.heading h2{
  font-size:1.2rem;font-weight:700;
  background:linear-gradient(135deg,#a78bfa,#60a5fa);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;
  margin-bottom:.3rem;
}
.heading p{font-size:.82rem;color:#94a3b8;}
input[type=password]{
  width:100%;padding:11px 14px;
  background:rgba(255,255,255,.06);
  border:1px solid rgba(167,139,250,.3);
  border-radius:10px;color:#e2e8f0;font-size:15px;
  letter-spacing:2px;outline:none;transition:border-color .15s;
}
input[type=password]:focus{border-color:#a78bfa;}
.btn{
  width:100%;padding:11px;border-radius:10px;border:none;
  background:linear-gradient(135deg,#7c3aed,#2563eb);
  color:#fff;font-size:15px;font-weight:600;cursor:pointer;
  transition:opacity .15s;
}
.btn:hover{opacity:.88;}
.btn:disabled{opacity:.5;cursor:default;}
.err{font-size:12px;color:#f87171;text-align:center;min-height:16px;}
.hint{font-size:11px;color:#475569;text-align:center;}
.spinner{
  display:none;width:20px;height:20px;margin:0 auto;
  border:2px solid rgba(255,255,255,.2);border-top-color:#a78bfa;
  border-radius:50%;animation:spin .7s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="box">
  <div class="lock">&#x1F510;</div>
  <div class="heading">
    <h2>${title}</h2>
    <p>此页面已加密，请输入访问密码</p>
  </div>
  <input type="password" id="pwd" placeholder="请输入密码" autofocus
         onkeydown="if(event.key==='Enter')go()">
  <div class="err" id="err"></div>
  <div class="spinner" id="spin"></div>
  <button class="btn" id="btn" onclick="go()">解 锁</button>
  <div class="hint">密码正确后页面将自动加载</div>
</div>
<script>
var D='${b64}';
var N=${iters};
function b64ToU8(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}
async function go(){
  var pwd=document.getElementById('pwd').value;
  if(!pwd)return;
  document.getElementById('err').textContent='';
  document.getElementById('btn').disabled=true;
  document.getElementById('btn').textContent='解密中…';
  document.getElementById('spin').style.display='block';
  await new Promise(function(r){setTimeout(r,30);});
  try{
    var raw=b64ToU8(D);
    var salt=raw.slice(0,16);
    var iv=raw.slice(16,28);
    var data=raw.slice(28);
    var km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pwd),'PBKDF2',false,['deriveKey']);
    var key=await crypto.subtle.deriveKey(
      {name:'PBKDF2',salt:salt,iterations:N,hash:'SHA-256'},
      km,{name:'AES-GCM',length:256},false,['decrypt']
    );
    var dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv},key,data);
    var html=new TextDecoder().decode(dec);
    document.open();document.write(html);document.close();
  }catch(e){
    document.getElementById('err').textContent='密码错误，请重试';
    document.getElementById('pwd').select();
    document.getElementById('btn').disabled=false;
    document.getElementById('btn').textContent='解 锁';
    document.getElementById('spin').style.display='none';
  }
}
</script>
</body>
</html>`;
}

const REPO = __dirname.replace(/\\/g, '/');
const tasks = [
  { file: 'index.html',         pwd: 'sy18929531199',  title: '平台利润看板' },
  { file: 'sales-channel.html', pwd: 'sy18929531199',  title: '非亚渠道业绩报告' },
  { file: 'new-product.html',   pwd: 'xinpinkaifa123', title: '新品首单分析' },
  { file: '万邑通库存管理.html',   pwd: 'kucunguanli123', title: '万邑通库存管理' },
];

/**
 * 判断文件是否已受保护（AES 加密或 overlay 注入），防止重复加密
 */
function isAlreadyProtected(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // AES 解密壳特征：PBKDF2 派生密钥
    if (content.includes('PBKDF2')) return true;
    // overlay 注入特征：密码遮罩 style id
    if (content.includes('pwd-overlay-style')) return true;
    return false;
  } catch { return false; }
}

console.log('开始加密...\n');
tasks.forEach(t => {
  const filePath = REPO + '/' + t.file;
  if (isAlreadyProtected(filePath)) {
    console.log('⏭ 已受保护，跳过:', t.title);
    return;
  }
  encryptHtml(filePath, filePath, t.pwd, t.title);
});
console.log('\n全部完成。');

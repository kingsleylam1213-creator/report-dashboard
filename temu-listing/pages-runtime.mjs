// Read-only, password-encrypted snapshots for a static HTTPS host.
let snapshot = null, activeManifest = null, password = '', unlocking = null;
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));

async function manifest() {
  const response = await fetch('./manifest.json?t=' + Date.now(), { cache: 'no-store' });
  if (!response.ok) throw new Error('共享数据版本暂时无法读取，请稍后刷新。');
  return response.json();
}

function askPassword(message = '') {
  return new Promise(resolve => {
    let dialog = document.querySelector('#pages-password-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'pages-password-dialog';
      dialog.innerHTML = '<form id="pages-password-form"><div class="eyebrow">TEMU OPERATIONS</div><h2>打开共享看板</h2><p class="muted">请输入运营经理提供的访问密码。</p><label class="file-field"><span><b>访问密码</b></span><input id="pages-password" type="password" autocomplete="current-password" required style="width:100%;height:38px;border:1px solid #dbe5df;border-radius:5px;padding:8px"></label><p id="pages-password-message" class="muted" role="status"></p><div class="dialog-footer"><button class="button primary" type="submit">打开看板</button></div></form>';
      dialog.addEventListener('cancel', e => e.preventDefault());
      document.body.append(dialog);
    }
    dialog.querySelector('#pages-password-message').textContent = message;
    const form = dialog.querySelector('form');
    form.onsubmit = e => {
      e.preventDefault();
      const value = dialog.querySelector('input').value;
      if (!value) return;
      form.querySelector('button').disabled = true;
      dialog.querySelector('#pages-password-message').textContent = '正在解锁数据…';
      resolve({ password: value, finish: () => { form.querySelector('button').disabled = false; dialog.close(); }, retry: text => { form.querySelector('button').disabled = false; dialog.querySelector('#pages-password-message').textContent = text; } });
    };
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('input').focus();
  });
}

async function decrypt(ciphertext, password, config) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(config.salt), iterations: config.iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const compressed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(config.iv), tagLength: 128 }, key, ciphertext);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

async function loadSnapshot(nextManifest) {
  if (snapshot && activeManifest?.version === nextManifest.version) return snapshot;
  const response = await fetch('./' + nextManifest.dataFile + '?v=' + nextManifest.version, { cache: 'no-store' });
  if (!response.ok) throw new Error('共享数据暂时无法下载，请稍后刷新。');
  const ciphertext = await response.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (digest !== nextManifest.sha256) throw new Error('线上数据版本正在切换，请稍后刷新。');
  if (password) {
    try { snapshot = await decrypt(ciphertext, password, nextManifest.encryption); activeManifest = nextManifest; return snapshot; }
    catch { password = ''; }
  }
  let failure = '';
  while (!snapshot || activeManifest?.version !== nextManifest.version) {
    const entry = await askPassword(failure);
    try {
      const decoded = await decrypt(ciphertext, entry.password, nextManifest.encryption);
      password = entry.password; snapshot = decoded; activeManifest = nextManifest; entry.finish();
    } catch { failure = '密码不正确，请核对后重试。'; entry.retry(failure); }
  }
  return snapshot;
}

async function ensureCurrent() {
  if (unlocking) return unlocking;
  unlocking = (async () => loadSnapshot(await manifest()))();
  try { return await unlocking; } finally { unlocking = null; }
}

export async function pagesRequest(url, body) {
  if (body !== undefined) throw new Error('共享看板可查看和导出，更新由运营经理统一发布。');
  if (url === '/api/session') { await ensureCurrent(); return { name: 'operator', role: 'viewer', mode: 'shared', canEdit: false }; }
  if (url === '/api/data') return ensureCurrent();
  if (url === '/api/meta') return (await ensureCurrent()).meta;
  if (url === '/api/status') {
    const data = await ensureCurrent();
    return { running: false, percent: 100, message: '共享数据已就绪', error: null, ready: true, updatedAt: data.meta.generatedAt };
  }
  throw new Error('此操作不适用于共享看板。');
}

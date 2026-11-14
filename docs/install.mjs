export const publicUrl = 'https://chenhenry0429.github.io/pause-before-scroll/';

export function deviceContext() {
  const ua = navigator.userAgent;
  return {
    ios: /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    android: /Android/.test(ua),
    embedded: /MicroMessenger|QQ\/|Weibo|DingTalk|AlipayClient|\bwv\b/i.test(ua),
    standalone: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  };
}

export function initInstall(device, changed) {
  const get = id => document.getElementById(id);
  const button = get('install-mobile');
  const copy = get('copy-link');
  const link = get('copy-address');
  const status = get('install-status');
  let prompt = null, installing = false;

  function render(message) {
    button.hidden = !prompt || device.standalone();
    get('apk-download').hidden = !device.android;
    status.textContent = message || (device.standalone() ? '已从主屏幕打开。'
      : prompt ? '可以直接添加到桌面。'
      : device.embedded ? '如需安装，请点右上角菜单，在手机浏览器中打开。'
      : device.ios ? '在 Safari 点「分享」→「添加到主屏幕」。'
      : '浏览器菜单如有「安装应用」或「添加到主屏幕」，可从那里添加。');
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    prompt = event;
    render();
  });
  window.addEventListener('appinstalled', () => {
    prompt = null;
    render('已添加到桌面。');
    changed();
  });
  button.addEventListener('click', async () => {
    if (!prompt || installing) return;
    const request = prompt;
    prompt = null;
    installing = true;
    button.disabled = true;
    try {
      await request.prompt();
      const decision = await request.userChoice;
      render(decision?.outcome === 'accepted' ? '已同意安装，请在桌面查看图标。' : '已取消安装，仍可在网页使用。');
    } catch {
      render('未能打开安装窗口，可继续使用网页，或从浏览器菜单添加。');
    } finally {
      installing = false;
      button.disabled = false;
    }
  });
  copy.addEventListener('click', async () => {
    const result = get('copy-status');
    try {
      await navigator.clipboard.writeText(publicUrl);
      result.textContent = '链接已复制。';
    } catch {
      link.hidden = false;
      link.focus();
      link.select();
      result.textContent = '请长按或选择下方网址复制。';
    }
  });
  get('enhancements').addEventListener('toggle', () => {
    if (get('enhancements').open) changed();
  });
  render();
}

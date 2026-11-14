export const androidBridge = window.PauseAndroid || null;

export function initAndroid(getActive) {
  const get = id => document.getElementById(id);
  const bridge = androidBridge;
  let test = false;
  function read(value) { return JSON.parse(value); }
  function render(active = getActive()) {
    const info = read(bridge.status());
    const canNotify = info.notifications === 'allowed';
    get('mobile-status').textContent = ({
      allowed: info.exact ? '通知已开启，可安排本机准时提醒。' : '通知已开启。允许「闹钟和提醒」可提高准时性；目前系统可能延迟。',
      denied: '通知权限已拒绝，请到系统设置允许「停一下」通知。',
      off: '尚未开启通知。开启后可在锁屏或切换应用时接收本机提醒。'
    })[info.notifications];
    get('enable-mobile').hidden = canNotify;
    get('enable-mobile').textContent = info.notifications === 'denied' ? '打开系统通知设置' : '允许通知';
    get('enable-mobile').disabled = false;
    get('exact-mobile').hidden = !canNotify || info.exact;
    get('test-mobile').hidden = !canNotify;
    get('test-mobile').disabled = false;
    get('disable-mobile').hidden = true;
    get('refresh-mobile').hidden = true;
    if (!active) return;
    get('retry-reminder').hidden = !canNotify || info.id === active.id || active.endsAt <= Date.now();
    get('session-push-status').textContent = !canNotify ? '本机提醒未开启。计时继续，返回页面后会显示结果。'
      : info.id === active.id && info.posted ? '已向系统通知栏提交提醒。请查看手机通知。'
      : info.id === active.id && info.mode === 'exact' ? '本机提醒已安排，可切换应用或锁屏。'
      : info.id === active.id && info.mode === 'approximate' ? '本机提醒已安排，省电时可能延迟。可开启「闹钟和提醒」。'
      : '这次尚未安排本机提醒。';
  }
  function schedule(active = getActive()) {
    if (active && active.endsAt > Date.now()) bridge.schedule(active.id, active.endsAt);
    render(active);
  }
  get('mobile-kind').textContent = '系统本地提醒，断网也可安排。';
  get('enable-mobile').addEventListener('click', () => bridge.requestNotifications());
  get('exact-mobile').addEventListener('click', () => bridge.requestExactAlarm());
  get('retry-reminder').addEventListener('click', () => schedule());
  get('test-mobile').addEventListener('click', () => {
    const timer = read(bridge.test());
    test = timer.ok;
    get('test-status').textContent = !test ? '未能安排测试，请检查系统通知权限。'
      : timer.mode === 'exact' ? '测试已安排。现在可锁屏，约 10 秒后检查通知。'
      : '测试已安排。系统可能延迟，请检查通知栏后确认。';
    get('test-confirm').hidden = !test;
  });
  get('test-received').addEventListener('click', () => {
    if (!test) return;
    get('test-status').textContent = '已记录，这台设备收到了测试通知。';
    get('test-confirm').hidden = true;
    test = false;
  });
  get('test-missed').addEventListener('click', () => {
    if (!test) return;
    get('test-status').textContent = '没有收到。请检查系统通知和「闹钟和提醒」权限，再试一次。';
    get('test-confirm').hidden = true;
    test = false;
  });
  get('install-guide').hidden = true;
  document.documentElement.classList.add('native-android');
  window.addEventListener('pause-android-resume', () => schedule());
  schedule();
  return {schedule, status:render, cancel(id) { if (id) bridge.cancel(id); }};
}

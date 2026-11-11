(function () {
 if (typeof window.globalThis === 'undefined') window.globalThis = window;
 window.__pauseLocalFile = location.protocol === 'file:' || location.protocol === 'content:';
 window.pauseStartupFailure = function (message) {
  if (window.__pauseStarted) return;
  var help = document.getElementById('startup-help');
  help.hidden = false;
  document.getElementById('startup-message').textContent = message;
 };
 if (window.__pauseLocalFile) {
  document.documentElement.className += ' local-copy';
  window.pauseStartupFailure('你打开的是保存到手机里的网页文件。请点击“打开在线版”，再在浏览器中使用；不要从文件管理中打开 HTML 文件。');
 } else {
  setTimeout(function () { window.pauseStartupFailure('页面尚未启动完成。如果按钮没有反应，请刷新或在手机浏览器中重新打开在线版。'); }, 10000);
 }
}());

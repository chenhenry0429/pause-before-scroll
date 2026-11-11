import {installDOMCompatibility} from './compat.mjs';
import {startApp} from './app.mjs';
if(!window.__pauseLocalFile){
 try{installDOMCompatibility();startApp();window.__pauseStarted=true;document.getElementById('startup-help').hidden=true;}
 catch{window.pauseStartupFailure('页面未能正常启动。请刷新一次；若仍无反应，请在手机自带浏览器中打开下方在线地址。');}
}

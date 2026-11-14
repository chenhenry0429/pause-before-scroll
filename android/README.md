# 安卓安装版

这个工程复用 `docs/` 的计时界面和业务逻辑。Android 使用包内网页资源和系统 AlarmManager，
计时与通知无需访问网络。匿名反馈仍连接原服务。安装版有独立的本机记录和系统文件导出功能。

在 Windows 上安装 Node.js、JDK 21、Android SDK Platform 35 和 Build Tools 35.0.0。
从项目根目录运行 `npm ci`，再将现有签名库的口令设置到当前进程的
`PAUSE_KEYSTORE_PASSWORD` 环境变量，执行：

```powershell
./android/build.ps1 -Jdk '你的 JDK 路径' -Platform 'SDK/platforms/android-35' `
  -BuildTools 'SDK/build-tools/35.0.0' -Output '安装包输出路径.apk' -Keystore '私有签名库路径.p12'
```

签名库中的别名是 `pause-release`。更新时保持包名和签名证书一致，并递增清单中的
`versionCode`。口令和私钥仅保存在私下管理的位置，勿上传。发布脚本会验证 APK 签名。

真机验收：安装后拒绝通知并走完一轮计时，开启通知后在飞行模式中测试切换到其他应用和锁屏，
提前结束并保存回顾后等到原到期时间，再从上一轮结束后开始新一轮。对比允许和拒绝「闹钟和提醒」
两种情况。另验收离线导出、应用覆盖升级后保留记录，以及在线匿名反馈。

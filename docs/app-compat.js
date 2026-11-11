(() => {
  // docs/compat.mjs
  function randomId(source = globalThis.crypto) {
    if (source == null ? void 0 : source.randomUUID) return source.randomUUID();
    if (!(source == null ? void 0 : source.getRandomValues)) throw new Error("浏览器缺少安全随机数功能，请用更新的浏览器打开在线版。");
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }
  function deadline(promise, ms, message = "连接超时，请稍后重试。", cancel = () => {
  }) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        cancel();
        reject(new Error(message));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
  function fetchJson(url, options = {}, ms = 15e3) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    return deadline(fetch(url, { ...options, ...controller ? { signal: controller.signal } : {} }).then(async (response) => ({ response, data: await response.json() })), ms, "连接超时，请检查网络后重试。", () => controller == null ? void 0 : controller.abort());
  }
  function installDOMCompatibility() {
    if (!Element.prototype.replaceChildren) Element.prototype.replaceChildren = function(...nodes) {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.append(...nodes);
    };
  }
  var fallbackDialogs = /* @__PURE__ */ new WeakMap();
  function openDialog(dialog) {
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      return;
    }
    if (dialog.hasAttribute("open")) return;
    const previous = document.activeElement, backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    dialog.classList.add("fallback-dialog");
    dialog.setAttribute("open", "");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("tabindex", "-1");
    document.body.append(backdrop);
    const handler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialogElement(dialog);
      }
      if (event.key === "Tab") {
        const items = Array.from(dialog.querySelectorAll("button:not(:disabled),input,select,textarea,a[href]"));
        if (!items.length) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items[items.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
          event.preventDefault();
          items[0].focus();
        }
      }
    };
    dialog.addEventListener("keydown", handler);
    fallbackDialogs.set(dialog, { previous, backdrop, handler });
    (dialog.querySelector("button:not(:disabled),input,select") || dialog).focus();
  }
  function closeDialogElement(dialog) {
    var _a;
    const fallback = fallbackDialogs.get(dialog);
    if (!fallback) {
      dialog.close();
      return;
    }
    dialog.removeAttribute("open");
    dialog.removeAttribute("aria-modal");
    dialog.classList.remove("fallback-dialog");
    dialog.removeEventListener("keydown", fallback.handler);
    fallback.backdrop.remove();
    (_a = fallback.previous) == null ? void 0 : _a.focus();
    fallbackDialogs.delete(dialog);
  }

  // docs/api.mjs
  var API_ORIGIN = "https://pause-mobile-reminders.chenhenry860.workers.dev";
  function apiUrl(path) {
    return API_ORIGIN + path;
  }

  // docs/core.mjs
  var MAX_HISTORY = 500;
  var PLATFORMS = Object.freeze(["wechat", "bili", "other"]);
  var OUTCOMES = Object.freeze(["stopped", "continued"]);
  var MOODS = Object.freeze(["better", "same", "worse", "skip"]);
  var MAX_DATE = 864e13;
  var DEFAULT_ALTERNATIVE = "站起来，喝口水";
  var fallbackSequence = 0;
  function defaultData() {
    return {
      settings: { minutes: 10, delaySeconds: 10, alternative: DEFAULT_ALTERNATIVE, sound: false },
      active: null,
      history: []
    };
  }
  function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  }
  function integer(value, minimum, maximum) {
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
  }
  function timestamp(value) {
    return integer(value, 0, MAX_DATE);
  }
  function requireTimestamp(value) {
    if (!timestamp(value)) throw new RangeError("时间戳必须是有效的非负整数毫秒。");
    return value;
  }
  function cleanText(value, maximum) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text || /[\u0000-\u001f\u007f]/u.test(text) || [...text].length > maximum) return null;
    return text;
  }
  function sessionData(value) {
    if (!record(value)) return null;
    const id = cleanText(value.id, 100);
    const reason = cleanText(value.reason, 160);
    const alternative = cleanText(value.alternative, 120);
    if (!id || !reason || !alternative || !PLATFORMS.includes(value.platform) || !integer(value.minutes, 1, 180) || !timestamp(value.startedAt) || !timestamp(value.endsAt) || value.endsAt !== value.startedAt + value.minutes * 6e4) return null;
    return {
      id,
      platform: value.platform,
      minutes: value.minutes,
      reason,
      alternative,
      startedAt: value.startedAt,
      endsAt: value.endsAt
    };
  }
  function historyData(value) {
    const session = sessionData(value);
    if (!session || !timestamp(value.finishedAt) || value.finishedAt < session.startedAt || !OUTCOMES.includes(value.outcome)) return null;
    return {
      ...session,
      finishedAt: value.finishedAt,
      elapsedSeconds: Math.floor((value.finishedAt - session.startedAt) / 1e3),
      outcome: value.outcome,
      mood: MOODS.includes(value.mood) ? value.mood : "skip"
    };
  }
  function cleanHistory(values) {
    if (!Array.isArray(values)) return [];
    const sorted = values.map(historyData).filter(Boolean).sort((a, b) => b.finishedAt - a.finishedAt || b.startedAt - a.startedAt);
    const seen = /* @__PURE__ */ new Set();
    return sorted.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, MAX_HISTORY);
  }
  function createSession(input = {}, now = Date.now()) {
    const platform = input.platform, minutes = input.minutes, reason = input.reason, alternative = input.alternative;
    requireTimestamp(now);
    if (!PLATFORMS.includes(platform)) throw new TypeError("请选择有效的平台。");
    if (!integer(minutes, 1, 180)) throw new RangeError("时长必须是 1–180 的整数分钟。");
    const cleanReason = cleanText(reason, 160);
    const cleanAlternative = cleanText(alternative, 120);
    if (!cleanReason || !cleanAlternative) throw new TypeError("原因和替代活动必须是有效的简短文本。");
    const endsAt = now + minutes * 6e4;
    requireTimestamp(endsAt);
    let id;
    try {
      id = randomId();
    } catch {
      id = `${now.toString(36)}-${(++fallbackSequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
    return { id, platform, minutes, reason: cleanReason, alternative: cleanAlternative, startedAt: now, endsAt };
  }
  function remainingMs(session, now = Date.now()) {
    const clean = sessionData(session);
    if (!clean) throw new TypeError("无效的计时计划。");
    requireTimestamp(now);
    return Math.min(clean.minutes * 6e4, Math.max(0, clean.endsAt - now));
  }
  function finishSession(session, input = {}, now = Date.now()) {
    const outcome = input.outcome, mood = input.mood === void 0 ? "skip" : input.mood;
    const clean = sessionData(session);
    if (!clean) throw new TypeError("无效的计时计划。");
    requireTimestamp(now);
    if (!OUTCOMES.includes(outcome) || !MOODS.includes(mood)) throw new TypeError("请选择有效的结束结果与感受。");
    const finishedAt = Math.max(clean.startedAt, now);
    return { ...clean, finishedAt, elapsedSeconds: Math.floor((finishedAt - clean.startedAt) / 1e3), outcome, mood };
  }
  function sanitizeData(raw) {
    var _a;
    const data = defaultData();
    try {
      const source = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!record(source)) return data;
      if (record(source.settings)) {
        const s = source.settings;
        if (integer(s.minutes, 1, 180)) data.settings.minutes = s.minutes;
        if (integer(s.delaySeconds, 0, 60)) data.settings.delaySeconds = s.delaySeconds;
        data.settings.alternative = (_a = cleanText(s.alternative, 120)) != null ? _a : DEFAULT_ALTERNATIVE;
        if (typeof s.sound === "boolean") data.settings.sound = s.sound;
      }
      data.history = cleanHistory(source.history);
      data.active = sessionData(source.active);
      if (data.active && data.history.some((item) => item.id === data.active.id)) data.active = null;
      return data;
    } catch {
      return defaultData();
    }
  }
  function localDateKey(date) {
    return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function summarize(history, now = Date.now()) {
    requireTimestamp(now);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(date.getDate() - (6 - index));
      return { date: localDateKey(date), label: `${date.getMonth() + 1}/${date.getDate()}`, minutes: 0, count: 0 };
    });
    const byDate = new Map(days.map((day) => [day.date, { day, seconds: 0 }]));
    let sessions = 0, seconds = 0, stopped = 0;
    for (const entry of cleanHistory(history)) {
      if (entry.finishedAt > now || entry.startedAt > now) continue;
      const bucket = byDate.get(localDateKey(new Date(entry.startedAt)));
      if (!bucket) continue;
      bucket.day.count += 1;
      bucket.seconds += entry.elapsedSeconds;
      sessions += 1;
      seconds += entry.elapsedSeconds;
      if (entry.outcome === "stopped") stopped += 1;
    }
    for (const bucket of byDate.values()) bucket.day.minutes = Math.round(bucket.seconds / 6) / 10;
    return { sessions, minutes: Math.round(seconds / 6) / 10, stopped, days };
  }

  // docs/mobile.mjs
  var KEY = "pause-mobile.v1";
  var $ = (selector) => document.querySelector(selector);
  function initMobile(getActive) {
    let config = null, registration = null, installPrompt = null, busy = false, state = { enabled: false, cancel: [] };
    const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const supported = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    function limitedNotice() {
      const title = $("#mobile-banner-title"), copy = $("#mobile-banner-copy");
      if (title) title.textContent = "计时可以用，后台提醒暂不可用。";
      if (copy) copy.textContent = "请同时设置手机自带计时器，避免离开网页后错过时间。";
    }
    try {
      state = { ...state, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
    }
    function persist() {
      localStorage.setItem(KEY, JSON.stringify(state));
    }
    function message(text) {
      $("#mobile-status").textContent = text;
    }
    function sessionMessage(text) {
      $("#session-push-status").textContent = text;
    }
    function controls() {
      $("#enable-mobile").disabled = busy || !(config == null ? void 0 : config.available) || !registration || !supported() || ios && !standalone();
      $("#test-mobile").disabled = busy || !state.enabled || !(config == null ? void 0 : config.available) || !supported();
      $("#disable-mobile").disabled = busy || !state.enabled;
      $("#retry-reminder").hidden = !state.enabled || !getActive();
    }
    function getDevice() {
      if (!state.device) {
        state.device = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((n) => n.toString(16).padStart(2, "0")).join("");
        persist();
      }
      return state.device;
    }
    async function command(input) {
      const reply = await fetchJson(apiUrl("/api/reminders"), { method: "POST", headers: { "Content-Type": "application/json", "X-Reminder-Device": getDevice() }, body: JSON.stringify(input) }), response = reply.response, result = reply.data;
      if (!response.ok || !result.ok) throw new Error(result.error || "服务暂不可用，请稍后重试。");
      return result;
    }
    async function flushCancellations() {
      if (state.disablePending) {
        await command({ action: "disable" });
        state.disablePending = false;
        persist();
      }
      for (const id of [...state.cancel]) {
        await command({ action: "cancel", id });
        state.cancel = state.cancel.filter((x) => x !== id);
        persist();
      }
    }
    async function refresh() {
      if (!supported()) {
        limitedNotice();
        message(ios ? "请先用 Safari 添加到主屏幕，再从桌面图标打开。需要 iOS 16.4 或更新版本。计时功能仍可使用。" : "当前浏览器不支持后台通知，计时和回顾仍可使用。请从手机浏览器打开在线版；锁屏提醒可先使用手机自带计时器。");
        controls();
        return;
      }
      if (ios && !standalone()) {
        message("iPhone：请用 Safari 添加到主屏幕，再从“停一下”图标打开。");
        controls();
        return;
      }
      if (!(config == null ? void 0 : config.available)) {
        message("手机通知服务暂不可用。计时仍可使用，请同时设置系统计时器。");
        controls();
        return;
      }
      if (Notification.permission === "denied") {
        message("通知被关闭了。请到手机的通知设置或浏览器网站设置中允许，再重新打开。");
        controls();
        return;
      }
      const sub = await (registration == null ? void 0 : registration.pushManager.getSubscription());
      if (state.enabled && (!sub || Notification.permission !== "granted")) {
        state.enabled = false;
        try {
          persist();
        } catch {
        }
      }
      message(state.enabled ? "手机通知已开启。请发送测试提醒，确认这台手机能够收到。" : "添加到主屏幕后，点击开启通知。系统询问时选择“允许”。");
      controls();
    }
    async function schedule(active) {
      var _a, _b;
      controls();
      if (!active) return;
      if (!state.enabled) {
        sessionMessage("手机通知尚未开启。请到“我的约定”设置，或使用系统计时器。");
        return;
      }
      if (active.endsAt <= Date.now()) {
        await status();
        return;
      }
      sessionMessage("正在安排后台提醒，请稍候…");
      try {
        await flushCancellations();
        const sub = await (registration == null ? void 0 : registration.pushManager.getSubscription());
        if (!sub || Notification.permission !== "granted") throw new Error("通知权限或订阅失效，请重新开启通知。");
        const epoch = state.epoch;
        const result = await command({ action: "schedule", id: active.id, endsAt: active.endsAt, subscription: sub.toJSON(), epoch });
        if (((_a = getActive()) == null ? void 0 : _a.id) !== active.id || !state.enabled || state.epoch !== epoch) {
          await cancel(active.id);
          return;
        }
        sessionMessage("后台提醒已安排：" + new Date(result.endsAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) + "。可离开网页；请保持网络连接。");
      } catch (error) {
        if (((_b = getActive()) == null ? void 0 : _b.id) === active.id) sessionMessage("尚未确认提醒安排成功：" + error.message + " 请重试或设置系统计时器。");
      }
    }
    async function cancel(id) {
      if (!id || !state.device) return;
      if (!state.cancel.includes(id)) state.cancel.push(id);
      try {
        persist();
        await flushCancellations();
      } catch {
        message("取消提醒尚未确认。联网后会重试；可能仍收到这一次提醒。");
      }
      try {
        const notices = await (registration == null ? void 0 : registration.getNotifications({ tag: "pause-" + id }));
        notices == null ? void 0 : notices.forEach((n) => n.close());
      } catch {
      }
      controls();
    }
    async function status() {
      var _a, _b, _c;
      const active = getActive();
      controls();
      if (!state.enabled) {
        if (active) sessionMessage("未启用手机通知。请使用系统计时器。");
        return;
      }
      try {
        await flushCancellations();
        const result = await command({ action: "status" });
        if (!result.enabled) {
          state.enabled = false;
          state.epoch = null;
          try {
            persist();
          } catch {
          }
          message("手机通知设置已关闭或过期，请重新点击开启。");
          controls();
        }
        if (((_a = getActive()) == null ? void 0 : _a.id) !== (active == null ? void 0 : active.id)) return;
        if (!active) return;
        if (((_b = result.job) == null ? void 0 : _b.id) === active.id) sessionMessage("后台提醒已安排。可离开网页；请保持网络连接。");
        else if (((_c = result.last) == null ? void 0 : _c.id) === active.id) sessionMessage({ accepted: "提醒已交给手机推送服务。若没看到，请检查通知权限、专注模式和网络。", failed: "提醒发送失败，请使用系统计时器。", expired: "已错过提醒时间，没有补发过期通知。", subscription_expired: "手机通知订阅已失效，请重新开启通知。", cancelled: "这次后台提醒已取消。" }[result.last.status] || "请检查通知设置。");
        else sessionMessage("这次计时尚未确认后台提醒。请点击重试，或设置系统计时器。");
      } catch {
        if (active) sessionMessage("暂时无法核实后台提醒。请检查网络，或设置系统计时器。");
      }
    }
    $("#enable-mobile").addEventListener("click", async () => {
      if (busy || !supported()) return;
      busy = true;
      controls();
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("未获得通知权限，请在手机设置中允许。");
        getDevice();
        await flushCancellations();
        let sub = await registration.pushManager.getSubscription();
        const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
        if (sub && sub.options.applicationServerKey && !Array.from(new Uint8Array(sub.options.applicationServerKey)).every((n, i) => n === key[i])) {
          await sub.unsubscribe();
          sub = null;
        }
        if (!sub) sub = await deadline(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), 15e3, "通知通道未连接成功。计时仍可使用，请检查网络或使用系统计时器。");
        const enabled = await command({ action: "enable" });
        state.epoch = enabled.epoch;
        state.enabled = true;
        persist();
        message("手机通知已开启。现在发送一条测试提醒，确认手机能收到。");
        if (getActive()) await schedule(getActive());
      } catch (error) {
        message(error.message || "开启失败，请检查网络和手机通知设置。");
      } finally {
        busy = false;
        controls();
      }
    });
    $("#test-mobile").addEventListener("click", async () => {
      if (busy) return;
      if (getActive()) {
        message("请先结束当前计时，再发送测试提醒。");
        return;
      }
      busy = true;
      controls();
      try {
        await flushCancellations();
        const sub = await registration.pushManager.getSubscription();
        if (!sub) throw new Error("请重新开启通知。");
        state.testId = state.testId || randomId();
        persist();
        await command({ action: "test", id: state.testId, subscription: sub.toJSON(), epoch: state.epoch });
        state.testId = null;
        persist();
        message("测试提醒已安排，约 10 秒后发送。现在可返回手机桌面，检查通知。");
      } catch (error) {
        message("测试提醒尚未确认：" + error.message);
        if (error.message.includes("已结束或取消")) {
          state.testId = null;
          persist();
        }
      } finally {
        busy = false;
        controls();
      }
    });
    $("#disable-mobile").addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      controls();
      let cancelled = false, unsubscribed = false;
      try {
        state.disablePending = true;
        persist();
        await flushCancellations();
        cancelled = true;
      } catch {
      }
      try {
        const sub = await (registration == null ? void 0 : registration.pushManager.getSubscription());
        unsubscribed = !sub || await sub.unsubscribe();
      } catch {
      }
      if (cancelled || unsubscribed) {
        state.enabled = false;
        state.epoch = null;
        state.testId = null;
        try {
          persist();
        } catch {
        }
        message(cancelled ? "手机通知已关闭，已取消待发提醒。" : "手机通知已关闭。后台清理尚未确认，联网后会重试。");
      } else message("关闭未成功，请重试，或在手机系统设置中关闭“停一下”的通知。");
      busy = false;
      controls();
      await status();
    });
    $("#retry-reminder").addEventListener("click", () => schedule(getActive()));
    $("#refresh-mobile").addEventListener("click", () => boot());
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      installPrompt = event;
      $("#install-mobile").hidden = false;
    });
    $("#install-mobile").addEventListener("click", async () => {
      if (installPrompt) {
        await installPrompt.prompt();
        installPrompt = null;
        $("#install-mobile").hidden = true;
      }
    });
    window.addEventListener("appinstalled", () => {
      $("#install-mobile").hidden = true;
      refresh();
    });
    window.addEventListener("online", () => {
      flushCancellations().then(status).catch(() => {
      });
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) status();
    });
    window.addEventListener("storage", (event) => {
      if (event.key === KEY) {
        try {
          state = { enabled: false, cancel: [], ...JSON.parse(event.newValue || "{}") };
          refresh();
          status();
        } catch {
        }
      }
    });
    async function boot() {
      message("正在检查手机通知…");
      try {
        if (!supported()) {
          await refresh();
          return;
        }
        await deadline(navigator.serviceWorker.register(new URL("./sw.js", document.baseURI), { updateViaCache: "none" }), 1e4);
        registration = await deadline(navigator.serviceWorker.ready, 1e4);
        const reply = await fetchJson(apiUrl("/api/reminders"), { cache: "no-store" });
        if (!reply.response.ok) throw new Error("提醒服务连接失败");
        config = reply.data;
        await refresh();
        if (state.device) await flushCancellations();
        await status();
      } catch {
        config = null;
        limitedNotice();
        message("暂时连不上通知服务，计时仍可使用。请检查网络后重新检查，或配合手机自带计时器。");
        controls();
      }
    }
    boot();
    return { schedule, cancel, status };
  }

  // docs/app.mjs
  function startApp() {
    let feedbackTicket = "";
    const KEY2 = "pause-before-scroll.v1";
    const $2 = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
    let data = defaultData(), persistent = true, current = "now", pauseUntil = 0, pending = null, finishAt = null, announcedId = null, audio = null;
    function storageWarning() {
      persistent = false;
      $2("#storage-warning").hidden = false;
      $2("#storage-warning").textContent = "浏览器暂时无法保存数据，当前以临时模式运行。关闭或刷新后可能丢失记录；你仍可导出当前记录。";
    }
    try {
      data = sanitizeData(localStorage.getItem(KEY2));
    } catch {
      storageWarning();
    }
    let mobile = { schedule: () => {
    }, cancel: () => {
    }, status: () => {
    } };
    let popupId = null;
    function save() {
      data = sanitizeData(data);
      try {
        localStorage.setItem(KEY2, JSON.stringify(data));
      } catch {
        storageWarning();
      }
    }
    function sync() {
      if (!persistent) return;
      try {
        data = sanitizeData(localStorage.getItem(KEY2));
      } catch {
        storageWarning();
      }
    }
    function toast(text) {
      $2("#toast").hidden = false;
      $2("#toast").textContent = text;
    }
    function closeDialog(id) {
      closeDialogElement($2("#" + id));
    }
    function route(page) {
      current = page;
      if (page === "now" && data.active) page = "session";
      $$("[data-page]").forEach((s) => s.hidden = s.dataset.page !== page);
      $$("[data-nav]").forEach((b) => {
        if (b.dataset.nav === current) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      });
      if (page === "review") renderReview();
      if (page === "settings") renderSettings();
      if (page === "session") tick();
    }
    function renderSettings() {
      $2("#setting-minutes").value = data.settings.minutes;
      $2("#setting-delay").value = [5, 10, 20].includes(data.settings.delaySeconds) ? data.settings.delaySeconds : 10;
      $2("#setting-alternative").value = data.settings.alternative;
      $2("#setting-sound").checked = data.settings.sound;
    }
    function renderPlan() {
      $2("#minutes").value = data.settings.minutes;
      markMinutes();
    }
    function markMinutes() {
      $$("[data-minutes]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.minutes) === Number($2("#minutes").value))));
    }
    async function startAudio() {
      try {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) throw new Error("Audio unavailable");
        audio = audio || new C();
        await audio.resume();
        if (audio.state !== "running") throw new Error("Audio suspended");
        $2("#sound-recovery").hidden = true;
      } catch {
        toast("当前浏览器无法启用提示音，页面提示仍然可用。");
      }
    }
    function chime() {
      if (!data.settings.sound || !audio) return;
      try {
        const osc = audio.createOscillator(), gain = audio.createGain();
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.frequency.value = 523.25;
        gain.gain.setValueAtTime(0, audio.currentTime);
        gain.gain.linearRampToValueAtTime(0.09, audio.currentTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(1e-3, audio.currentTime + 1);
        osc.start();
        osc.stop(audio.currentTime + 1);
      } catch {
      }
    }
    function clock(ms) {
      const s = Math.max(0, Math.ceil(ms / 1e3));
      return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }
    function tick() {
      if ($2("#pause-dialog").hasAttribute("open")) {
        const left = Math.max(0, Math.ceil((pauseUntil - Date.now()) / 1e3));
        $2("#pause-count").textContent = left || "好了";
        $2("#confirm-watch").disabled = left > 0;
        $2("#confirm-watch").textContent = left ? "稍等一下" : `仍然想看，开始 ${(pending == null ? void 0 : pending.minutes) || 10} 分钟`;
        if (!left && $2("#pause-status").textContent !== "现在，再做一次选择") $2("#pause-status").textContent = "现在，再做一次选择";
      }
      if (!data.active) {
        document.title = "停一下 · 把时间留给自己";
        return;
      }
      const a = data.active, ms = remainingMs(a), done = ms <= 0;
      $2("#sound-recovery").hidden = !data.settings.sound || (audio == null ? void 0 : audio.state) === "running";
      $2("#timer").textContent = clock(ms);
      $2("#timer").setAttribute("aria-label", "本次剩余 " + clock(ms));
      $2("#timer-progress").style.width = Math.min(100, Math.max(0, (1 - ms / (a.minutes * 6e4)) * 100)) + "%";
      $2("#session-heading").textContent = done ? "这次，先看到这里。" : "按自己的节奏来。";
      $2("#session-subtitle").textContent = (a.platform === "wechat" ? "微信视频号" : a.platform === "bili" ? "哔哩哔哩" : "其他") + " · 计划 " + a.minutes + " 分钟 · 自主计时";
      $2("#deadline").textContent = "约定结束时间 " + new Date(a.endsAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      $2("#timer-label").textContent = done ? "到约定时间了" : "本次剩余";
      document.title = done ? "时间到了 · 停一下" : clock(ms) + " · 停一下";
      if (done && announcedId !== a.id) {
        announcedId = a.id;
        $2("#timer-status").textContent = "到约定时间了。" + a.alternative + "，再决定接下来做什么。";
        chime();
      }
      if (done && !document.hidden && popupId !== a.id && !document.querySelector("dialog[open]")) {
        popupId = a.id;
        openDialog($2("#due-dialog"));
      }
      if (!done) $2("#timer-status").textContent = "";
    }
    function renderReview() {
      const s = summarize(data.history);
      $2("#stat-sessions").textContent = s.sessions;
      $2("#stat-minutes").textContent = s.minutes;
      $2("#stat-stopped").textContent = s.stopped;
      const chart = $2("#week-chart");
      chart.replaceChildren();
      const max = Math.max(1, ...s.days.map((d) => d.minutes));
      for (const d of s.days) {
        const item = document.createElement("div");
        item.className = "day";
        const value = document.createElement("span");
        value.textContent = d.minutes + " 分";
        const wrap = document.createElement("div");
        wrap.className = "day-bar-wrap";
        const bar = document.createElement("div");
        bar.className = "day-bar";
        bar.style.height = Math.max(2, d.minutes / max * 125) + "px";
        wrap.append(bar);
        const label = document.createElement("span");
        label.textContent = d.label;
        item.append(value, wrap, label);
        chart.append(item);
      }
      const list = $2("#history");
      list.replaceChildren();
      if (!data.history.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "还没有记录。完成一次计时后，回顾会留在这里。";
        list.append(p);
      }
      for (const h of data.history.slice(0, 30)) {
        const row = document.createElement("div");
        row.className = "history-row";
        const main = document.createElement("div");
        main.textContent = (h.platform === "wechat" ? "微信视频号" : h.platform === "bili" ? "哔哩哔哩" : "其他") + " · " + (h.elapsedSeconds / 60).toFixed(1) + " 分钟";
        const date = document.createElement("small");
        date.textContent = new Date(h.startedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " · 计划 " + h.minutes + " 分钟";
        main.append(date);
        const end = document.createElement("div");
        end.className = "history-outcome";
        end.textContent = h.outcome === "stopped" ? "已停下" : "还想继续";
        const mood = document.createElement("small");
        mood.textContent = { better: "更放松", same: "差不多", worse: "更疲惫", skip: "未评价" }[h.mood];
        end.append(mood);
        row.append(main, end);
        list.append(row);
      }
      if (data.history.length > 30) {
        const p = document.createElement("p");
        p.className = "small muted";
        p.textContent = "显示最近 30 条。导出可获取全部 " + data.history.length + " 条记录。";
        list.append(p);
      }
    }
    $$("[data-nav]").forEach((b) => b.addEventListener("click", () => {
      route(b.dataset.nav);
      $2("#toast").hidden = true;
    }));
    $2(".brand").addEventListener("click", (e) => {
      e.preventDefault();
      route("now");
    });
    $$("[data-minutes]").forEach((b) => b.addEventListener("click", () => {
      $2("#minutes").value = b.dataset.minutes;
      markMinutes();
    }));
    $2("#minutes").addEventListener("input", markMinutes);
    $$("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog(b.dataset.close)));
    $2("#plan-form").addEventListener("submit", (e) => {
      e.preventDefault();
      sync();
      if (data.active) {
        route("now");
        toast("你已有一段计时，先完成这次回顾吧。");
        return;
      }
      pending = { platform: $2('input[name="platform"]:checked').value, minutes: Number($2("#minutes").value), reason: $2("#reason").value, alternative: data.settings.alternative };
      try {
        createSession(pending);
      } catch {
        toast("请输入 1–180 之间的整数分钟。");
        return;
      }
      if (data.settings.sound) startAudio();
      pauseUntil = Date.now() + data.settings.delaySeconds * 1e3;
      $2("#pause-status").textContent = "短暂停顿中";
      openDialog($2("#pause-dialog"));
      tick();
    });
    $2("#skip-watch").addEventListener("click", () => {
      closeDialog("pause-dialog");
      pending = null;
      toast("这次先不看。" + data.settings.alternative + "。");
    });
    $2("#confirm-watch").addEventListener("click", () => {
      if (!pending || Date.now() < pauseUntil) return;
      sync();
      if (data.active) {
        closeDialog("pause-dialog");
        route("now");
        toast("另一页已开始计时，已恢复当前计划。");
        return;
      }
      try {
        data.active = createSession(pending);
        data.settings.minutes = pending.minutes;
        save();
        announcedId = null;
        closeDialog("pause-dialog");
        pending = null;
        route("now");
        mobile.schedule(data.active);
      } catch {
        toast("开始失败，请检查分钟数后重试。");
      }
    });
    $2("#finish-button").addEventListener("click", () => {
      sync();
      if (!data.active) {
        route("now");
        return;
      }
      finishAt = Date.now();
      $2("#outcome").value = "stopped";
      $2("#mood").value = "skip";
      $2("#end-alternative").textContent = data.active.alternative + "。不需要为这次表现打分。";
      $2("#end-dialog").dataset.sessionId = data.active.id;
      openDialog($2("#end-dialog"));
    });
    $2("#end-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const expected = $2("#end-dialog").dataset.sessionId;
      sync();
      if (!data.active || data.active.id !== expected) {
        closeDialog("end-dialog");
        route("now");
        toast("这段计时已在另一页处理，未重复保存。");
        return;
      }
      const record2 = finishSession(data.active, { outcome: $2("#outcome").value, mood: $2("#mood").value }, Math.max(data.active.startedAt, finishAt || Date.now()));
      data.history = [record2, ...data.history.filter((h) => h.id !== record2.id)].slice(0, 500);
      mobile.cancel(data.active.id);
      data.active = null;
      save();
      closeDialog("end-dialog");
      route("review");
      toast(persistent ? "这次回顾已保存在本机。" : "这次回顾暂存在页面内，请导出以保留。");
    });
    $2("#settings-form").addEventListener("submit", (e) => {
      e.preventDefault();
      sync();
      data.settings = { minutes: Number($2("#setting-minutes").value), delaySeconds: Number($2("#setting-delay").value), alternative: $2("#setting-alternative").value, sound: $2("#setting-sound").checked };
      if (data.settings.sound) startAudio();
      save();
      renderPlan();
      toast(persistent ? "约定已保存，下次开始时生效。" : "约定暂存在页面内，刷新后可能丢失。");
    });
    $2("#export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ exportedAt: (/* @__PURE__ */ new Date()).toISOString(), description: "用户主动计时，非真实观看监测", ...data }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pause-before-scroll-records.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
      toast("已发起下载。导出文件含你的个人记录，请自行保管。");
    });
    $2("#clear-data").addEventListener("click", () => openDialog($2("#clear-dialog")));
    $2("#confirm-clear").addEventListener("click", () => {
      var _a;
      mobile.cancel((_a = data.active) == null ? void 0 : _a.id);
      data = defaultData();
      save();
      closeDialog("clear-dialog");
      announcedId = null;
      renderPlan();
      renderSettings();
      route("now");
      toast(persistent ? "本机计时、回顾和约定已清除。手机通知开关保持原样。" : "页面内数据已清除；浏览器存储不可用，无法确认其中的旧数据已删除。");
    });
    let feedbackDraft = null, submitting = false;
    $2("#feedback-form").addEventListener("input", () => {
      if (!submitting) {
        feedbackDraft = null;
        $2("#feedback-preview").hidden = true;
      }
    });
    $2("#feedback-form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (submitting) return;
      const title = $2("#feedback-title").value.trim(), body = $2("#feedback-body").value.trim();
      if (!title || !body) {
        toast("请填写具体的标题和反馈内容。");
        return;
      }
      feedbackDraft = { requestId: (feedbackDraft == null ? void 0 : feedbackDraft.requestId) || randomId(), category: $2("#feedback-category").value, title, body, consent: $2("#feedback-consent").checked };
      $2("#feedback-text").textContent = "类型：" + feedbackDraft.category + "\n\n" + title + "\n\n" + body;
      $2("#feedback-result").textContent = "";
      $2("#feedback-submit").disabled = false;
      $2("#feedback-submit").textContent = "确认提交匿名反馈 →";
      $2("#feedback-preview").hidden = false;
      $2("#feedback-preview").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    });
    $2("#feedback-submit").addEventListener("click", async () => {
      if (!feedbackDraft || submitting) return;
      submitting = true;
      const draft = { ...feedbackDraft };
      const fields = [...document.querySelectorAll("#feedback-form input,#feedback-form select,#feedback-form textarea,#feedback-form button")];
      fields.forEach((field) => field.disabled = true);
      const button = $2("#feedback-submit");
      button.disabled = true;
      button.textContent = "正在保存…";
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15e3);
      try {
        const challenge = await fetch(apiUrl("/api/feedback/token"), { headers: feedbackTicket ? { "X-Feedback-Token": feedbackTicket } : {}, signal: controller.signal });
        const ticket = await challenge.json();
        if (!challenge.ok) throw new Error(ticket.error || "暂时无法提交");
        feedbackTicket = ticket.token;
        const response = await fetch(apiUrl("/api/feedback"), { method: "POST", headers: { "Content-Type": "application/json", "X-Feedback-Token": ticket.token }, body: JSON.stringify(draft), signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "保存失败");
        $2("#feedback-result").textContent = "已保存，谢谢你的反馈。回执编号：" + result.id;
        button.textContent = "已提交";
        feedbackDraft = null;
        $2("#feedback-form").reset();
      } catch (error) {
        $2("#feedback-result").textContent = error.name === "AbortError" ? "请求超时，结果尚未确认。请稍后再试；填写内容仍在。" : error.message || "网络连接失败，内容仍保留，请稍后重试。";
        button.disabled = false;
        button.textContent = "重试提交";
      } finally {
        clearTimeout(timeout);
        submitting = false;
        fields.forEach((field) => field.disabled = false);
      }
    });
    $2("#enable-sound").addEventListener("click", startAudio);
    $$("[data-open-mobile]").forEach((button) => button.addEventListener("click", () => {
      route("settings");
      $2("#mobile-panel").scrollIntoView({ block: "start", behavior: "smooth" });
    }));
    $2("#due-finish").addEventListener("click", () => {
      closeDialog("due-dialog");
      $2("#finish-button").click();
    });
    window.addEventListener("storage", (e) => {
      if (e.key !== KEY2 && e.key !== null) return;
      sync();
      if (current === "now") route("now");
      if (current === "review") renderReview();
      tick();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        sync();
        route(current);
        tick();
      }
    });
    renderPlan();
    route("now");
    tick();
    setInterval(tick, 500);
    try {
      mobile = initMobile(() => data.active);
    } catch {
      document.querySelector("#mobile-status").textContent = "此浏览器暂时不能开启手机通知。计时与回顾仍可使用，请配合手机自带计时器。";
    }
  }

  // docs/entry.mjs
  if (!window.__pauseLocalFile) {
    try {
      installDOMCompatibility();
      startApp();
      window.__pauseStarted = true;
      document.getElementById("startup-help").hidden = true;
    } catch {
      window.pauseStartupFailure("页面未能正常启动。请刷新一次；若仍无反应，请在手机自带浏览器中打开下方在线地址。");
    }
  }
})();

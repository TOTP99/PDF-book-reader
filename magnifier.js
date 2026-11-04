/* 书页长按放大镜
 * 在阅读器的书页上长按（手机：按住不动；电脑：按住鼠标不动），出现圆形放大镜，
 * 手指/鼠标移动时放大镜跟随，松开即消失。长按期间不会翻页、不会拖动页面。
 * 只读取 #viewer 画布，不依赖 index.html 里的其他代码。
 */
(function () {
  "use strict";

  /* ---- 可调参数 ---- */
  var DELAY   = 420;  // 长按多久出现放大镜（毫秒）
  var ZOOM    = 2.4;  // 放大倍数（相对当前屏幕上看到的大小）
  var SIZE    = 160;  // 放大镜直径（像素）
  var LIFT    = 84;   // 触屏时放大镜上移的距离，避免被手指挡住
  var SLOP    = 10;   // 按住期间允许的抖动范围，超出视为滑动/拖动

  var stage = document.getElementById("stage");
  var canvas = document.getElementById("viewer");
  if (!stage || !canvas) return;

  /* ---- 样式 ---- */
  var css = document.createElement("style");
  css.textContent =
    "#mg-lens{position:fixed;left:0;top:0;z-index:9999;border-radius:50%;pointer-events:none;overflow:hidden;" +
    "border:2px solid rgba(201,162,39,.95);background:#141414;opacity:0;transform:scale(.85);" +
    "transition:opacity .12s ease,transform .12s ease;" +
    "box-shadow:0 10px 32px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.6),inset 0 0 14px rgba(0,0,0,.35)}" +
    "#mg-lens.on{opacity:1;transform:scale(1)}" +
    "#mg-lens canvas{display:block;width:100%;height:100%}" +
    "#mg-lens::after{content:'';position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;" +
    "border-radius:50%;background:rgba(201,162,39,.7)}" +
    "body.mg-lens-active,body.mg-lens-active *{-webkit-user-select:none!important;user-select:none!important;" +
    "-webkit-touch-callout:none!important;cursor:none!important}" +
    "#stage{-webkit-touch-callout:none}";
  document.head.appendChild(css);

  var lens = document.createElement("div");
  lens.id = "mg-lens";
  var lc = document.createElement("canvas");
  lens.appendChild(lc);
  document.body.appendChild(lens);
  var lctx = lc.getContext("2d");

  /* ---- 状态 ---- */
  var timer = null, active = false, isTouch = false;
  var sx = 0, sy = 0, cx = 0, cy = 0, raf = 0, swallowClick = false;

  function size() {
    return Math.min(SIZE, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.5));
  }

  function draw() {
    raf = 0;
    if (!active || canvas.hidden || !canvas.width) return;
    var L = size(), dpr = Math.min(window.devicePixelRatio || 1, 3);
    var px = Math.round(L * dpr);
    if (lc.width !== px) { lc.width = px; lc.height = px; }
    lens.style.width = lens.style.height = L + "px";

    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var kx = canvas.width / r.width, ky = canvas.height / r.height;
    var regionW = L / ZOOM, regionH = L / ZOOM;          // 屏幕上被放大的区域
    var srcX = (cx - r.left - regionW / 2) * kx;
    var srcY = (cy - r.top - regionH / 2) * ky;
    var srcW = regionW * kx, srcH = regionH * ky;

    lctx.fillStyle = "#141414";
    lctx.fillRect(0, 0, px, px);
    // 区域超出页面边缘时，只绘制与画布相交的部分
    var x0 = Math.max(0, srcX), y0 = Math.max(0, srcY);
    var x1 = Math.min(canvas.width, srcX + srcW), y1 = Math.min(canvas.height, srcY + srcH);
    if (x1 > x0 && y1 > y0) {
      var k = px / srcW, j = px / srcH;
      try {
        lctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0,
          (x0 - srcX) * k, (y0 - srcY) * j, (x1 - x0) * k, (y1 - y0) * j);
      } catch (e) {}
    }
    lc.style.filter = getComputedStyle(canvas).filter; // 夜间护眼模式同步

    // 位置：触屏时在手指上方，顶部放不下则放到下方
    var lx = cx - L / 2, ly = isTouch ? cy - LIFT - L / 2 : cy - L / 2;
    if (isTouch && ly < 4) ly = cy + LIFT - L / 2;
    lx = Math.max(4, Math.min(window.innerWidth - L - 4, lx));
    ly = Math.max(4, Math.min(window.innerHeight - L - 4, ly));
    lens.style.left = lx + "px";
    lens.style.top = ly + "px";
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(draw); }

  function start() {
    timer = null;
    if (canvas.hidden) return;
    active = true;
    document.body.classList.add("mg-lens-active");
    try { var s = window.getSelection(); if (s) s.removeAllRanges(); } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
    lens.classList.add("on");
    draw();
  }
  function cancelTimer() { if (timer) { clearTimeout(timer); timer = null; } }
  function stop() {
    cancelTimer();
    if (!active) return;
    active = false;
    lens.classList.remove("on");
    document.body.classList.remove("mg-lens-active");
  }
  function inStage(t) {
    return t && t.closest && t.closest("#stage") && !t.closest(".loading");
  }
  function kill(e) { e.stopImmediatePropagation(); e.stopPropagation(); }

  /* ---- 触屏（捕获阶段，抢在翻页/拖动手势之前） ---- */
  window.addEventListener("touchstart", function (e) {
    stop();
    if (e.touches.length !== 1 || !inStage(e.target) || canvas.hidden) return;
    isTouch = true;
    sx = cx = e.touches[0].clientX; sy = cy = e.touches[0].clientY;
    timer = setTimeout(start, DELAY);
  }, { capture: true, passive: true });

  window.addEventListener("touchmove", function (e) {
    if (e.touches.length !== 1) { stop(); return; }
    var t = e.touches[0];
    if (active) {
      e.preventDefault(); kill(e);
      cx = t.clientX; cy = t.clientY; schedule();
    } else if (timer && Math.hypot(t.clientX - sx, t.clientY - sy) > SLOP) {
      cancelTimer();
    }
  }, { capture: true, passive: false });

  function touchEnd(e) {
    if (active) { e.preventDefault(); kill(e); }   // 不翻页、不触发点按
    stop();
  }
  window.addEventListener("touchend", touchEnd, { capture: true, passive: false });
  window.addEventListener("touchcancel", touchEnd, { capture: true, passive: false });

  /* ---- 鼠标 ---- */
  window.addEventListener("mousedown", function (e) {
    if (e.button !== 0 || !inStage(e.target) || canvas.hidden) return;
    if (isTouch && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
    isTouch = false;
    sx = cx = e.clientX; sy = cy = e.clientY;
    cancelTimer();
    timer = setTimeout(start, DELAY);
  }, true);

  window.addEventListener("mousemove", function (e) {
    if (active) {
      kill(e); cx = e.clientX; cy = e.clientY; schedule();
    } else if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > SLOP) {
      cancelTimer();
    }
  }, true);

  window.addEventListener("mouseup", function (e) {
    if (active) { kill(e); swallowClick = true; setTimeout(function () { swallowClick = false; }, 80); }
    stop();
  }, true);

  // 长按结束后浏览器仍会补发一次 click，吞掉以免误翻页/呼出工具栏
  window.addEventListener("click", function (e) {
    if (swallowClick) { swallowClick = false; e.preventDefault(); kill(e); }
  }, true);

  // 长按期间禁止系统右键/复制菜单
  window.addEventListener("contextmenu", function (e) {
    if (active || timer) e.preventDefault();
  }, true);

  // 其他情况下收起放大镜
  window.addEventListener("blur", stop);
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); });
  window.addEventListener("keydown", function (e) { if (e.key === "Escape") stop(); }, true);
})();

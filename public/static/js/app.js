// 进销通 · 前端交互（无框架，原生 JS）
(function () {
  "use strict";

  // ---------- 提示条（msg / err 查询参数） ----------
  function flash() {
    var params = new URLSearchParams(location.search);
    var msg = params.get("msg"), err = params.get("err");
    if (!msg && !err) return;
    var box = document.getElementById("flashBox");
    if (!box) return;
    box.textContent = (err ? "❌ " : "✅ ") + (err || msg);
    box.className = "flash show " + (err ? "err" : "ok");
    params.delete("msg"); params.delete("err");
    var q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : ""));
    setTimeout(function () { box.classList.remove("show"); }, 6000);
  }

  // ---------- 二次确认 ----------
  function confirmHook() {
    document.querySelectorAll("[data-confirm]").forEach(function (el) {
      el.addEventListener(el.tagName === "FORM" ? "submit" : "click", function (e) {
        if (!window.confirm(el.getAttribute("data-confirm"))) e.preventDefault();
      });
    });
  }

  // ---------- 移动端侧边栏 ----------
  function sidebar() {
    var btn = document.getElementById("menuToggle");
    if (btn) btn.addEventListener("click", function () {
      document.body.classList.toggle("sidebar-open");
    });
  }

  // ---------- 图片上传预览 ----------
  function imgPreview() {
    document.querySelectorAll('input[type="file"][data-preview]').forEach(function (input) {
      input.addEventListener("change", function () {
        var target = document.querySelector(input.getAttribute("data-preview"));
        var f = input.files && input.files[0];
        if (target && f) {
          target.src = URL.createObjectURL(f);
          target.style.display = "block";
        }
      });
    });
  }

  // ---------- 订单明细动态行 ----------
  function orderItems() {
    var box = document.getElementById("orderItems");
    if (!box) return;
    var addBtn = document.querySelector('[data-action="add-row"]');
    var totalEl = document.getElementById("orderTotal");

    function recalc() {
      var total = 0;
      box.querySelectorAll(".item-row").forEach(function (row) {
        var q = parseFloat(row.querySelector("[data-role=item-qty]").value) || 0;
        var p = parseFloat(row.querySelector("[data-role=item-price]").value) || 0;
        var amt = Math.round(q * p * 100) / 100;
        var amtEl = row.querySelector("[data-role=item-amount]");
        if (amtEl) amtEl.textContent = "¥" + amt.toFixed(2);
        total += amt;
      });
      if (totalEl) totalEl.innerHTML = "合计：<span>¥" + total.toFixed(2) + "</span>";
    }

    function bindRow(row) {
      var sel = row.querySelector("[data-role=item-product]");
      var qty = row.querySelector("[data-role=item-qty]");
      var price = row.querySelector("[data-role=item-price]");
      if (sel && price) sel.addEventListener("change", function () {
        var opt = sel.selectedOptions[0];
        var dp = opt && opt.getAttribute("data-price");
        if (dp) price.value = dp;
        recalc();
      });
      [qty, price].forEach(function (el) {
        if (el) el.addEventListener("input", recalc);
      });
      var del = row.querySelector('[data-action="remove-row"]');
      if (del) del.addEventListener("click", function () {
        if (box.querySelectorAll(".item-row").length > 1) { row.remove(); recalc(); }
        else window.alert("至少保留一件商品");
      });
    }

    box.querySelectorAll(".item-row").forEach(bindRow);
    if (addBtn) addBtn.addEventListener("click", function () {
      var first = box.querySelector(".item-row");
      if (!first) return;
      var clone = first.cloneNode(true);
      clone.querySelectorAll("input").forEach(function (i) { i.value = i.type === "number" ? "" : i.value; });
      clone.querySelectorAll("select").forEach(function (s) { s.selectedIndex = 0; });
      var amtEl = clone.querySelector("[data-role=item-amount]");
      if (amtEl) amtEl.textContent = "¥0.00";
      box.appendChild(clone);
      bindRow(clone);
    });
    recalc();
  }

  // ---------- 销售级别切换（上级选择显隐） ----------
  function salesLevel() {
    var levelSel = document.querySelector('[data-role="sales-level"]');
    var parentRow = document.getElementById("parentRow");
    if (!levelSel || !parentRow) return;
    function toggle() { parentRow.style.display = levelSel.value === "2" ? "" : "none"; }
    levelSel.addEventListener("change", toggle);
    toggle();
  }

  // ---------- 14 天销售趋势图 ----------
  function trendChart() {
    var cv = document.getElementById("trendChart");
    if (!cv || !cv.getAttribute("data-trend")) return;
    var data;
    try { data = JSON.parse(cv.getAttribute("data-trend")); } catch (e) { return; }
    if (!data.length) return;
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    var ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    var max = Math.max.apply(null, data.map(function (d) { return d.total; }).concat([1]));
    var pad = { l: 8, r: 8, t: 14, b: 26 };
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    var stepX = data.length > 1 ? iw / (data.length - 1) : 0;
    function x(i) { return pad.l + i * stepX; }
    function y(v) { return pad.t + ih - (v / max) * ih; }
    // 网格线
    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = pad.t + (ih / 4) * g;
      ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
    }
    // 面积
    var grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    grad.addColorStop(0, "rgba(37,99,235,.25)"); grad.addColorStop(1, "rgba(37,99,235,0)");
    ctx.beginPath();
    data.forEach(function (d, i) { i ? ctx.lineTo(x(i), y(d.total)) : ctx.moveTo(x(i), y(d.total)); });
    ctx.lineTo(x(data.length - 1), h - pad.b); ctx.lineTo(x(0), h - pad.b); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // 折线
    ctx.beginPath();
    data.forEach(function (d, i) { i ? ctx.lineTo(x(i), y(d.total)) : ctx.moveTo(x(i), y(d.total)); });
    ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();
    // 点
    ctx.fillStyle = "#2563eb";
    data.forEach(function (d, i) { ctx.beginPath(); ctx.arc(x(i), y(d.total), 3, 0, 7); ctx.fill(); });
    // 日期标签（隔一个显示）
    ctx.fillStyle = "#6b7280"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
    data.forEach(function (d, i) {
      if (i % 2 === 0) ctx.fillText(d.date.slice(5), x(i), h - 8);
    });
  }

  // ---------- 用户表单：按角色显隐销售/客户专属字段 ----------
  function roleSections() {
    var sel = document.getElementById("roleSelect");
    if (!sel) return;
    function toggle() {
      var role = sel.value;
      document.querySelectorAll("[data-show-for]").forEach(function (el) {
        el.style.display = el.getAttribute("data-show-for") === role ? "" : "none";
      });
    }
    sel.addEventListener("change", toggle);
    toggle();
  }

  // ---------- 盘点：选中商品后显示当前账面库存 ----------
  function adjustStockHint() {
    var sel = document.getElementById("adjustProduct");
    var hint = document.getElementById("adjustCurrentStock");
    if (!sel || !hint) return;
    function show() {
      var opt = sel.selectedOptions[0];
      var st = opt && opt.getAttribute("data-stock");
      hint.textContent = st !== null && st !== undefined ? "当前账面库存：" + st : "";
    }
    sel.addEventListener("change", show);
    show();
  }

  document.addEventListener("DOMContentLoaded", function () {
    flash(); confirmHook(); sidebar(); imgPreview(); orderItems(); salesLevel(); trendChart();
    roleSections(); adjustStockHint();
  });
  window.addEventListener("resize", function () { trendChart(); });
})();

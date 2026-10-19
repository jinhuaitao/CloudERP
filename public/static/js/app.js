// 进销通 Jinxiao ERP v2.0 · 前端交互脚本（原生 JS，无外部依赖）
(function () {
  "use strict";

  // 防止重复初始化保护锁
  if (window.__JINXIAO_INIT__) return;
  window.__JINXIAO_INIT__ = true;

  // ---------- 1. 深浅色主题切换 ----------
  function initTheme() {
    try {
      var saved = localStorage.getItem("jinxiao_theme");
      if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");
    } catch (e) {}
    var btn = document.getElementById("themeToggle");
    if (btn) {
      btn.addEventListener("click", function () {
        var isDark = document.documentElement.getAttribute("data-theme") === "dark";
        if (isDark) {
          document.documentElement.removeAttribute("data-theme");
          try { localStorage.setItem("jinxiao_theme", "light"); } catch (e) {}
        } else {
          document.documentElement.setAttribute("data-theme", "dark");
          try { localStorage.setItem("jinxiao_theme", "dark"); } catch (e) {}
        }
        trendChart();
      });
    }
  }

  // ---------- 2. 提示条（msg / err 查询参数） ----------
  function flash() {
    var params = new URLSearchParams(location.search);
    var msg = params.get("msg"), err = params.get("err");
    if (!msg && !err) return;
    var box = document.getElementById("flashBox");
    if (!box) return;
    box.textContent = (err ? "❌ " : "✅ ") + (err || msg);
    box.className = "flash show " + (err ? "err" : "ok");
    params.delete("msg");
    params.delete("err");
    var q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : ""));
    setTimeout(function () { box.classList.remove("show"); }, 6000);
  }

  // ---------- 3. 二次确认 ----------
  function confirmHook() {
    document.querySelectorAll("[data-confirm]").forEach(function (el) {
      el.addEventListener(el.tagName === "FORM" ? "submit" : "click", function (e) {
        if (!window.confirm(el.getAttribute("data-confirm"))) e.preventDefault();
      });
    });
  }

  // ---------- 4. 移动端侧边栏与打印按钮 ----------
  function sidebarAndActions() {
    var btn = document.getElementById("menuToggle");
    var overlay = document.getElementById("sidebarOverlay");
    if (btn) {
      btn.addEventListener("click", function () {
        document.body.classList.toggle("sidebar-open");
      });
    }
    if (overlay) {
      overlay.addEventListener("click", function () {
        document.body.classList.remove("sidebar-open");
      });
    }
    document.querySelectorAll('[data-action="print-doc"]').forEach(function (pBtn) {
      pBtn.addEventListener("click", function () {
        window.print();
      });
    });
  }

  // ---------- 5. 图片上传预览 ----------
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

  // ---------- 6. 订单明细动态行与折扣/实收联动 ----------
  function orderItems() {
    var box = document.getElementById("orderItems");
    if (!box) return;
    var addBtns = document.querySelectorAll('[data-action="add-row"]');
    var totalEl = document.getElementById("orderTotal");
    var discountInput = document.getElementById("discountInput");
    var paidInput = document.getElementById("paidInput");
    var fillFullPaidBtn = document.getElementById("fillFullPaidBtn");
    var currentReceivable = 0;
    var userEditedPaid = false;

    if (paidInput) {
      paidInput.addEventListener("input", function () {
        userEditedPaid = true;
        recalc();
      });
    }
    if (discountInput) {
      discountInput.addEventListener("input", recalc);
    }
    if (fillFullPaidBtn && paidInput) {
      fillFullPaidBtn.addEventListener("click", function () {
        paidInput.value = currentReceivable.toFixed(2);
        userEditedPaid = true;
        recalc();
      });
    }

    function recalc() {
      var subtotal = 0;
      box.querySelectorAll(".item-row").forEach(function (row) {
        var qEl = row.querySelector("[data-role=item-qty]");
        var pEl = row.querySelector("[data-role=item-price]");
        var q = qEl ? parseFloat(qEl.value) || 0 : 0;
        var p = pEl ? parseFloat(pEl.value) || 0 : 0;
        var amt = Math.round(q * p * 100) / 100;
        var amtEl = row.querySelector("[data-role=item-amount]");
        if (amtEl) amtEl.textContent = "¥" + amt.toFixed(2);
        subtotal += amt;
      });
      var discount = discountInput ? Math.max(0, parseFloat(discountInput.value) || 0) : 0;
      currentReceivable = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
      if (paidInput && !userEditedPaid && discountInput) {
        paidInput.value = currentReceivable.toFixed(2);
      }
      if (totalEl) {
        if (discountInput) {
          var paidVal = paidInput ? parseFloat(paidInput.value) || 0 : 0;
          var debt = Math.max(0, Math.round((currentReceivable - paidVal) * 100) / 100);
          totalEl.innerHTML =
            "小计：¥" + subtotal.toFixed(2) +
            (discount > 0 ? " - 优惠：¥" + discount.toFixed(2) : "") +
            " ＝ 折后应收：<span>¥" + currentReceivable.toFixed(2) + "</span>" +
            (debt > 0 ? ' <small class="neg">（挂账欠款 ¥' + debt.toFixed(2) + "）</small>" : "");
        } else {
          totalEl.innerHTML = "单据合计：<span>¥" + subtotal.toFixed(2) + "</span>";
        }
      }
    }

    function bindRow(row) {
      var sel = row.querySelector("[data-role=item-product]");
      var qty = row.querySelector("[data-role=item-qty]");
      var price = row.querySelector("[data-role=item-price]");
      if (sel && price) {
        sel.addEventListener("change", function () {
          var opt = sel.selectedOptions[0];
          var dp = opt && opt.getAttribute("data-price");
          if (dp) price.value = dp;
          recalc();
        });
      }
      [qty, price].forEach(function (el) {
        if (el) el.addEventListener("input", recalc);
      });
      var del = row.querySelector('[data-action="remove-row"]');
      if (del) {
        del.addEventListener("click", function () {
          if (box.querySelectorAll(".item-row").length > 1) {
            row.remove();
            recalc();
          } else {
            window.alert("一张单据至少需要保留一行商品明细");
          }
        });
      }
    }

    box.querySelectorAll(".item-row").forEach(bindRow);
    addBtns.forEach(function (addBtn) {
      addBtn.addEventListener("click", function () {
        var first = box.querySelector(".item-row");
        if (!first) return;
        var clone = first.cloneNode(true);
        clone.querySelectorAll("input").forEach(function (i) {
          i.value = i.getAttribute("data-role") === "item-qty" ? "1" : "";
        });
        clone.querySelectorAll("select").forEach(function (s) {
          s.selectedIndex = 0;
        });
        var amtEl = clone.querySelector("[data-role=item-amount]");
        if (amtEl) amtEl.textContent = "¥0.00";
        box.appendChild(clone);
        bindRow(clone);
        recalc();
      });
    });
    recalc();
  }

  // ---------- 7. 销售级别切换（上级选择显隐） ----------
  function salesLevel() {
    var levelSel = document.querySelector('[data-role="sales-level"]');
    var parentRow = document.getElementById("parentRow");
    if (!levelSel || !parentRow) return;
    function toggle() {
      parentRow.style.display = levelSel.value === "2" ? "" : "none";
    }
    levelSel.addEventListener("change", toggle);
    toggle();
  }

  // ---------- 8. 近 14 天销售趋势图（带悬停交互提示） ----------
  function trendChart() {
    var cv = document.getElementById("trendChart");
    if (!cv || !cv.getAttribute("data-trend")) return;
    var data;
    try {
      data = JSON.parse(cv.getAttribute("data-trend"));
    } catch (e) {
      return;
    }
    if (!data.length) return;
    var isDark = document.documentElement.getAttribute("data-theme") === "dark";
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 600;
    var h = cv.clientHeight || 250;
    cv.width = w * dpr;
    cv.height = h * dpr;
    var ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    var max = Math.max.apply(null, data.map(function (d) { return d.total; }).concat([100]));
    var pad = { l: 48, r: 16, t: 18, b: 30 };
    var iw = w - pad.l - pad.r;
    var ih = h - pad.t - pad.b;
    var stepX = data.length > 1 ? iw / (data.length - 1) : 0;
    function x(i) { return pad.l + i * stepX; }
    function y(v) { return pad.t + ih - (v / max) * ih; }

    // 水平网格线与 Y 轴刻度
    ctx.strokeStyle = isDark ? "#334155" : "#e2e8f0";
    ctx.fillStyle = isDark ? "#94a3b8" : "#64748b";
    ctx.font = "11px sans-serif";
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = pad.t + (ih / 4) * g;
      var val = Math.round(max * (1 - g / 4));
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(w - pad.r, gy);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText("¥" + (val >= 1000 ? (val / 1000).toFixed(1) + "k" : val), pad.l - 6, gy + 4);
    }

    // 渐变面积填充
    var grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    grad.addColorStop(0, "rgba(37, 99, 235, 0.32)");
    grad.addColorStop(1, "rgba(37, 99, 235, 0.0)");
    ctx.beginPath();
    data.forEach(function (d, i) {
      i ? ctx.lineTo(x(i), y(d.total)) : ctx.moveTo(x(i), y(d.total));
    });
    ctx.lineTo(x(data.length - 1), h - pad.b);
    ctx.lineTo(x(0), h - pad.b);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 折线
    ctx.beginPath();
    data.forEach(function (d, i) {
      i ? ctx.lineTo(x(i), y(d.total)) : ctx.moveTo(x(i), y(d.total));
    });
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // 数据圆点与 X 轴日期
    ctx.textAlign = "center";
    data.forEach(function (d, i) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x(i), y(d.total), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2;
      ctx.stroke();

      if (i % 2 === 0 || i === data.length - 1) {
        ctx.fillStyle = isDark ? "#94a3b8" : "#64748b";
        ctx.fillText(d.date.slice(5), x(i), h - 8);
      }
    });

    // 鼠标悬停提示
    var tooltip = document.getElementById("chartTooltip");
    if (tooltip && !cv.__boundHover) {
      cv.__boundHover = true;
      cv.addEventListener("mousemove", function (ev) {
        var rect = cv.getBoundingClientRect();
        var mx = ev.clientX - rect.left;
        var idx = Math.round((mx - pad.l) / stepX);
        if (idx >= 0 && idx < data.length) {
          var item = data[idx];
          tooltip.style.display = "block";
          tooltip.textContent = item.date + " · 销售额 ¥" + item.total.toFixed(2) + " (" + item.count + "笔)";
          var tx = Math.min(w - 180, Math.max(8, x(idx) - 60));
          var ty = Math.max(8, y(item.total) - 36);
          tooltip.style.left = tx + "px";
          tooltip.style.top = ty + "px";
        } else {
          tooltip.style.display = "none";
        }
      });
      cv.addEventListener("mouseleave", function () {
        tooltip.style.display = "none";
      });
    }
  }

  // ---------- 9. 用户表单：按角色显隐销售/客户专属字段 ----------
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

  // ---------- 10. 盘点：选中商品后实时显示账面库存与盈亏差额 ----------
  function adjustStockHint() {
    var sel = document.getElementById("adjustProduct");
    var hint = document.getElementById("adjustCurrentStock");
    var actualInput = document.getElementById("adjustActualQty");
    var diffEl = document.getElementById("adjustDiffPreview");
    if (!sel || !hint) return;
    function update() {
      var opt = sel.selectedOptions[0];
      var st = opt ? opt.getAttribute("data-stock") : null;
      var unit = (opt && opt.getAttribute("data-unit")) || "";
      if (st === null || st === undefined || st === "") {
        hint.textContent = "—";
        if (diffEl) diffEl.textContent = "—";
        return;
      }
      var cur = parseFloat(st) || 0;
      hint.textContent = cur + " " + unit;
      if (diffEl && actualInput && actualInput.value !== "") {
        var act = parseFloat(actualInput.value) || 0;
        var diff = Math.round((act - cur) * 100) / 100;
        diffEl.textContent = (diff > 0 ? "盘盈 +" : diff < 0 ? "盘亏 " : "无差异 ") + diff + " " + unit;
        diffEl.className = diff > 0 ? "pos" : diff < 0 ? "neg" : "";
      } else if (diffEl) {
        diffEl.textContent = "—";
        diffEl.className = "";
      }
    }
    sel.addEventListener("change", update);
    if (actualInput) actualInput.addEventListener("input", update);
    update();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    flash();
    confirmHook();
    sidebarAndActions();
    imgPreview();
    orderItems();
    salesLevel();
    trendChart();
    roleSections();
    adjustStockHint();
  });
  window.addEventListener("resize", function () {
    trendChart();
  });
})();

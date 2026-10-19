// 进销通 Jinxiao ERP v2.0 · 前端交互脚本（原生 JS，无外部依赖）
(function () {
  "use strict";

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

  // ---------- 5. 图片上传预览（含商品图、微信收款码、支付宝收款码） ----------
  function imgPreview() {
    document.querySelectorAll('input[type="file"][data-preview]').forEach(function (input) {
      input.addEventListener("change", function () {
        var sel = input.getAttribute("data-preview");
        var target = document.querySelector(sel);
        var f = input.files && input.files[0];
        if (target && f) {
          target.src = URL.createObjectURL(f);
          target.style.display = "block";
          var parentWrap = target.closest(".payqr-preview-wrap");
          if (parentWrap) {
            var emptyEl = parentWrap.querySelector(".payqr-empty");
            if (emptyEl) emptyEl.style.display = "none";
          }
        }
      });
    });
  }

  // ---------- 5b. 收款方式切换时高亮对应微信/支付宝二维码卡片 ----------
  function paymentQrSwitcher() {
    var paySel = document.getElementById("paymentSelect");
    var qrBox = document.getElementById("paymentQrBox");
    if (!paySel || !qrBox) return;
    function syncActive() {
      var val = paySel.value;
      qrBox.querySelectorAll("[data-payqr-card]").forEach(function (card) {
        var kind = card.getAttribute("data-payqr-card");
        card.classList.toggle("active", kind === val);
      });
    }
    paySel.addEventListener("change", syncActive);
    syncActive();
  }

  // ---------- 6. 订单明细动态行、客户收货地址自动带出与折扣/实收联动 ----------
  function orderItems() {
    var box = document.getElementById("orderItems");
    if (!box) return;
    var addBtns = document.querySelectorAll('[data-action="add-row"]');
    var totalEl = document.getElementById("orderTotal");
    var discountInput = document.getElementById("discountInput");
    var paidInput = document.getElementById("paidInput");
    var fillFullPaidBtn = document.getElementById("fillFullPaidBtn");
    var customerSelect = document.getElementById("customerSelect");
    var shipNameInput = document.getElementById("shippingNameInput");
    var shipPhoneInput = document.getElementById("shippingPhoneInput");
    var shipAddrInput = document.getElementById("shippingAddressInput");
    var currentReceivable = 0;
    var userEditedPaid = false;

    // 选中客户时自动带出其保存的收货人、联系电话、收货地址
    if (customerSelect) {
      customerSelect.addEventListener("change", function () {
        var opt = customerSelect.selectedOptions[0];
        if (!opt) return;
        if (shipNameInput) shipNameInput.value = opt.getAttribute("data-shipping-name") || "";
        if (shipPhoneInput) shipPhoneInput.value = opt.getAttribute("data-phone") || "";
        if (shipAddrInput) shipAddrInput.value = opt.getAttribute("data-address") || "";
      });
    }

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
          var cartId = row.getAttribute("data-cart-id");
          if (box.querySelectorAll(".item-row").length > 1) {
            if (cartId) cartRemove(Number(cartId));
            row.remove();
            recalc();
          } else if (cartId) {
            // 最后一行来自购物车：删除即移出购物车并还原为空行，不阻断操作
            cartRemove(Number(cartId));
            row.removeAttribute("data-cart-id");
            var selEl = row.querySelector("[data-role=item-product]");
            var qtyEl = row.querySelector("[data-role=item-qty]");
            var priceEl = row.querySelector("[data-role=item-price]");
            var amtBox = row.querySelector("[data-role=item-amount]");
            if (selEl) selEl.selectedIndex = 0;
            if (qtyEl) qtyEl.value = "1";
            if (priceEl) priceEl.value = "";
            if (amtBox) amtBox.textContent = "¥0.00";
            recalc();
            toast("已从购物车移除该商品");
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

    ctx.beginPath();
    data.forEach(function (d, i) {
      i ? ctx.lineTo(x(i), y(d.total)) : ctx.moveTo(x(i), y(d.total));
    });
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();

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

  // ---------- 11. 订货购物车（商品目录加入 → 自助下单自动带入） ----------
  var CART_COOKIE = "jc_cart";
  var CART_MAX_LINES = 30;

  function cartRead() {
    var m = document.cookie.match(/(?:^|;\s*)jc_cart=([^;]*)/);
    if (!m) return [];
    try {
      var arr = JSON.parse(decodeURIComponent(m[1]));
      if (!Array.isArray(arr)) return [];
      var out = [];
      arr.forEach(function (it) {
        var id = Array.isArray(it) ? Number(it[0]) : Number(it && it.i);
        var q = Array.isArray(it) ? Number(it[1]) : Number(it && it.q);
        var p = Array.isArray(it) ? Number(it[2]) : Number(it && it.p);
        if (id > 0 && q > 0) out.push({ i: id, q: q, p: p > 0 ? p : 0 });
      });
      return out.slice(0, CART_MAX_LINES);
    } catch (e) {
      return [];
    }
  }

  function cartWrite(items) {
    if (!items || !items.length) {
      document.cookie = CART_COOKIE + "=; path=/; max-age=0; samesite=lax";
      return;
    }
    var compact = items.slice(0, CART_MAX_LINES).map(function (it) {
      return [it.i, Math.round(it.q * 100) / 100, Math.round((it.p || 0) * 100) / 100];
    });
    document.cookie =
      CART_COOKIE +
      "=" +
      encodeURIComponent(JSON.stringify(compact)) +
      "; path=/; max-age=" +
      60 * 60 * 24 * 30 +
      "; samesite=lax";
  }

  function cartRemove(id) {
    cartWrite(
      cartRead().filter(function (it) {
        return it.i !== id;
      })
    );
  }

  function toast(msg, isErr) {
    var el = document.getElementById("jxToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "jxToast";
      el.className = "jx-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = "jx-toast show" + (isErr ? " err" : "");
    if (el.__timer) clearTimeout(el.__timer);
    el.__timer = setTimeout(function () {
      el.className = "jx-toast";
    }, 2200);
  }

  function catalogCart() {
    var grid = document.querySelector(".goods-grid");
    var bar = document.getElementById("cartBar");
    if (!grid || !bar) return;

    function render() {
      var items = cartRead();
      var total = 0;
      items.forEach(function (it) {
        total += it.q * it.p;
      });
      var countEl = document.getElementById("cartBarCount");
      var totalEl = document.getElementById("cartBarTotal");
      if (countEl) countEl.textContent = String(items.length);
      if (totalEl) totalEl.textContent = "¥" + total.toFixed(2);
      bar.hidden = items.length === 0;
      grid.querySelectorAll(".goods-card").forEach(function (card) {
        var pid = Number(card.getAttribute("data-pid"));
        var found = null;
        items.forEach(function (it) {
          if (it.i === pid) found = it;
        });
        var chip = card.querySelector("[data-incart]");
        card.classList.toggle("in-cart", !!found);
        if (chip) {
          chip.hidden = !found;
          chip.textContent = found
            ? "已在购物车：" + found.q + " " + (card.getAttribute("data-unit") || "")
            : "";
        }
      });
    }

    grid.addEventListener("click", function (e) {
      if (!e.target || !e.target.closest) return;
      var btn = e.target.closest("[data-add-cart]");
      if (!btn || btn.disabled) return;
      var card = btn.closest(".goods-card");
      if (!card) return;
      var id = Number(card.getAttribute("data-pid"));
      var price = parseFloat(card.getAttribute("data-price")) || 0;
      var stock = parseFloat(card.getAttribute("data-stock")) || 0;
      var name = card.getAttribute("data-name") || "商品";
      var qtyInput = card.querySelector("[data-cart-qty]");
      var addQty = qtyInput ? parseFloat(qtyInput.value) || 0 : 1;
      if (addQty <= 0) {
        toast("请先填写购买数量", true);
        return;
      }
      if (stock <= 0) {
        toast("「" + name + "」暂时缺货", true);
        return;
      }
      var items = cartRead();
      var target = null;
      items.forEach(function (it) {
        if (it.i === id) target = it;
      });
      if (target) {
        target.q = Math.min(stock, Math.round((target.q + addQty) * 100) / 100);
        target.p = price;
      } else {
        items.push({ i: id, q: Math.min(stock, addQty), p: price });
      }
      cartWrite(items);
      render();
      toast("已加入购物车：" + name);
      if (qtyInput) qtyInput.value = "1";
    });

    var clearBtn = bar.querySelector('[data-action="cart-clear"]');
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        if (!window.confirm("确定清空购物车吗？")) return;
        cartWrite([]);
        render();
        toast("购物车已清空");
      });
    }

    render();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    flash();
    confirmHook();
    sidebarAndActions();
    imgPreview();
    paymentQrSwitcher();
    orderItems();
    salesLevel();
    trendChart();
    roleSections();
    adjustStockHint();
    catalogCart();
  });
  window.addEventListener("resize", function () {
    trendChart();
  });
})();

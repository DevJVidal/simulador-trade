/* ======== Utils ======== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = (n, d = 2) =>
  Number(n).toLocaleString("pt-BR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
const nowBR = () => new Date().toLocaleString("pt-BR");

/* ======== Map de ícones (./assets/icon) ======== */
const iconFor = (sym) => {
  const base = sym.replace("USDT", "");
  const map = {
    BTC: "bitcoin.png",
    ETH: "ethereum.png",
    SOL: "solana.png",
    BNB: "binance.png",
    ADA: "cardano.png",
    XRP: "XRP1.png",
    DOGE: "dogecoin.png",
    DOT: "polkadot.png",
    MATIC: "polygon.png",
    AVAX: "avalanche.png",
    NEAR: "near.png",
    ATOM: "atom.png",
  };
  return `./assets/icon/${map[base] || `${base.toLowerCase()}.png`}`;
};

/* ======== Criptos ======== */
const symbols = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT",
  "XRPUSDT", "DOGEUSDT", "DOTUSDT", "MATICUSDT", "AVAXUSDT","ATOMUSDT","NEARUSDT"
];

/* ======== Estado ======== */
const state = {
  cash: 100000,
  equity: 10000,
  leverage: 1,
  active: "BTCUSDT",
  instruments: new Map(),
  trades: [],            
  ws: null,                
  last24h: { pct: 0 },     
};

symbols.forEach(sym => {
  state.instruments.set(sym, {
    symbol: sym,
    series: [],
    openOrders: [],   
    position: 0,
    avgPrice: 0,
  });
});

/* ======== UI refs ======== */
const el = {
  price: $("#price"),
  priceChange: $("#priceChange"),
  cash: $("#cash"),
  posVal: $("#posVal"),
  unrealized: $("#unrealized"),
  equity: $("#equity"),
  chart: $("#chart"),
  symbolTitle: $("#symbolTitle"),
  ordersTable: $("#ordersTable tbody"),
  tradesTable: $("#tradesTable tbody"),
  orderForm: $("#orderForm"),
  orderType: $("#orderType"),
  qty: $("#qty"),
  limitWrap: $("#limitWrap"),
  limitPrice: $("#limitPrice"),
  sideBuy: $("#sideBuy"),
  sideSell: $("#sideSell"),
  leverage: $("#leverage"),
  levVal: $("#levVal"),
  symbolSelect: $("#symbolSelect"),
  coinsBar: $("#coinsBar"),
  playBtn: $("#playBtn"),
  pauseBtn: $("#pauseBtn"),
  resetBtn: $("#resetBtn"),
  volInput: $("#volInput"),
  speedInput: $("#speedInput"),
};

const ctx = el.chart.getContext("2d");

/* ======== Chart (canvas) ======== */
function drawChart(series) {
  const width = (el.chart.width = el.chart.clientWidth || 1200);
  const height = (el.chart.height = 420);

  ctx.clearRect(0, 0, width, height);

  // Fundo gradiente azul/preto
  const gbg = ctx.createLinearGradient(0, 0, 0, height);
  gbg.addColorStop(0, "#061129");
  gbg.addColorStop(1, "#030916");
  ctx.fillStyle = gbg;
  ctx.fillRect(0, 0, width, height);

  // Grades suaves
  ctx.strokeStyle = "rgba(120,160,220,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const y = ((i + 1) * height) / 9;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (series.length < 2) return;
  const min = Math.min(...series),
    max = Math.max(...series);
  const pad = (max - min) * 0.1 || 1;
  const lo = min - pad,
    hi = max + pad;

  // Linha do preço (glow)
  ctx.lineWidth = 2;
  ctx.shadowColor = "#00c9ff";
  ctx.shadowBlur = 12;
  ctx.strokeStyle = "#6fd3ff";
  ctx.beginPath();
  series.forEach((v, i) => {
    const x = (i / (series.length - 1)) * width;
    const y = height - ((v - lo) / (hi - lo)) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ponto final
  const last = series.at(-1);
  const yLast = height - ((last - lo) / (hi - lo)) * height;
  ctx.fillStyle = "#00e5ff";
  ctx.beginPath();
  ctx.arc(width - 6, yLast, 4, 0, Math.PI * 2);
  ctx.fill();
}

/* ======== Binance ======== */
function connectWS(sym) {
  if (state.ws) {
    try { state.ws.close(); } catch {}
    state.ws = null;
  }
  const endpoint = `wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@trade`;
  const ws = new WebSocket(endpoint);
  state.ws = ws;

  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    const price = parseFloat(data.p);
    const inst = state.instruments.get(sym);
    if (!Number.isFinite(price)) return;

    inst.series.push(price);
    if (inst.series.length > 1200) inst.series.shift();


    tryFillLimits(inst, price);

    if (sym === state.active) recompute();
  };

  ws.onerror = (e) => console.error("WS error", e);
  ws.onclose = () => { /* pode reconectar se quiser */ };
}

async function refresh24h(sym) {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`
    );
    const data = await res.json();
    const pct = Number(data.priceChangePercent) || 0;
    state.last24h.pct = pct;
    el.priceChange.textContent = `${pct >= 0 ? "+" : ""}${fmt(pct, 2)}% 24h`;
    el.priceChange.style.color = pct >= 0 ? "var(--green)" : "var(--red)";
  } catch (e) {

  }
}
setInterval(() => refresh24h(state.active), 30000);

/* ======== Cálculos ======== */
function current() {
  return state.instruments.get(state.active);
}
function computeUnrealized(inst, price) {
  if (!inst || inst.position === 0) return 0;
  return (price - inst.avgPrice) * inst.position * state.leverage;
}

function recompute() {
  const inst = current();
  const price = inst.series.at(-1) || 0;
  const uPnL = computeUnrealized(inst, price);
  const posValue = Math.abs(inst.position) * price;

  state.equity = state.cash + uPnL;

  el.symbolTitle.textContent = state.active.replace("USDT", "/USDT");
  el.price.textContent = fmt(price, price < 1 ? 4 : 2);
  el.cash.textContent = fmt(state.cash, 2);
  el.posVal.textContent = fmt(posValue, 2);
  el.unrealized.textContent = (uPnL >= 0 ? "+" : "") + fmt(uPnL, 2);
  el.unrealized.style.color = uPnL >= 0 ? "var(--green)" : "var(--red)";
  el.equity.textContent = fmt(state.equity, 2);

  drawChart(inst.series);
  renderOrders();
  renderTrades();
}

/* ======== Ordens ======== */
function placeMarket(symbol, side, qty, execPrice) {
  const inst = state.instruments.get(symbol);
  const price = Number(execPrice);
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(price) || price <= 0) {
    alert("Quantidade ou preço inválidos.");
    return false;
  }

  if (side === "buy") {
    const cost = q * price;
    if (state.cash < cost) {
      alert("Saldo insuficiente.");
      return false;
    }

    const prevPos = inst.position;
    const prevAvg = inst.avgPrice;
    inst.position = prevPos + q;

    if (prevPos > 0) {
      inst.avgPrice = (prevPos * prevAvg + q * price) / (prevPos + q);
    } else if (prevPos === 0) {
      inst.avgPrice = price;
    } else {

      inst.avgPrice = price;
    }

    state.cash -= cost;


    const pnl = 0;
    pushTradeRow({ time: nowBR(), symbol, side: "BUY", qty: q, price, pnl });

  } else {

    if (inst.position <= 0 || inst.position < q) {
      alert("Você não possui quantidade suficiente para vender.");
      return false;
    }

    const realized = (price - inst.avgPrice) * q;

    inst.position -= q;
    if (inst.position === 0) {
      inst.avgPrice = 0;
    }
    state.cash += q * price;

    pushTradeRow({
      time: nowBR(),
      symbol,
      side: "SELL",
      qty: q,
      price,
      pnl: realized,
    });
  }

  recompute();
  return true;
}

function placeLimit(symbol, side, qty, limitPrice) {
  const inst = state.instruments.get(symbol);
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  const order = {
    id,
    time: nowBR(),
    symbol,
    side,
    qty: Number(qty),
    price: Number(limitPrice),
    type: "limit",
  };
  if (!Number.isFinite(order.qty) || order.qty <= 0 || !Number.isFinite(order.price) || order.price <= 0) {
    alert("Preço ou quantidade inválidos.");
    return;
  }
  inst.openOrders.unshift(order);
  renderOrders();
}

function cancelOrder(symbol, id) {
  const inst = state.instruments.get(symbol);
  inst.openOrders = inst.openOrders.filter((o) => o.id !== id);
  renderOrders();
}

function tryFillLimits(inst, lastPrice) {
  const fills = [];
  const remains = [];
  for (const o of inst.openOrders) {
    const hit =
      (o.side === "buy" && lastPrice <= o.price) ||
      (o.side === "sell" && lastPrice >= o.price);
    if (hit) fills.push(o);
    else remains.push(o);
  }
  inst.openOrders = remains;
  for (const f of fills) {
    placeMarket(f.symbol, f.side, f.qty, f.price);
  }
}

/* ======== Histórico de Trades ======== */
function pushTradeRow(t) {
  state.trades.unshift(t);
  const row = document.createElement("tr");
  const icon = iconFor(t.symbol);
  row.innerHTML = `
    <td>${t.time}</td>
    <td><img src="${icon}" alt="${t.symbol}" width="18" style="vertical-align:middle;margin-right:6px">${t.symbol}</td>
    <td style="color:${t.side === "BUY" ? "var(--green)" : "var(--red)"}">${t.side}</td>
    <td>${fmt(t.qty, 4)}</td>
    <td>${fmt(t.price, t.price < 1 ? 4 : 2)}</td>
    <td style="color:${(t.pnl || 0) >= 0 ? "var(--green)" : "var(--red)"}">${(t.pnl >= 0 ? "+" : "") + fmt(t.pnl || 0, 2)}</td>
  `;
  el.tradesTable.prepend(row);
}
function renderTrades() {
  if (!el.tradesTable) return;
  el.tradesTable.innerHTML = state.trades
    .map((t) => {
      const icon = iconFor(t.symbol);
      return `
      <tr>
        <td>${t.time}</td>
        <td><img src="${icon}" alt="${t.symbol}" width="18" style="vertical-align:middle;margin-right:6px">${t.symbol}</td>
        <td style="color:${t.side === "BUY" ? "var(--green)" : "var(--red)"}">${t.side}</td>
        <td>${fmt(t.qty, 4)}</td>
        <td>${fmt(t.price, t.price < 1 ? 4 : 2)}</td>
        <td style="color:${(t.pnl || 0) >= 0 ? "var(--green)" : "var(--red)"}">${(t.pnl >= 0 ? "+" : "") + fmt(t.pnl || 0, 2)}</td>
      </tr>`;
    })
    .join("");
}

/* ======== Render de Ordens Abertas ======== */
function renderOrders() {
  const inst = current();
  if (!inst) return;
  el.ordersTable.innerHTML = inst.openOrders
    .map(
      (o) => `
    <tr>
      <td>${o.time}</td>
      <td>${o.symbol}</td>
      <td style="color:${o.side === "buy" ? "var(--green)" : "var(--red)"}">${o.side.toUpperCase()}</td>
      <td>${fmt(o.qty, 4)}</td>
      <td>${fmt(o.price, o.price < 1 ? 4 : 2)}</td>
      <td>${o.type}</td>
      <td><button class="btn danger btn-xs" data-cancel="${o.id}">Cancelar</button></td>
    </tr>`
    )
    .join("");

  $$('button[data-cancel]').forEach((b) => {
    b.onclick = () => cancelOrder(inst.symbol, b.dataset.cancel);
  });
}

/* ======== Troca de símbolo ======== */
function highlightActive(symbol) {
  $$("#coinsBar button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.symbol === symbol);
  });
  if (el.symbolSelect) el.symbolSelect.value = symbol;
}

function switchSymbol(sym) {
  state.active = sym;
  highlightActive(sym);
  refresh24h(sym);
  connectWS(sym);
  recompute();
}

/* ======== Eventos ======== */
if (el.orderForm) {
  el.orderForm.onsubmit = (ev) => {
    ev.preventDefault();
    const symbol = state.active;
    const side = el.sideBuy.checked ? "buy" : "sell";
    const qty = Math.max(0, Number(el.qty.value));
    const type = el.orderType.value;

    if (type === "market") {
      const inst = state.instruments.get(symbol);
      const price = inst.series.at(-1);
      if (!price) { alert("Sem preço para executar."); return; }
      placeMarket(symbol, side, qty, price);
    } else {
      const limitPrice = Math.max(0, Number(el.limitPrice.value));
      if (!limitPrice) { alert("Informe o preço limite."); return; }
      placeLimit(symbol, side, qty, limitPrice);
    }
  };
}

if (el.orderType) {
  el.orderType.onchange = () => {
    el.limitWrap.classList.toggle("hidden", el.orderType.value !== "limit");
  };
}

if (el.leverage) {
  el.leverage.oninput = (e) => {
    state.leverage = Number(e.target.value);
    el.levVal.textContent = `${state.leverage}x`;
    recompute();
  };
}

if (el.symbolSelect) {
  el.symbolSelect.onchange = (e) => {
    switchSymbol(e.target.value);
  };
}

/* Botões topo (adaptados para streaming) */
if (el.playBtn) el.playBtn.onclick = () => connectWS(state.active);
if (el.pauseBtn) el.pauseBtn.onclick = () => { if (state.ws) state.ws.close(); };
if (el.resetBtn) el.resetBtn.onclick = () => {
  for (const [k] of state.instruments) {
    state.instruments.set(k, {
      symbol: k,
      series: [],
      openOrders: [],
      position: 0,
      avgPrice: 0,
    });
  }
  state.trades = [];
  state.cash = 10000;
  state.equity = 10000;
  if (state.ws) try { state.ws.close(); } catch {}
  connectWS(state.active);
  renderTrades();
  recompute();
};

/* ======== Coins bar (gerada via JS com ícones) ======== */
function renderCoinsBar() {
  el.coinsBar.innerHTML = symbols
    .map((s) => {
      const icon = iconFor(s);
      const label = s.replace("USDT", "");
      return `<button data-symbol="${s}">
        <img src="${icon}" alt="${label}" width="18" height="18"/>
        ${label}
      </button>`;
    })
    .join("");
  $$("button[data-symbol]").forEach((btn) => {
    btn.onclick = () => switchSymbol(btn.dataset.symbol);
  });
  highlightActive(state.active);
}

/* ======== Inicialização ======== */
renderCoinsBar();
switchSymbol(state.active);
refresh24h(state.active);

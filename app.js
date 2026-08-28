/* Arc Perps — frontend wired to the live PerpCore deployment on Arc testnet. */
const CFG = window.ARC_PERP;
const E = ethers;

const PERP_ABI = [
  "function latestPrice(uint256) view returns (uint256)",
  "function longOI(uint256) view returns (uint256)",
  "function shortOI(uint256) view returns (uint256)",
  "function cumFundingWad(uint256) view returns (int256)",
  "function isLiquidatable(uint256) view returns (bool)",
  "function lpLiquidity() view returns (uint256)",
  "function marginLocked() view returns (uint256)",
  "function orderEscrow() view returns (uint256)",
  "function nextId() view returns (uint256)",
  "function positions(uint256) view returns (address trader,uint256 marketId,bool isLong,uint256 margin,uint256 notional,uint256 entryPrice,int256 entryFunding,bool open)",
  "function maxLeverageWad() view returns (uint256)",
  "function maintMarginBps() view returns (uint256)",
  "function fundingFactorWad() view returns (uint256)",
  "function maxFundingWad() view returns (uint256)",
  "function openFeeBps() view returns (uint256)",
  "function openPosition(uint256,bool,uint256,uint256) returns (uint256)",
  "function closePosition(uint256)",
  "function depositLiquidity(uint256) returns (uint256)",
];
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function faucet()",
];

const PERP_WRITE_ABI = PERP_ABI.concat(["function refresh(bytes[] updateData) payable"]);
const PYTH_ABI = ["function getUpdateFee(bytes[] updateData) view returns (uint256)"];

const roProvider = new E.JsonRpcProvider(CFG.rpc, CFG.chainId);
const perpRO = new E.Contract(CFG.perp, PERP_ABI, roProvider);
const usdcRO = new E.Contract(CFG.usdc, USDC_ABI, roProvider);
const pythRO = CFG.pyth ? new E.Contract(CFG.pyth, PYTH_ABI, roProvider) : null; // B1 has no on-chain Pyth

// Pull fresh Pyth prices from Hermes and post them on-chain, so a user's own
// trade never depends on our keeper being online.
async function fetchUpdateData() {
  const ids = CFG.markets.map((m) => m.feed);
  const qs = ids.map((i) => `ids[]=${i}`).join("&");
  const r = await fetch(`${CFG.hermes}?${qs}&encoding=hex`);
  if (!r.ok) throw new Error("Hermes " + r.status);
  return (await r.json()).binary.data.map((x) => "0x" + x);
}

const f6 = (x) => Number(E.formatUnits(x, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const f18 = (x) => Number(E.formatUnits(x, 18));
const usd = (x) => "$" + Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = (id) => document.getElementById(id);

const App = {
  side: true, active: 1, signer: null, account: null, perp: null, usdc: null,
  params: { maxLev: 20, maintBps: 50, fundingFactor: 0.01, maxFunding: 0.01, openFeeBps: 5 },
  cache: {},

  async init() {
    $("perpLink").href = `${CFG.explorer}/address/${CFG.perp}`;
    try {
      this.params.maintBps = Number(await perpRO.maintMarginBps());
      this.params.maxLev = Number(f18(await perpRO.maxLeverageWad()));
      this.params.fundingFactor = f18(await perpRO.fundingFactorWad());
      this.params.maxFunding = f18(await perpRO.maxFundingWad());
      this.params.openFeeBps = Number(await perpRO.openFeeBps());
    } catch (e) { console.warn("param load", e); }
    $("levInput").max = String(this.params.maxLev);
    await this.refresh();
    setInterval(() => this.refresh().catch(console.warn), 5000);
    if (window.ethereum) window.ethereum.on?.("accountsChanged", () => this.connect());
  },

  setSide(l) {
    this.side = l;
    $("sideLong").classList.toggle("on", l); $("sideShort").classList.toggle("on", !l);
    this.syncBtn(); this.preview();
  },
  syncLev() { $("levVal").textContent = $("levInput").value + "×"; this.preview(); },
  syncBtn() {
    const b = $("submitBtn");
    if (!this.account) { b.textContent = "Connect wallet to trade"; b.className = "submit long"; b.disabled = true; return; }
    b.disabled = false; b.className = "submit " + (this.side ? "long" : "short");
    b.textContent = (this.side ? "Open long" : "Open short") + " · Market";
  },

  async connect() {
    if (!window.ethereum) { this.toast("No injected wallet found. Install MetaMask.", "err"); return; }
    try {
      const hexChain = "0x" + CFG.chainId.toString(16);
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain }] });
      } catch (sw) {
        if (sw.code === 4902) {
          await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
            chainId: hexChain, chainName: "Arc Testnet", rpcUrls: [CFG.rpc],
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            blockExplorerUrls: [CFG.explorer],
          }]});
        } else throw sw;
      }
      const bp = new E.BrowserProvider(window.ethereum);
      this.signer = await bp.getSigner();
      this.account = await this.signer.getAddress();
      this.perp = new E.Contract(CFG.perp, PERP_WRITE_ABI, this.signer);
      this.usdc = new E.Contract(CFG.usdc, USDC_ABI, this.signer);
      $("wallet").innerHTML = `<span class="addr">${this.account.slice(0,6)}…${this.account.slice(-4)}</span>`;
      this.syncBtn(); this.toast("Wallet connected", "ok"); this.refresh();
    } catch (e) { this.toast(this.err(e), "err"); }
  },

  async tx(promise, label) {
    this.toast(label + " — confirm in wallet…", "pending");
    try {
      const t = await promise;
      this.toast(label + " — pending…", "pending");
      const rc = await t.wait();
      this.toast(`${label} ✓ <a target="_blank" href="${CFG.explorer}/tx/${rc.hash}">view</a>`, "ok");
      await this.refresh();
      return rc;
    } catch (e) { this.toast(this.err(e), "err"); throw e; }
  },
  err(e) { return (e.shortMessage || e.reason || e.message || "error").replace(/execution reverted:?/, "reverted:"); },

  // Post a fresh Pyth price on-chain (keeper-independent). Cheap: fee is a few wei.
  async refreshPrice() {
    const data = await fetchUpdateData();
    const fee = await pythRO.getUpdateFee(data);
    await this.tx(this.perp.refresh(data, { value: fee }), "Refresh Pyth price");
  },
  // B1: prices are kept fresh by the keeper (12s). No client-side self-refresh
  // (the push oracle has no refresh() and users can't self-sign).
  async trade(fn, label) { await this.tx(fn(), label); },

  async ensureAllowance(amount) {
    const a = await this.usdc.allowance(this.account, CFG.perp);
    if (a < amount) await this.tx(this.usdc.approve(CFG.perp, E.MaxUint256), "Approve tUSDC");
  },
  async faucet() {
    if (!this.account) return this.connect();
    await this.tx(this.usdc.faucet(), "Faucet 10,000 tUSDC");
  },
  async depositLp() {
    if (!this.account) return this.connect();
    const amt = E.parseUnits(($("lpInput").value || "0"), 6);
    if (amt <= 0n) return this.toast("Enter an amount", "err");
    await this.ensureAllowance(amt);
    await this.tx(this.perp.depositLiquidity(amt), "Deposit " + f6(amt) + " to LP");
  },
  async openPosition() {
    if (!this.account) return this.connect();
    const margin = E.parseUnits(($("marginInput").value || "0"), 6);
    const lev = BigInt($("levInput").value);
    if (margin <= 0n) return this.toast("Enter a margin amount", "err");
    await this.ensureAllowance(margin);
    await this.trade(() => this.perp.openPosition(this.active, this.side, margin, lev * 10n ** 18n),
      `Open ${this.side ? "long" : "short"} ${lev}×`);
  },
  async closePos(id) {
    await this.trade(() => this.perp.closePosition(id), "Close position #" + id);
  },

  async refresh() {
    // markets + tabs — prices come from Pyth via dedicated views
    const tabs = $("tabs"); const rows = [];
    for (const m of CFG.markets) {
      const [priceW, lOI, sOI, cf] = await Promise.all([
        perpRO.latestPrice(m.id), perpRO.longOI(m.id), perpRO.shortOI(m.id), perpRO.cumFundingWad(m.id),
      ]);
      const mk = { latestPrice: priceW, longOI: lOI, shortOI: sOI, cumFundingWad: cf };
      this.cache[m.id] = mk;
      rows.push({ id: m.id, sym: m.sym, price: f18(mk.latestPrice), mk });
    }
    tabs.innerHTML = "";
    for (const r of rows) {
      const el = document.createElement("button");
      el.className = "mtab" + (r.id === this.active ? " active" : "");
      el.onclick = () => { this.active = r.id; this.refresh(); this.preview(); };
      el.innerHTML = `<span class="sym">${r.sym}</span><span class="num px">${usd(r.price)}</span>`;
      tabs.appendChild(el);
    }
    const cur = rows.find((r) => r.id === this.active) || rows[0];
    const mk = cur.mk;
    $("bigPrice").textContent = usd(cur.price);
    $("marketName").textContent = cur.sym + " · Arc testnet";
    // funding rate
    const L = Number(mk.longOI), S = Number(mk.shortOI), tot = L + S;
    let fr = tot > 0 ? this.params.fundingFactor * (L - S) / tot : 0;
    fr = Math.max(-this.params.maxFunding, Math.min(this.params.maxFunding, fr)) * 100;
    const frEl = $("fundRate"); frEl.textContent = (fr >= 0 ? "+" : "") + fr.toFixed(4) + "%";
    frEl.style.color = fr > 0 ? "var(--long)" : fr < 0 ? "var(--short)" : "var(--muted)";
    $("oi").textContent = f6(mk.longOI) + " / " + f6(mk.shortOI);

    // vault
    const lp = await perpRO.lpLiquidity(), ml = await perpRO.marginLocked(), esc = await perpRO.orderEscrow();
    $("vLp").textContent = f6(lp); $("vMargin").textContent = f6(ml); $("vEscrow").textContent = f6(esc);
    let totL = 0n, totS = 0n; for (const m of CFG.markets) { const c = this.cache[m.id]; totL += c.longOI; totS += c.shortOI; }
    $("vOi").textContent = f6(totL) + " / " + f6(totS);
    const t = Number(totL + totS) || 1;
    $("oiBar").innerHTML = `<i class="lg" style="width:${Number(totL)/t*100}%"></i><i class="sh" style="width:${Number(totS)/t*100}%"></i>`;

    // solvency invariant (live from chain)
    try {
      const bal = await usdcRO.balanceOf(CFG.perp);
      const rhs = lp + ml + esc;
      const ok = bal >= rhs - 1n && bal <= rhs + 1n;
      $("solv").className = "solv" + (ok ? "" : " bad");
      $("solvtext").textContent = ok ? "Solvent" : "CHECK";
      $("invNums").textContent = `${f6(bal)} = ${f6(lp)} + ${f6(ml)} + ${f6(esc)}`;
    } catch {}

    // wallet balances + onboarding
    let nativeBal = 0n, tusdc = 0n;
    if (this.account) {
      tusdc = await usdcRO.balanceOf(this.account);
      nativeBal = await roProvider.getBalance(this.account);
      $("walletBal").textContent = "· " + f6(tusdc) + " tUSDC";
      $("marginMax").textContent = "bal " + f6(tusdc);
    }
    this.renderOnboarding(nativeBal, tusdc);
    await this.renderPositions();
    this.preview();
  },

  renderOnboarding(nativeBal, tusdc) {
    const connected = !!this.account;
    const hasGas = nativeBal > 0n;
    const hasUsdc = tusdc > 0n;
    // ready → hide the whole card
    if (connected && hasGas && hasUsdc) { $("onboard").style.display = "none"; return; }
    $("onboard").style.display = "";
    const addr = this.account || "";
    const steps = [
      { done: connected, cur: !connected,
        title: "Connect a wallet",
        body: connected ? `<span class="mut">${addr.slice(0,10)}… on Arc testnet</span>`
          : `<span class="mut">Adds the Arc testnet network automatically.</span><br><button class="mini accent" onclick="App.connect()">Connect wallet</button>` },
      { done: connected && hasGas, cur: connected && !hasGas,
        title: "Get gas (Arc pays fees in USDC)",
        body: (connected && hasGas) ? `<span class="mut">${f6(nativeBal/(10n**12n))} USDC for gas ✓</span>`
          : `<span class="mut">You need a little testnet USDC to pay gas. Claim it from Circle's faucet, then come back.</span><br>
             <a class="mini accent" href="https://faucet.circle.com" target="_blank" rel="noopener">Open Circle faucet ↗</a>
             ${addr ? `<div class="mut" style="margin-top:6px">Your address: <code>${addr}</code></div>` : ""}` },
      { done: hasUsdc, cur: connected && hasGas && !hasUsdc,
        title: "Claim 10,000 test USDC",
        body: hasUsdc ? `<span class="mut">${f6(tusdc)} tUSDC ✓</span>`
          : `<span class="mut">Free trading collateral for this demo.</span><br><button class="mini accent" onclick="App.faucet()">Faucet 10k tUSDC</button>` },
      { done: false, cur: connected && hasGas && hasUsdc,
        title: "Open a long or short →",
        body: `<span class="mut">Pick a market, set margin &amp; leverage, trade.</span>` },
    ];
    $("obSteps").innerHTML = steps.map((s, i) => `
      <div class="step ${s.done ? "done" : ""} ${s.cur ? "current" : ""}">
        <span class="n">${s.done ? "✓" : i + 1}</span>
        <div class="bd"><b>${s.title}</b><br>${s.body}</div>
      </div>`).join("");
  },

  async renderPositions() {
    const body = $("posBody"); const n = Number(await perpRO.nextId());
    const mine = [];
    for (let i = 1; i < n; i++) {
      const p = await perpRO.positions(i);
      if (p.open && this.account && p.trader.toLowerCase() === this.account.toLowerCase()) mine.push({ id: i, p });
    }
    $("posEmpty").style.display = mine.length ? "none" : "block";
    $("posCount").textContent = mine.length ? "· " + mine.length : "";
    body.innerHTML = "";
    for (const { id, p } of mine) {
      let mk = this.cache[Number(p.marketId)];
      if (!mk) mk = { latestPrice: await perpRO.latestPrice(p.marketId), cumFundingWad: await perpRO.cumFundingWad(p.marketId) };
      const price = f18(mk.latestPrice), entry = f18(p.entryPrice);
      const notional = Number(E.formatUnits(p.notional, 6)), margin = Number(E.formatUnits(p.margin, 6));
      const dir = p.isLong ? 1 : -1;
      const pnl = notional * (price - entry) / entry * dir;
      const fundingPay = dir * notional * (f18(mk.cumFundingWad) - f18(p.entryFunding));
      const upnl = pnl - fundingPay;
      const maint = notional * this.params.maintBps / 1e4;
      const eq = margin + upnl;
      const health = Math.max(0, Math.min(100, (eq - maint) / margin * 100));
      const hc = health > 50 ? "var(--long)" : health > 20 ? "var(--warn)" : "var(--short)";
      const liq = entry * (1 - dir * (margin - maint) / notional);
      const sym = CFG.markets.find((m) => m.id === Number(p.marketId))?.sym || "#" + p.marketId;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${sym}</td>
        <td><span class="pill ${p.isLong?'l':'s'}">${p.isLong?'LONG':'SHORT'} ${(notional/margin).toFixed(0)}×</span></td>
        <td class="num">${usd(notional)}</td><td class="num">${usd(entry)}</td><td class="num">${usd(price)}</td>
        <td class="num" style="color:var(--warn)">${usd(Math.max(0,liq))}</td>
        <td class="num ${upnl>=0?'up':'down'}">${upnl>=0?'+':'-'}${usd(Math.abs(upnl)).slice(1)}</td>
        <td><span class="health"><i style="width:${health}%;background:${hc}"></i></span></td>
        <td><button class="act danger" onclick="App.closePos(${id})">Close</button></td>`;
      body.appendChild(tr);
    }
  },

  preview() {
    const margin = Number($("marginInput").value) || 0;
    const lev = Number($("levInput").value);
    const net = margin * (1 - this.params.openFeeBps / 1e4);
    const notional = net * lev;
    const cur = this.cache[this.active];
    const entry = cur ? f18(cur.latestPrice) : 0;
    $("tiNotional").textContent = usd(notional);
    $("tiEntry").textContent = usd(entry);
    const dir = this.side ? 1 : -1;
    const liq = entry * (1 - dir * (net - notional * this.params.maintBps / 1e4) / notional);
    $("tiLiq").textContent = notional > 0 ? usd(Math.max(0, liq)) : "—";
  },

  toastT: null,
  toast(html, kind) {
    const t = $("toast"); t.innerHTML = html; t.className = "toast show " + (kind || "");
    clearTimeout(this.toastT); this.toastT = setTimeout(() => t.className = "toast " + (kind || ""), kind === "pending" ? 20000 : 4200);
  },
};

$("marginInput").addEventListener("input", () => App.preview());
window.App = App;
App.init();

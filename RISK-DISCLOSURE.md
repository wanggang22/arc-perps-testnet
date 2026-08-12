# Risk Disclosure

> **DRAFT — NOT LEGAL ADVICE.** This document was drafted by the builder as a
> starting point and **must be reviewed and finalized by a qualified crypto/derivatives
> lawyer** before any mainnet launch. Jurisdiction-specific requirements are not
> covered. Do not rely on it as-is.

Trading perpetual futures with leverage is **high-risk** and can result in the **total
loss** of the funds you commit. Do not trade with money you cannot afford to lose entirely.

## 1. Leverage amplifies losses

Positions can be opened at up to the protocol's maximum leverage. Leverage multiplies both
gains and losses relative to your margin. A small adverse price move can wipe out your entire
margin.

## 2. Liquidation

If your position's equity falls below the maintenance-margin requirement, it will be
**liquidated**. On liquidation, a bounded bounty is paid to the liquidator and any residual
equity is returned to you; if your equity is negative, your entire margin is lost and the
shortfall is covered by the insurance fund (and, if insufficient, may be socialized). You may
be liquidated at any time, including during volatility, gaps, or oracle updates, with no prior
notice and no opportunity to add margin.

## 3. Funding payments

Perpetuals charge **funding** between the heavy and light side of the market. If your side is
crowded, you continuously **pay** funding, which erodes your equity over time and can itself
push a position into liquidation even at a flat price.

## 4. Oracle risk

Prices come from a third-party oracle (**Pyth Network**). If the oracle is delayed, halted,
manipulated, or reports an incorrect price, your position may be liquidated incorrectly or you
may be unable to open, close, or be fairly liquidated. The protocol rejects prices that are
stale or that the oracle itself flags as low-confidence, but oracle risk cannot be eliminated.

## 5. Smart-contract & keeper risk

The protocol is software. It may contain bugs or vulnerabilities despite auditing. Liquidations
and order fills depend on an off-chain **keeper**; if the keeper or the underlying chain is
degraded, liquidations may be delayed, harming both traders and liquidity providers. Code is
**not a guarantee of correctness**.

## 6. Liquidity-provider risk

LPs are the **counterparty** to traders. When traders profit, LPs pay; LPs can lose principal.
Deficits beyond the insurance fund may be **socialized** across LPs. LP deposits are not
insured or guaranteed.

## 7. No recourse; non-custodial

The protocol is **non-custodial** — no one can recover, reverse, or refund your funds. There is
no customer-support line that can move on-chain funds on your behalf. Transactions are final.

## 8. Regulatory & availability risk

Leveraged derivatives are restricted or prohibited in many jurisdictions. Access may be blocked
for residents of certain countries. Regulatory action could restrict or end availability at any
time. You are responsible for compliance with the laws that apply to you.

## 9. Testnet

The current deployment runs on **Arc testnet** with test tokens of **no monetary value**. It is
a demonstration, is not audited, and must not be used with real funds.

---

By using this protocol you confirm that you understand and accept every risk above.

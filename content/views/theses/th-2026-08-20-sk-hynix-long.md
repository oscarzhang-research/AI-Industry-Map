---
id: th-2026-08-20-sk-hynix-long
type: thesis
visibility: public
example: true
createdAt: 2026-08-20T13:00:00.000Z
status: active
subject:
  kind: company
  company: sk-hynix
direction: long
conviction: 4
horizonMonths: 12
basePrice:
  price: 1691000
  currency: KRW
  date: 2026-08-20
refClose:
  price: 1691000
  currency: KRW
  date: 2026-08-20
target:
  price: 2400000
  currency: KRW
  method: About 8× 2027E earnings after the HBM contract reset (example figure)
stop:
  price: 1300000
  currency: KRW
  note: Back below the pre-reset range would say HBM pricing power is not holding
scenarios:
  - name: bull
    price: 3000000
    prob: 0.25
    note: HBM4 share stays above half and 2027 contracts reset 30%+ higher
  - name: base
    price: 2400000
    prob: 0.5
    note: Contracts reset as expected; commodity DRAM stays firm
  - name: bear
    price: 1200000
    prob: 0.25
    note: Samsung catches up in HBM4 and the price curve rolls over in 2027
summary: "HBM leadership plus a 2027 contract reset: earnings power the market still prices like a cycle peak."
logic: |-
  - Memory has become the binding constraint on AI systems: per-GPU compute has grown far faster than HBM bandwidth, so every accelerator generation needs more and faster memory.
  - 2026 HBM prices were agreed a year earlier, on a looser market. The 2027 negotiation happens with supply bound by cleanroom space, not capital.
  - SK hynix has the largest share of HBM at the leading accelerator customer and the longest qualification record.
  - Commodity DRAM tightens as HBM consumes more wafer per bit, which supports the rest of the portfolio.
variant: The market treats 2026 margins as the peak of a classic memory cycle. I think the earnings peak is more likely 2027, when HBM resets to a tighter market.
bearCase: Samsung qualifies HBM4 at the largest customer and competes on price; new cleanrooms from late 2027 meet slowing AI capex, and the cycle turns on schedule.
valuation: At the base price the shares trade at a low multiple of 2027 consensus earnings. A memory company at a cycle high deserves a discount; the question is whether 2027 is the high.
consensus: A strong 2026, then pricing rolls over in 2027 as Samsung ramps HBM4 and capacity arrives.
catalysts:
  - id: c1
    label: Q3 2026 results
    date: 2026-10-28
    status: upcoming
    note: Date estimated
  - id: c2
    label: 2027 HBM contract negotiations conclude
    date: 2026-12-15
    status: upcoming
signals:
  - id: s1
    text: 2027 HBM contract prices settle above 2026 levels
    due: 2026-12-31
    status: pending
  - id: s2
    text: HBM4 volume shipments for the next accelerator platform stay on schedule
    due: 2026-12-31
    status: pending
  - id: s3
    text: DRAM contract prices keep rising through the fourth quarter
    due: 2026-11-30
    status: partial
    note: Samsung’s Q3 guide points the right way; contract data due in November
risks:
  - id: r1
    text: Samsung wins a large HBM4 share with price concessions
    trigger: Samsung confirmed as a primary HBM4 supplier at the largest customer, at lower prices
    status: watching
  - id: r2
    text: AI capex digestion in 2027
    trigger: Two or more hyperscalers cut their 2027 capex plans
    status: watching
updates:
  - date: 2026-10-07
    text: "New research on the memory stack: scarcity ranks HBM first, and 2027 looks like the least elastic year for supply. Thesis intact."
  - date: 2026-10-08
    text: Samsung guided Q3 operating profit to about 107.4 trillion won, mostly from memory. Supportive for pricing across the industry.
related:
  - company: samsung-electronics
    relation: peer
    note: The main HBM4 challenger
  - company: micron
    relation: peer
  - company: hanmi
    relation: supplier
    note: Thermal-compression bonders for HBM stacks
  - company: nvidia
    relation: customer
reports:
  - 2026-10-07-ai-memory-stack
reviewOn: 2026-11-18
tags:
  - hbm
  - memory-cycle
publicShow:
  target: true
  stop: true
  scenarios: true
versions:
  - at: 2026-08-20T13:00:00.000Z
    direction: long
    conviction: 4
    target: 2400000
    stop: 1300000
    horizonMonths: 12
    reason: Opened
---

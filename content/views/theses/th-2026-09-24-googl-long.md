---
id: th-2026-09-24-googl-long
type: thesis
visibility: public
example: true
createdAt: 2026-09-24T12:30:00.000Z
status: active
subject:
  kind: company
  company: alphabet
direction: long
conviction: 3
horizonMonths: 24
basePrice:
  price: 337.83
  currency: USD
  date: 2026-09-23
refClose:
  price: 337.83
  currency: USD
  date: 2026-09-23
target:
  price: 420
  currency: USD
  method: Sum of the parts with Cloud at a premium multiple (example figure)
stop:
  price: 285
  currency: USD
  note: "Below the bear-case value: the market would be pricing a broken Search franchise"
scenarios:
  - name: bull
    price: 470
    prob: 0.25
    note: Cloud margin holds near 35% and Gemini regains a lead
  - name: base
    price: 400
    prob: 0.5
    note: Steady Search, Cloud above 60% growth, capex peaks in 2027
  - name: bear
    price: 280
    prob: 0.25
    note: Agentic shopping erodes paid clicks while capex keeps rising
summary: "A compounder, not a trade: ads and Cloud fund the capex bet, and the model layer is the swing factor to watch."
logic: |-
  - Operations are the strongest in five years: Q2 revenue +24%, Search re-accelerated to 17–19%, Cloud +82% at a 35.6% margin with a $514B backlog.
  - The stack closes three loops: ad cash funds about $200B of capex, in-house TPUs keep free AI answers profitable, and usage data feeds the models.
  - Returns on capital are falling but still clear the cost of capital: incremental ROIC around 16–19% against roughly 9%.
variant: The market frames AI as a threat to Search. So far AI mostly takes informational queries that rarely carried ads, while paid clicks and cost per click both still grow.
bearCase: "Demand is partly circular: one AI lab is reportedly over 40% of the Cloud backlog, and GAAP earnings are inflated by investment mark-ups while buybacks are paused."
valuation: "The research puts a base DCF near $312 and a sum of the parts near $325, against $335 at the time: fair to slightly rich, implying high single-digit annual returns. That suits a long-horizon core holding."
consensus: Fairly valued after the run; the debate is the capex bill and negative free cash flow.
catalysts:
  - id: c1
    label: Q3 2026 results
    date: 2026-10-28
    status: upcoming
signals:
  - id: s1
    text: Cloud grows above 60% with an operating margin above 30%
    due: 2027-02-15
    status: pending
  - id: s2
    text: Paid clicks keep growing through the AI Mode rollout
    due: 2027-02-15
    status: pending
  - id: s3
    text: Gemini regains a clear lead in at least one major category
    due: 2027-06-30
    status: pending
risks:
  - id: r1
    text: Backlog concentration in one lab
    trigger: That lab moves a large share of compute to another cloud
    status: watching
  - id: r2
    text: Capex without returns
    trigger: Incremental ROIC falls below 10%
    status: watching
related:
  - company: broadcom
    relation: supplier
    note: TPU design partner
  - company: anthropic
    relation: customer
    note: A large share of the Cloud backlog
reports:
  - 2026-09-24-alphabet-initiation
  - 2026-09-24-alphabet-deep-dive-ii
reviewOn: 2026-11-05
tags:
  - capex
  - custom-asic
publicShow:
  target: true
  stop: true
  scenarios: true
versions:
  - at: 2026-09-24T12:30:00.000Z
    direction: long
    conviction: 3
    target: 420
    stop: 285
    horizonMonths: 24
    reason: Opened
---

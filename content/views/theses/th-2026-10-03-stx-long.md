---
id: th-2026-10-03-stx-long
type: thesis
visibility: public
example: true
createdAt: 2026-10-03T14:00:00.000Z
status: active
subject:
  kind: company
  company: seagate
direction: long
conviction: 3
horizonMonths: 12
basePrice:
  price: 848.99
  currency: USD
  date: 2026-10-02
refClose:
  price: 848.99
  currency: USD
  date: 2026-10-02
target:
  price: 1050
  currency: USD
  method: Recovery of the selloff plus one year of earnings growth (example figure)
stop:
  price: 700
  currency: USD
  note: Would mean the market is pricing an earnings problem, not a duration problem
scenarios:
  - name: bull
    price: 1200
    prob: 0.25
    note: Agreements extend into 2028 and Toshiba slips
  - name: base
    price: 1050
    prob: 0.5
    note: Estimates hold; the duration discount narrows
  - name: bear
    price: 650
    prob: 0.25
    note: Demand growth near 25% flips the market to surplus in 2028
summary: "A duration shock, not an earnings shock: agreements lock in two years of earnings the market just discounted."
logic: |-
  Toshiba’s plan to double hard-drive output is measured in exabytes, not units: about 41% a year to fiscal 2027, adding roughly 6% to industry supply.

  Seagate and Western Digital fell about 10% on the news, roughly $39B of value, around 100 times Toshiba’s capex. Output is allocated or under long-term agreements through 2027, and Toshiba still has to clear media supply, glass substrates and an areal-density gap.
variant: The selloff priced a 2028 problem in a 2026 market. Near-term estimates should not move.
bearCase: From 2028, Toshiba’s capacity, heat-assisted recording ramps, component expansions and a looser NAND market coincide. At about 25% demand growth the market flips to surplus.
catalysts:
  - id: c1
    label: Fiscal Q1 2027 results
    date: 2026-10-27
    status: upcoming
signals:
  - id: s1
    text: The next quarterly guide holds price per terabyte
    due: 2026-10-28
    status: pending
  - id: s2
    text: Cloud customers extend agreements into 2028
    due: 2027-03-31
    status: pending
risks:
  - id: r1
    text: Toshiba clears its gates faster than expected
    trigger: Toshiba ships high-capacity drives at volume to a top-three cloud before 2027
    status: watching
updates:
  - date: 2026-10-09
    text: Shares slid further with the group, to about $783. Nothing new on fundamentals; the stop is still well below.
related:
  - company: western-digital
    relation: peer
  - company: toshiba
    relation: peer
    note: The new supply
reports:
  - 2026-10-03-toshiba-hdd-shock
reviewOn: 2026-10-29
tags:
  - memory-cycle
publicShow:
  target: true
  stop: true
  scenarios: true
versions:
  - at: 2026-10-03T14:00:00.000Z
    direction: long
    conviction: 3
    target: 1050
    stop: 700
    horizonMonths: 12
    reason: Opened
---

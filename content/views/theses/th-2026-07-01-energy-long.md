---
id: th-2026-07-01-energy-long
type: thesis
visibility: public
example: true
createdAt: 2026-07-01T12:30:00.000Z
status: active
subject:
  kind: node
  node: energy
direction: long
conviction: 4
horizonMonths: 24
summary: Power is the binding constraint on new AI capacity through 2028, and equipment makers with sold-out backlogs keep the pricing power.
logic: |-
  - New AI campuses are limited by how fast they can get power: gas turbines, large transformers and grid connections are booked years ahead.
  - When delivery slots are scarce, pricing moves to the suppliers: turbine and grid-equipment makers can raise prices on new orders.
  - Utilities and independent producers with spare capacity near data-center clusters can sign long contracts at premium prices.
variant: The market treats power names as a 2026 trade. Lead times say the constraint lasts longer than one capex cycle.
bearCase: Efficiency gains (better chips, sparser models, cheaper inference) cut power per unit of AI work faster than demand grows, and the queue clears.
signals:
  - id: s1
    text: Turbine and transformer makers report higher prices on new orders
    due: 2027-03-31
    status: pending
  - id: s2
    text: Utilities raise large-load forecasts again in their next plans
    due: 2027-06-30
    status: pending
risks:
  - id: r1
    text: Power per unit of AI work falls faster than demand grows
    trigger: Two consecutive quarters of lower data-center load forecasts from major utilities
    status: watching
related:
  - company: ge-vernova
    relation: beneficiary
  - company: siemens-energy
    relation: beneficiary
  - company: hd-hyundai-electric
    relation: beneficiary
reviewOn: 2026-12-31
tags:
  - power-bottleneck
versions:
  - at: 2026-07-01T12:30:00.000Z
    direction: long
    conviction: 4
    horizonMonths: 24
    reason: Opened
---

---
id: th-2026-03-02-vrt-long
type: thesis
visibility: public
example: true
createdAt: 2026-03-02T14:00:00.000Z
status: target-hit
subject:
  kind: company
  company: vertiv
direction: long
conviction: 3
horizonMonths: 12
basePrice:
  price: 257.75
  currency: USD
  date: 2026-03-02
refClose:
  price: 257.75
  currency: USD
  date: 2026-03-02
target:
  price: 360
  currency: USD
  method: Order growth re-rates the multiple (example figure)
stop:
  price: 215
  currency: USD
summary: Liquid cooling moves from pilot to standard in AI halls, and the order book re-rates first.
logic: Rack power densities in new AI halls are beyond what air cooling can handle, so liquid cooling becomes the default design. The supplier with the broadest thermal and power portfolio sees it first in orders.
signals:
  - id: s1
    text: Orders grow faster than sales for two quarters
    due: 2026-07-31
    status: confirmed
risks:
  - id: r1
    text: Crowded positioning
    trigger: Guidance meets but does not beat expectations
    status: cleared
closed:
  date: 2026-05-11
  price: 367.92
  outcome: right
  reason: Target reached (confirmed from daily closes)
review: |-
  Right, and for the stated reason: orders led sales for two quarters. The exit discipline mattered more than the entry. The shares later fell back below the opening price, so holding for “more upside” would have given back the whole move.

  Lesson: in crowded AI-infrastructure names, take the target when it comes and re-open only on a new reason.
tags:
  - liquid-cooling
  - data-centers
publicShow:
  target: true
  stop: true
  scenarios: true
versions:
  - at: 2026-03-02T14:00:00.000Z
    direction: long
    conviction: 3
    target: 360
    stop: 215
    horizonMonths: 12
    reason: Opened
  - at: 2026-05-12T13:00:00.000Z
    direction: long
    conviction: 3
    target: 360
    stop: 215
    horizonMonths: 12
    reason: Target reached (confirmed from daily closes)
---

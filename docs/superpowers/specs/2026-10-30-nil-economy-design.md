# NIL economy: the portal runs on this season's money

Status: approved in conversation 2026-10-30 ("rewarded NIL at the end of the season for the transfer portal based on performance… use leftover NIL points in the portal… a portion could carry over, maxed depending on the school… nothing crazy… rather than transfer portal pulling from next year"; design approved "Yes, build it"). Engine change in `coach_career/recruiting.py` and `coach_career/offseason.py`, three view lines. Every school, AI included, follows the same rules.

## 1. Today

A school's class budget is `nil_budget = 3 × NIL tier` (`NIL_PER_TIER`, floor 30), less what it spent keeping its own players home (`state["nil_retained"]`). The portal pool is a separate pot: `PORTAL_NIL_POOL = 0.7 × next year's budget`. Points held on an offer return when he goes elsewhere; points on a signee are spent.

## 2. The rules

Let `B` be the season budget (`nil_budget` without the retention deduction, which this spec removes), `spent` the points held on the class's signees at signing day, `left = B − spent`.

**Reward.** When the offseason opens (`offseason.start`), each school earns `reward(B, season)`, a share of `B` from the season just played, summed then capped:

| Condition | Share of B |
|---|---|
| winning record (wins > losses) | 10% |
| nine or more wins (replaces the line above, not added) | 20% |
| conference champion | +10% |
| made the playoff | +10% |
| national champion | +15% |
| AD goal met (`verdicts[slug]["met"]`, your school and AI alike) | +10% |
| cap | 50% |

A losing record earns nothing beyond the other lines that apply (a losing conference champion is impossible; a losing playoff team is not). Rounded to fives (`_five`).

**Portal pool.** `pool = max(floor, left + reward)` where `floor = 0.30 × B` (the collective's portal fund, so no program enters the portal empty and the portal market stays alive). The portal no longer reads next year's budget: `PORTAL_NIL_POOL` goes. `_nil` in the portal returns `{"budget": pool, "held": {}}`, seeded at `offseason.start` for every school into `state["nil_pool"][slug] = {"left", "reward", "floor", "pool"}` so the review can show the math.

**Keep them home** spends from the same pool (`_retention_spend` deducts from `state["nil_pool"][me]["pool"]` as the entries are met); it no longer deducts from next year's budget, so `nil_retained` is removed.

**Carry-over.** After the portal closes (`stage` leaves `portal_w4`), `carry = min(unspent, cap × B_next)` where `unspent` is the pool minus retention spend minus points on portal signees, `B_next` is next year's `nil_budget`, and `cap` by program tier: tier 1 15%, tier 2 20%, tier 3 25%, tier 4 and 5 30%. `state["nil_carry"][slug] = carry`; the next season's `nil_budget` adds it (`_nil` for the class year reads `B_next + carry`). Anything above the cap is gone. The carry applies once (it is consumed when the next class's `_nil` record is created, then cleared).

**AI schools** earn, pool, retain and carry by the same rules. Their Auto-recruit spending in the class and the portal is unchanged otherwise.

## 3. Where it shows

- Recruiting header NIL meter: in the class, `held / B+carry` as today; in the portal, `held / pool`.
- The season review (`review` view) gains a line under its NIL/program block: "NIL for the portal: 60 left + 40 earned (9-4, bowl win, AD goal met) + 0 fund = 100"; when the floor applied: "… raised to the 85 portal fund".
- The portal board header: "TRANSFER PORTAL · WEEK n OF m · 100 NIL".
- The next season's first Office card: "NIL carried over: 25 (of 135 this year)" when `carry > 0`.
- Settings/HOW_IT_WORKS: the rules in one paragraph.

## 4. Tests

- `tests/test_nil_economy.py` (native): `reward` table rows (each condition alone, the cap, a losing team with a met goal); `offseason.start` seeds `nil_pool` for every school with `pool ≥ 0.3·B`; a school with nothing left and no reward gets exactly the floor; the portal `_nil` budget equals the pool; retention spend reduces the pool; after `portal_w4` the carry equals `min(unspent, cap·B_next)` for a tier-1 and a tier-5 school; the next class's budget includes the carry once; old saves (no `nil_pool`/`nil_carry`) open the offseason and the portal.
- `tests/test_sim_golden.py` unchanged (the class week is untouched).
- `tools/check_recruiting.py` and `tools/long_run.py` report portal signings and AI NIL spend; a 10-season long run's portal totals stay within 15% of today's (quote before/after in the report).

## 5. Out of scope

Changing asks, the NIL tier itself, or the class's spending rules; a NIL screen.

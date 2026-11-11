# Promise Him the Job (design, November 11)

**Status:** decided with the player on November 11. It is queued after School Grades Phase 2.

## Why

Today a starting-job promise happens only when a recruit asks: Playing Time must be one of his priorities, he asks
about 60% of calls, and someone must be ahead of him. If he never asks, you have no way to promise him the job,
either in recruiting or in the portal.

## What

- **The action:** "Promise Him the Job", a choice on any call or visit, for high school recruits and portal entrants,
  whether or not he asks.
- **It helps land him:**
  - The promise earns `ANSWER_PROMISE` times Keeps His Word's `promise_mult`, landing harder when Playing Time is one
    of his priorities.
  - A promise he cannot believe (a better returning starter ahead of him) costs points and cools him, like today's
    hollow answer.
- **It is a real promise.** It goes on his contact as a "roster" promise. When he signs he is `promised`, judged all
  season (On Track, Slipping, Broken), and feeds Keeps His Word and his transfer chance.
- **One per recruit.**

## Two promises at one position (the player's call)

- **Both are judged on who actually starts.** Nothing breaks a promise automatically.
- **The second promise may fail.** A recruit or entrant at the same position who knows the job was already promised
  is less likely to believe you. Model this as a smaller promise worth, and a chance he reads it as hollow, scaled by
  how many open promises you hold at that group.
- **It strains the first promise.** Each player already promised at that position hears about it:
  - A recruit still on your board cools on you.
  - A committed recruit loses firmness.
  - A promised player on your roster starts his weekly record one step closer to Slipping.
  - It is a History line, and a line in his next scene: "Coach, I heard you told another kid the same thing."

## Rules this keeps

- The golden sim stays the same, and any new draw gets its own seeded stream.
- AI coaches make no promises.

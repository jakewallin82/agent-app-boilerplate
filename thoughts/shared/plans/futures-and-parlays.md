---

## Futures Betting Flow

### Context for Futures Predictions

**Provide:**
1. Last 2-3 weeks of team reflections
2. Current standings/playoff picture
3. Remaining schedule difficulty
4. Key injury timelines
5. Current odds vs historical movement

**File structure:**
```
data/futures/
├── nfl/
│   ├── super-bowl/
│   │   └── 2025-12-02_assessment.md
│   ├── conference/
│   └── division/
├── nba/
│   ├── championship/
│   ├── conference/
│   └── mvp/
└── ...
```

**When to update futures:**
- Weekly during season
- After major injuries
- After significant line movement

---

## Parlay Construction Flow

### Same-Game Parlay (SGP) Builder

**Approach:**

1. Start with game prediction
2. Identify correlated outcomes:
   - Winning team + over (if blowout expected)
   - Losing team QB passing yards + over (playing from behind)
   - Running back yards + under (if team trailing)
3. Build narrative-consistent legs
4. Shop odds across books (house edge varies 15-25%)

**Output format:**

```markdown
# SGP: BUF @ NYJ

## Legs:

1. Buffalo ML (-180)
2. Josh Allen Over 1.5 Pass TDs (-150)
3. James Cook Over 65.5 Rush Yards (-115)

## Correlation Analysis:

- Buffalo win → Cook runs more (positive correlation)
- Buffalo win → Allen TDs likely (positive correlation)
- All legs align with blowout narrative

## Odds Comparison:

| Book       | SGP Odds | Expected Value |
| ---------- | -------- | -------------- |
| FanDuel    | +285     | -8.2%          |
| DraftKings | +320     | -3.1%          |
| Caesars    | +340     | +0.5%          |

## Recommendation: Caesars at +340
```

---

## Portfolio Management (data/general/)

### Daily Summary

```markdown
# Daily Summary - 2025-12-02

## Active Positions

| Sport | Game/Prop       | Pick | Odds | Units | Status  |
| ----- | --------------- | ---- | ---- | ----- | ------- |
| NFL   | BUF -3.5 vs NYJ | BUF  | -110 | 2     | Pending |
| NBA   | Lakers ML       | LAL  | +150 | 1     | Pending |

## Today's Results

| Sport | Game/Prop | Pick | Result | P/L   |
| ----- | --------- | ---- | ------ | ----- |
| NHL   | BOS ML    | BOS  | W      | +1.2u |

## Running Totals

- Today: +1.2u
- Week: +4.5u
- Month: +12.3u
- Season: +45.2u
```

### Monthly Reflection

```markdown
# Monthly Reflection - November 2025

## Performance by Sport

| Sport | Picks | W-L   | Units | ROI   |
| ----- | ----- | ----- | ----- | ----- |
| NFL   | 45    | 27-18 | +8.5  | +4.2% |
| NBA   | 62    | 33-29 | +3.2  | +1.1% |
| NHL   | 38    | 19-19 | -1.5  | -0.8% |
| MLB   | --    | --    | --    | --    |
| NCAAB | 24    | 14-10 | +5.1  | +4.7% |

## Performance by Bet Type

| Type    | Picks | W-L   | Units | ROI   |
| ------- | ----- | ----- | ----- | ----- |
| Spreads | 89    | 48-41 | +6.8  | +1.7% |
| Totals  | 54    | 30-24 | +4.5  | +1.9% |
| ML      | 32    | 18-14 | +2.1  | +1.5% |
| Props   | 45    | 27-18 | +3.2  | +1.6% |

## Key Learnings

1. NFL injury research continues to provide edge
2. NBA rest predictions improving
3. NHL goalie confirmation critical
4. Props outperforming game bets

## Adjustments for December

- Increase NBA unit size (hot streak)
- Reduce NHL until goalie model improves
- Focus on NFL playoffs research
```

---

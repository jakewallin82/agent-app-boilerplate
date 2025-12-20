### Option 4: Portfolio-Centric Architecture

**Structure:**

```
data/
├── sports/
│   ├── nfl/...
│   ├── nba/...
│   └── ...
├── portfolio/
│   ├── active-positions/
│   │   ├── {date}_positions.md
│   │   └── ...
│   ├── settled/
│   │   ├── {date}_results.md
│   │   └── ...
│   ├── bankroll/
│   │   └── bankroll.json
│   ├── performance/
│   │   ├── daily/
│   │   ├── weekly/
│   │   ├── monthly/
│   │   └── all-time.md
│   └── strategies/
│       ├── kelly-criterion.md
│       └── unit-sizing.md
└── research/
    └── ...

agents/
├── portfolio-manager.md          # Central orchestrator
├── position-sizer.md             # Kelly criterion / unit sizing
├── risk-analyzer.md              # Correlation, exposure tracking
├── sports/
│   └── {sport-specific agents}
└── CLAUDE.md                     # Routes to portfolio-manager
```

**Pros:**

- Treats betting as portfolio management (professional approach)
- Built-in bankroll and risk management
- Cross-sport correlation awareness
- Performance tracking is first-class

**Cons:**

- Higher complexity for casual users
- Requires financial modeling knowledge
- More stateful (bankroll tracking)
- Overkill for recreational use

**Best For:** Professional/serious bettors managing real money across sports.

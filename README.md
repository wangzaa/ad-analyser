# HK Telco Ads Dashboard

Analytics dashboard for analyzing Meta and TikTok advertising campaigns for Hong Kong telco products (5G plans, roaming passes, gamer plans).

## Features

- **Campaign Performance Analysis**: View spending, impressions, CTR, and CPA across platforms
- **CSV Data Import**: Drag-and-drop or click to upload CSV files from Meta/TikTok
- **Multi-Platform Support**: Automatically detects and normalizes data from Meta and TikTok
- **Customer Value Analysis**: Analyze customer data and LTV metrics
- **Data Visualization**: Sparklines, donut charts, and performance metrics

## Getting Started

### Local Development

```bash
# Frontend — start a local server (serves frontend/)
npm start
# Then open http://localhost:8000 in your browser

# ETL — install the Python package in editable mode
pip install -e ".[dev]"

# Run ETL via console scripts
etl-csv-to-sql          # reads data/raw/crm_customers_v2.csv → sql/generated/
build-bulk-inserts      # bulk INSERTs → sql/generated/
```

### Repository Layout

```
frontend/   # static dashboard (index.html, dashboard.js, JSX, column_aliases.json)
etl/        # Python ETL package (csv → SQL transformers)
sql/
  generated/   # ETL output, regenerated from etl/
  migrations/  # hand-written migrations
data/
  raw/        # untouched source CSVs (gitignored if large)
  interim/    # mid-pipeline artifacts
  processed/  # final outputs
docs/       # plans + specs
```

### Data Format

Upload CSV files with the following columns:

**Meta Export**: Campaign Name, Ad Set Name, Ad Name, Amount Spent (HKD), Impressions, Clicks, Cost Per Link Click (HKD), Frequency

**TikTok Export**: Campaign Name, Ad Set Name, Ad Name, Spend (RMB), Impressions, Clicks, Cost per Result (RMB), Reach

**CRM Data**: customer_id, product_type, ltv, acquisition_cost, and other customer metrics

## Deployment

### GitHub Pages

```bash
# Initialize git (if not already done)
git init
git remote add origin https://github.com/wangzaa/ad-analyser.git

# Push to master
git add .
git commit -m "Initial commit"
git push -u origin master

# Create and deploy to gh-pages branch (only frontend/ is published)
git subtree push --prefix frontend origin gh-pages
```

Then configure GitHub Pages:
1. Go to repository Settings → Pages
2. Set Source to `Deploy from a branch`
3. Select `gh-pages` branch
4. Domain will be available at `https://wangzaa.github.io/ad-analyser`

To set up custom domain (`analyse.altree.co`):
1. Add CNAME record to your DNS provider pointing to `wangzaa.github.io`
2. In GitHub Pages settings, add custom domain `analyse.altree.co`
3. Enable HTTPS

## Technology Stack

- React 18 (via CDN)
- Babel Standalone for JSX
- Pure HTML/CSS (no build process required)
- CSV parsing from scratch

## License

MIT

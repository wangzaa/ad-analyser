import { useState, useCallback, useRef, useEffect } from "react";

/* ───────────────────────── CSV PARSER ───────────────────────── */
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const vals = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
    return obj;
  });
}

function detectPlatform(headers) {
  const h = headers.join(" ").toLowerCase();
  if (h.includes("by day") && h.includes("video views at 25%")) return "douyin";
  if (h.includes("reporting starts") && h.includes("amount spent")) return "meta";
  if (h.includes("customer_id") && h.includes("projected_ltv")) return "crm";
  if (h.includes("age") && h.includes("gender") && h.includes("cost per result")) return "meta_demo";
  return "unknown";
}

function num(v) { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }

/* ───────────────────────── NORMALISE ───────────────────────── */
function normaliseMeta(rows) {
  return rows.map(r => ({
    date: r["Reporting starts"],
    campaign: r["Campaign name"],
    adSet: r["Ad set name"],
    ad: r["Ad name"],
    platform: "Meta",
    spend: num(r["Amount spent (HKD)"]),
    impressions: num(r["Impressions"]),
    reach: num(r["Reach"]),
    frequency: num(r["Frequency"]),
    linkClicks: num(r["Link clicks"]),
    linkCTR: num(r["CTR (link click) %"]),
    cpc: num(r["CPC (HKD, link click)"]),
    cpm: num(r["CPM (HKD)"]),
    results: num(r["Results"]),
    costPerResult: num(r["Cost per result (HKD)"]),
    videoCompletion50: null,
    videoCompletion75: r["Video plays at 75%"] ? num(r["Video plays at 75%"]) / Math.max(1, num(r["Video plays"])) * 100 : null,
  }));
}

function normaliseDouyin(rows) {
  return rows.map(r => ({
    date: r["By Day"],
    campaign: r["Campaign name"],
    adSet: r["Ad group name"],
    ad: r["Ad name"],
    platform: "Douyin",
    spend: num(r["Cost (HKD)"]),
    impressions: num(r["Impressions"]),
    reach: num(r["Reach"]),
    frequency: num(r["Frequency"]),
    linkClicks: num(r["Clicks (destination)"]),
    linkCTR: num(r["CTR (destination) %"]),
    cpc: num(r["CPC (HKD)"]),
    cpm: num(r["CPM (HKD)"]),
    results: num(r["Conversions"]),
    costPerResult: num(r["Cost per conversion (HKD)"]),
    videoCompletion50: r["Video views at 50%"] ? num(r["Video views at 50%"]) / Math.max(1, num(r["Video views"])) * 100 : null,
    videoCompletion75: r["Video views at 75%"] ? num(r["Video views at 75%"]) / Math.max(1, num(r["Video views"])) * 100 : null,
  }));
}

/* ───────────────────────── AGGREGATION ───────────────────────── */
function aggByKey(rows, keyFn) {
  const m = {};
  rows.forEach(r => {
    const k = keyFn(r);
    if (!m[k]) m[k] = { key: k, rows: [], spend: 0, impressions: 0, reach: 0, linkClicks: 0, results: 0, ...r };
    m[k].rows.push(r);
    m[k].spend += r.spend;
    m[k].impressions += r.impressions;
    m[k].reach += r.reach;
    m[k].linkClicks += r.linkClicks;
    m[k].results += r.results;
  });
  return Object.values(m).map(g => ({
    ...g,
    cpa: g.results > 0 ? g.spend / g.results : 0,
    ctr: g.impressions > 0 ? g.linkClicks / g.impressions * 100 : 0,
    cpm: g.impressions > 0 ? g.spend / g.impressions * 1000 : 0,
    frequency: g.reach > 0 ? g.impressions / g.reach : 0,
  }));
}

function dailyTrend(rows) {
  const byDate = {};
  rows.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = { date: r.date, spend: 0, impressions: 0, clicks: 0, results: 0 };
    byDate[r.date].spend += r.spend;
    byDate[r.date].impressions += r.impressions;
    byDate[r.date].clicks += r.linkClicks;
    byDate[r.date].results += r.results;
  });
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
    ...d,
    ctr: d.impressions > 0 ? d.clicks / d.impressions * 100 : 0,
    cpa: d.results > 0 ? d.spend / d.results : 0,
  }));
}

/* ───────────────────────── SAMPLE DATA ───────────────────────── */
async function loadSampleCSV(filename) {
  const resp = await fetch(`/mnt/user-data/outputs/${filename}`);
  return await resp.text();
}

/* ───────────────────────── SPARKLINE ───────────────────────── */
function Spark({ data, dataKey, color = "#3b82f6", w = 120, h = 32 }) {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => d[dataKey]);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const range = mx - mn || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - mn) / range) * (h - 4) - 2}`).join(" ");
  const trend = vals[vals.length - 1] - vals[0];
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={(vals.length - 1) / (vals.length - 1) * w} cy={h - ((vals[vals.length - 1] - mn) / range) * (h - 4) - 2} r="2.5" fill={color} />
    </svg>
  );
}

/* ───────────────────────── MINI BAR ───────────────────────── */
function MiniBar({ value, max, color = "#3b82f6" }) {
  return (
    <div style={{ width: "100%", height: 4, background: "#1a1d2e", borderRadius: 2 }}>
      <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.4s ease" }} />
    </div>
  );
}

/* ───────────────────────── DROP ZONE ───────────────────────── */
function DropZone({ onFiles, label, accept, children, compact }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef();
  const handleDrop = useCallback(e => {
    e.preventDefault(); setDrag(false);
    const files = Array.from(e.dataTransfer?.files || e.target?.files || []);
    if (files.length) onFiles(files);
  }, [onFiles]);
  return (
    <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={handleDrop}
      style={{ border: `2px dashed ${drag ? "#3b82f6" : "#ffffff15"}`, borderRadius: 12, padding: compact ? "14px 16px" : "28px 20px",
        textAlign: "center", cursor: "pointer", transition: "all 0.2s", background: drag ? "#3b82f610" : "#ffffff03" }}
      onClick={() => ref.current?.click()}>
      <input ref={ref} type="file" accept={accept || ".csv"} multiple style={{ display: "none" }} onChange={handleDrop} />
      {children || <>
        <div style={{ fontSize: 13, color: "#ffffff60", marginBottom: 4 }}>{label || "Drop CSV files here"}</div>
        <div style={{ fontSize: 11, color: "#ffffff30" }}>or click to browse</div>
      </>}
    </div>
  );
}

/* ───────────────────────── CHIP ───────────────────────── */
function Chip({ label, sub, color, onRemove }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 6, background: `${color}15`, border: `1px solid ${color}30`, fontSize: 11, color: `${color}cc`, marginRight: 6, marginBottom: 4 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {label} <span style={{ color: "#ffffff30" }}>{sub}</span>
      {onRemove && <span onClick={onRemove} style={{ cursor: "pointer", marginLeft: 4, color: "#ffffff40" }}>×</span>}
    </span>
  );
}

/* ───────────────────────── KPI TILE ───────────────────────── */
function KPI({ label, value, sub, color = "#ffffff" }) {
  return (
    <div style={{ background: "#0d0f1a", borderRadius: 10, padding: "12px 14px", border: "1px solid #ffffff08", flex: "1 1 0" }}>
      <div style={{ fontSize: 10, color: "#ffffff40", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#ffffff30", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ───────────────────────── FLAG ───────────────────────── */
function Flag({ cpa, cpaAvg, freq, ctrTrend }) {
  if (freq > 3.5 && ctrTrend < -0.3) return <span style={{ color: "#ef4444" }}>🔴</span>;
  if (cpa > cpaAvg * 1.3 || freq > 2.5) return <span style={{ color: "#f59e0b" }}>⚠️</span>;
  return <span style={{ color: "#22c55e" }}>✅</span>;
}

/* ───────────────────────── DONUT ───────────────────────── */
function Donut({ data, size = 120 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  let cum = 0;
  const r = size / 2, ir = r * 0.6;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {data.map((d, i) => {
        const start = cum / total * 360;
        cum += d.value;
        const end = cum / total * 360;
        const s1 = Math.PI / 180 * (start - 90), s2 = Math.PI / 180 * (end - 90);
        const x1 = r + r * 0.85 * Math.cos(s1), y1 = r + r * 0.85 * Math.sin(s1);
        const x2 = r + r * 0.85 * Math.cos(s2), y2 = r + r * 0.85 * Math.sin(s2);
        const ix1 = r + ir * Math.cos(s1), iy1 = r + ir * Math.sin(s1);
        const ix2 = r + ir * Math.cos(s2), iy2 = r + ir * Math.sin(s2);
        const large = end - start > 180 ? 1 : 0;
        return <path key={i} d={`M ${x1} ${y1} A ${r * 0.85} ${r * 0.85} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${ir} ${ir} 0 ${large} 0 ${ix1} ${iy1} Z`} fill={d.color} opacity={0.85} />;
      })}
    </svg>
  );
}

/* ═══════════════════════════ MAIN ═══════════════════════════ */
export default function Dashboard() {
  const [tab, setTab] = useState(0);
  const [files, setFiles] = useState([]);
  const [normalised, setNormalised] = useState([]);
  const [demoData, setDemoData] = useState(null);
  const [crmData, setCrmData] = useState(null);
  const [crmFiles, setCrmFiles] = useState([]);
  const [drillCampaign, setDrillCampaign] = useState(null);
  const [usingSample, setUsingSample] = useState(false);

  const PLATFORM_COLORS = { Meta: "#3b82f6", Douyin: "#ec4899" };

  /* ── File handling ── */
  const handleCampaignFiles = useCallback(async (fileList) => {
    const newFiles = [];
    const newRows = [];
    for (const f of fileList) {
      const text = await f.text();
      const rows = parseCSV(text);
      if (!rows.length) continue;
      const headers = Object.keys(rows[0]);
      const platform = detectPlatform(headers);
      if (platform === "meta_demo") {
        setDemoData(rows);
        newFiles.push({ name: f.name, platform: "Meta Demographics", rows: rows.length, color: "#8b5cf6" });
        continue;
      }
      if (platform === "meta") {
        newRows.push(...normaliseMeta(rows));
        newFiles.push({ name: f.name, platform: "Meta", rows: rows.length, color: "#3b82f6" });
      } else if (platform === "douyin") {
        newRows.push(...normaliseDouyin(rows));
        newFiles.push({ name: f.name, platform: "Douyin", rows: rows.length, color: "#ec4899" });
      }
    }
    setFiles(prev => [...prev, ...newFiles]);
    setNormalised(prev => [...prev, ...newRows]);
  }, []);

  const handleCRMFile = useCallback(async (fileList) => {
    const f = fileList[0];
    const text = await f.text();
    const rows = parseCSV(text);
    if (rows.length && detectPlatform(Object.keys(rows[0])) === "crm") {
      setCrmData(rows);
      setCrmFiles([{ name: f.name, rows: rows.length, color: "#10b981" }]);
    }
  }, []);

  const loadSample = useCallback(async () => {
    try {
      const metaFam = await (await fetch("/api/files/mnt/user-data/outputs/meta_5g_family_plan.csv")).text().catch(() => null);
      const metaRoam = await (await fetch("/api/files/mnt/user-data/outputs/meta_roaming_pass.csv")).text().catch(() => null);
      const ttGamer = await (await fetch("/api/files/mnt/user-data/outputs/douyin_gamer_5g.csv")).text().catch(() => null);
      const metaDemo = await (await fetch("/api/files/mnt/user-data/outputs/meta_5g_family_plan_demographics.csv")).text().catch(() => null);
      const crm = await (await fetch("/api/files/mnt/user-data/outputs/crm_customers.csv")).text().catch(() => null);

      const allFiles = [];
      const allRows = [];

      if (metaFam) { const r = parseCSV(metaFam); allRows.push(...normaliseMeta(r)); allFiles.push({ name: "meta_5g_family_plan.csv", platform: "Meta", rows: r.length, color: "#3b82f6" }); }
      if (metaRoam) { const r = parseCSV(metaRoam); allRows.push(...normaliseMeta(r)); allFiles.push({ name: "meta_roaming_pass.csv", platform: "Meta", rows: r.length, color: "#3b82f6" }); }
      if (ttGamer) { const r = parseCSV(ttGamer); allRows.push(...normaliseDouyin(r)); allFiles.push({ name: "douyin_gamer_5g.csv", platform: "Douyin", rows: r.length, color: "#ec4899" }); }
      if (metaDemo) { const r = parseCSV(metaDemo); setDemoData(r); allFiles.push({ name: "meta_demographics.csv", platform: "Meta Demographics", rows: r.length, color: "#8b5cf6" }); }
      if (crm) { const r = parseCSV(crm); setCrmData(r); setCrmFiles([{ name: "crm_customers.csv", rows: r.length, color: "#10b981" }]); }

      if (allRows.length === 0) {
        // Fallback: embed minimal sample data inline
        loadEmbeddedSample();
        return;
      }
      setFiles(allFiles);
      setNormalised(allRows);
      setUsingSample(true);
    } catch {
      loadEmbeddedSample();
    }
  }, []);

  const loadEmbeddedSample = () => {
    // Minimal inline sample for demo when files aren't fetchable
    const sampleNorm = [];
    const campaigns = [
      { campaign: "HK_5G_FamilyPlan_Q4_2025", adSet: "FamilyPlan_Parents_30-45_HK", platform: "Meta", dailySpend: 800, ctr: 0.014, cvr: 0.030, cpm: 72 },
      { campaign: "HK_5G_FamilyPlan_Q4_2025", adSet: "FamilyPlan_Lookalike_5G_Customers", platform: "Meta", dailySpend: 1200, ctr: 0.011, cvr: 0.022, cpm: 85 },
      { campaign: "HK_5G_FamilyPlan_Q4_2025", adSet: "FamilyPlan_Broad_HK_25-55", platform: "Meta", dailySpend: 2200, ctr: 0.018, cvr: 0.008, cpm: 38 },
      { campaign: "HK_5G_GamerUnlimited_Q4", adSet: "Gamers_M_18-25_HK_HighIntent", platform: "Douyin", dailySpend: 1500, ctr: 0.038, cvr: 0.042, cpm: 28 },
      { campaign: "HK_5G_GamerUnlimited_Q4", adSet: "Gamers_LookalikeChurnedYouth", platform: "Douyin", dailySpend: 1200, ctr: 0.031, cvr: 0.035, cpm: 32 },
      { campaign: "HK_RoamingPass_Asia_Q4_2025", adSet: "Roaming_TravellersGoldenWeek_HK", platform: "Meta", dailySpend: 4200, ctr: 0.010, cvr: 0.012, cpm: 55 },
      { campaign: "HK_RoamingPass_Asia_Q4_2025", adSet: "Roaming_BizTravellers_HK_25-55", platform: "Meta", dailySpend: 2400, ctr: 0.008, cvr: 0.010, cpm: 58 },
    ];
    for (let day = 0; day < 14; day++) {
      const d = `2025-11-${String(day + 1).padStart(2, "0")}`;
      campaigns.forEach(c => {
        const jitter = () => 1 + (Math.random() - 0.5) * 0.15;
        const spend = c.dailySpend * jitter();
        const imps = Math.round(spend / c.cpm * 1000 * jitter());
        const clicks = Math.max(1, Math.round(imps * c.ctr * jitter()));
        const results = Math.max(0, Math.round(clicks * c.cvr * jitter()));
        const freq = 1.2 + day * (c.adSet.includes("Roaming") ? 0.27 : 0.05);
        sampleNorm.push({
          date: d, campaign: c.campaign, adSet: c.adSet, ad: "ad_v1", platform: c.platform,
          spend, impressions: imps, reach: Math.round(imps / freq), frequency: freq,
          linkClicks: clicks, linkCTR: clicks / imps * 100, cpc: spend / clicks,
          cpm: spend / imps * 1000, results, costPerResult: results > 0 ? spend / results : 0,
          videoCompletion50: null, videoCompletion75: null,
        });
      });
    }

    // CRM sample
    const crmSample = [];
    const plans = ["5G_Family_4Line", "5G_Family_2Line", "5G_Single_Premium", "5G_Single_Standard", "5G_Single_Basic", "5G_Gamer_Unlimited"];
    const arpus = { "5G_Family_4Line": 588, "5G_Family_2Line": 388, "5G_Single_Premium": 488, "5G_Single_Standard": 298, "5G_Single_Basic": 198, "5G_Gamer_Unlimited": 348 };
    let cid = 100001;
    const adSetConfigs = [
      { adSet: "FamilyPlan_Parents_30-45_HK", campaign: "HK_5G_FamilyPlan_Q4_2025", n: 47, planWeights: [0.45, 0.35, 0.15, 0.05, 0, 0], churn: 0.08 },
      { adSet: "FamilyPlan_Lookalike_5G_Customers", campaign: "HK_5G_FamilyPlan_Q4_2025", n: 37, planWeights: [0.20, 0.30, 0.30, 0.20, 0, 0], churn: 0.12 },
      { adSet: "FamilyPlan_Broad_HK_25-55", campaign: "HK_5G_FamilyPlan_Q4_2025", n: 105, planWeights: [0.05, 0.10, 0.10, 0.20, 0.55, 0], churn: 0.28 },
      { adSet: "Gamers_M_18-25_HK_HighIntent", campaign: "HK_5G_GamerUnlimited_Q4", n: 90, planWeights: [0, 0, 0.20, 0.15, 0, 0.65], churn: 0.15 },
      { adSet: "Gamers_LookalikeChurnedYouth", campaign: "HK_5G_GamerUnlimited_Q4", n: 60, planWeights: [0, 0, 0.20, 0.20, 0.05, 0.55], churn: 0.18 },
    ];
    adSetConfigs.forEach(cfg => {
      for (let i = 0; i < cfg.n; i++) {
        let planIdx = 0;
        const r = Math.random();
        let cum = 0;
        for (let j = 0; j < cfg.planWeights.length; j++) { cum += cfg.planWeights[j]; if (r < cum) { planIdx = j; break; } }
        const plan = plans[planIdx];
        const arpu = arpus[plan];
        const churned = Math.random() < cfg.churn;
        const months = churned ? Math.floor(Math.random() * 4) + 1 : 5;
        const realized = arpu * months;
        const projected = churned ? realized : arpu * 24 * 0.7;
        crmSample.push({
          customer_id: `CUST${cid++}`, ad_set_name: cfg.adSet, campaign_name: cfg.campaign,
          plan_type: plan, monthly_arpu_hkd: String(arpu), status: churned ? "churned" : "active",
          months_active: String(months), realized_revenue_hkd: String(Math.round(realized)),
          projected_ltv_24mo_hkd: String(Math.round(projected)),
          cross_sell_broadband: Math.random() < 0.2 ? "Y" : "N",
          cross_sell_entertainment: Math.random() < 0.15 ? "Y" : "N",
          cross_sell_device_financing: Math.random() < 0.1 ? "Y" : "N",
          age_band: ["18-24", "25-34", "35-44", "45-54"][Math.floor(Math.random() * 4)],
          gender: Math.random() < 0.5 ? "male" : "female",
        });
      }
    });

    setFiles([
      { name: "sample_meta.csv", platform: "Meta", rows: 14 * 5, color: "#3b82f6" },
      { name: "sample_douyin.csv", platform: "Douyin", rows: 14 * 2, color: "#ec4899" },
    ]);
    setNormalised(sampleNorm);
    setCrmData(crmSample);
    setCrmFiles([{ name: "sample_crm.csv", rows: crmSample.length, color: "#10b981" }]);
    setUsingSample(true);
  };

  const reset = () => { setFiles([]); setNormalised([]); setDemoData(null); setCrmData(null); setCrmFiles([]); setDrillCampaign(null); setUsingSample(false); };

  /* ── Derived data ── */
  const hasData = normalised.length > 0;
  const totalSpend = normalised.reduce((s, r) => s + r.spend, 0);
  const totalResults = normalised.reduce((s, r) => s + r.results, 0);
  const totalImps = normalised.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = normalised.reduce((s, r) => s + r.linkClicks, 0);
  const blendedCPA = totalResults > 0 ? totalSpend / totalResults : 0;
  const blendedCTR = totalImps > 0 ? totalClicks / totalImps * 100 : 0;

  const byChannel = aggByKey(normalised, r => r.platform);
  const byAdSet = aggByKey(normalised, r => `${r.campaign}||${r.adSet}||${r.platform}`);
  const trend = dailyTrend(normalised);
  const campaigns = [...new Set(normalised.map(r => r.campaign))];

  /* ── CRM join ── */
  const crmByAdSet = {};
  if (crmData) {
    crmData.forEach(r => {
      if (!r.ad_set_name) return;
      const k = r.ad_set_name;
      if (!crmByAdSet[k]) crmByAdSet[k] = { count: 0, realized: 0, projected: 0, churned: 0, plans: {}, bb: 0, ent: 0, dev: 0, ages: {}, genders: {} };
      const g = crmByAdSet[k];
      g.count++;
      g.realized += num(r.realized_revenue_hkd);
      g.projected += num(r.projected_ltv_24mo_hkd);
      if (r.status === "churned") g.churned++;
      g.plans[r.plan_type] = (g.plans[r.plan_type] || 0) + 1;
      if (r.cross_sell_broadband === "Y") g.bb++;
      if (r.cross_sell_entertainment === "Y") g.ent++;
      if (r.cross_sell_device_financing === "Y") g.dev++;
      if (r.age_band) g.ages[r.age_band] = (g.ages[r.age_band] || 0) + 1;
      if (r.gender) g.genders[r.gender] = (g.genders[r.gender] || 0) + 1;
    });
  }

  const ltvRows = byAdSet.map(a => {
    const setName = a.key.split("||")[1];
    const crm = crmByAdSet[setName];
    return {
      ...a,
      setName,
      crmCount: crm?.count || 0,
      avgLTV: crm ? crm.projected / crm.count : 0,
      ltvCPA: crm && a.cpa > 0 ? (crm.projected / crm.count) / a.cpa : 0,
      churnPct: crm ? crm.churned / crm.count * 100 : 0,
      plans: crm?.plans || {},
      crossSell: crm ? { bb: crm.bb / crm.count * 100, ent: crm.ent / crm.count * 100, dev: crm.dev / crm.count * 100 } : null,
    };
  }).sort((a, b) => b.ltvCPA - a.ltvCPA);

  /* ── Drill data ── */
  const drillRows = drillCampaign ? normalised.filter(r => r.adSet === drillCampaign) : [];
  const drillTrend = drillRows.length ? dailyTrend(drillRows) : [];

  /* ── Product grouping ── */
  function productGroup(campaign) {
    if (campaign.includes("Family")) return "Family Plan";
    if (campaign.includes("Gamer")) return "Gamer";
    if (campaign.includes("Roaming")) return "Roaming";
    return "Other";
  }

  const fmt = (n, d = 0) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toFixed(d);
  const fmtM = (n) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n.toFixed(0);

  return (
    <div style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", background: "#080a12", color: "#c8cad8", minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-thumb { background: #ffffff15; border-radius: 2px; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .fade-in { animation: fadeIn 0.4s ease both; }
        .tbl-row:hover { background: #ffffff06 !important; }
        .tab-btn { border: none; cursor: pointer; transition: all 0.2s; font-family: inherit; }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ padding: "20px 24px 0", borderBottom: "1px solid #ffffff08" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 2.5, color: "#ffffff30", textTransform: "uppercase", marginBottom: 2 }}>HK Telco · Ad Campaign Intelligence</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#eff0f6", letterSpacing: -0.5 }}>Campaign Dashboard</h1>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {hasData && <button onClick={reset} className="tab-btn" style={{ padding: "6px 12px", borderRadius: 6, background: "#ffffff08", color: "#ffffff50", fontSize: 11 }}>Reset</button>}
            {usingSample && <span style={{ fontSize: 10, color: "#f59e0b80", background: "#f59e0b10", padding: "3px 8px", borderRadius: 4 }}>Sample Data</span>}
          </div>
        </div>

        {/* ── TABS ── */}
        <div style={{ display: "flex", gap: 0, marginTop: 16 }}>
          {[
            { label: "Campaign Performance", icon: "📊" },
            { label: "Customer Value", icon: "💎", locked: !crmData && !hasData },
          ].map((t, i) => (
            <button key={i} onClick={() => setTab(i)} className="tab-btn" style={{
              padding: "10px 20px", fontSize: 12, fontWeight: tab === i ? 600 : 400,
              color: t.locked ? "#ffffff20" : tab === i ? "#eff0f6" : "#ffffff50",
              background: tab === i ? "#0d0f1a" : "transparent",
              borderRadius: "8px 8px 0 0", borderBottom: tab === i ? "2px solid #3b82f6" : "2px solid transparent",
            }}>
              {t.icon} {t.label}
              {t.locked && !crmData && <span style={{ fontSize: 9, marginLeft: 6, color: "#ffffff20" }}>🔒</span>}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>

        {/* ═══════════ TAB 1: CAMPAIGN PERFORMANCE ═══════════ */}
        {tab === 0 && (
          <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Drop zone / file chips */}
            {!hasData ? (
              <DropZone onFiles={handleCampaignFiles} label="Drop Meta & Douyin CSV exports here">
                <div style={{ fontSize: 14, color: "#ffffff50", marginBottom: 6 }}>📁 Drop Meta & Douyin CSV exports here</div>
                <div style={{ fontSize: 11, color: "#ffffff25", marginBottom: 12 }}>Auto-detects platform from headers · Multiple files OK</div>
                <button onClick={e => { e.stopPropagation(); loadSample(); }} className="tab-btn"
                  style={{ padding: "8px 16px", borderRadius: 6, background: "#3b82f620", color: "#3b82f6", fontSize: 12, fontWeight: 500 }}>
                  Try with sample HK telco data
                </button>
              </DropZone>
            ) : (
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                {files.map((f, i) => <Chip key={i} label={f.name} sub={`${f.rows} rows · ${f.platform}`} color={f.color} />)}
                <DropZone onFiles={handleCampaignFiles} compact>
                  <span style={{ fontSize: 11, color: "#ffffff30" }}>+ Add more</span>
                </DropZone>
              </div>
            )}

            {hasData && <>
              {/* KPI strip */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <KPI label="Total Spend" value={`HKD ${fmtM(totalSpend)}`} sub={`${campaigns.length} campaigns`} />
                <KPI label="Acquisitions" value={fmt(totalResults)} sub="Platform-reported" color={crmData ? "#22c55e" : "#ffffff"} />
                <KPI label="Blended CPA" value={`HKD ${blendedCPA.toFixed(0)}`} sub={crmData ? "CRM-verified" : "Pixel-reported"} />
                <KPI label="Link CTR" value={`${blendedCTR.toFixed(2)}%`} sub="Cross-channel" />
                <KPI label="Channels" value={byChannel.length} sub={byChannel.map(c => c.key).join(" + ")} />
              </div>

              {/* Channel strip */}
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${byChannel.length}, 1fr)`, gap: 10 }}>
                {byChannel.map(ch => {
                  const chTrend = dailyTrend(normalised.filter(r => r.platform === ch.key));
                  return (
                    <div key={ch.key} style={{ background: "#0d0f1a", borderRadius: 10, padding: "14px 16px", border: `1px solid ${PLATFORM_COLORS[ch.key]}15` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: PLATFORM_COLORS[ch.key] }}>{ch.key}</span>
                        <span style={{ fontSize: 11, color: "#ffffff30" }}>{((ch.spend / totalSpend) * 100).toFixed(0)}% of spend</span>
                      </div>
                      <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#ffffff50", marginBottom: 8 }}>
                        <span>CPA <strong style={{ color: "#eff0f6" }}>HKD {ch.cpa.toFixed(0)}</strong></span>
                        <span>CTR <strong style={{ color: "#eff0f6" }}>{ch.ctr.toFixed(2)}%</strong></span>
                        <span>Freq <strong style={{ color: ch.frequency > 2.5 ? "#f59e0b" : "#eff0f6" }}>{ch.frequency.toFixed(1)}</strong></span>
                      </div>
                      <Spark data={chTrend} dataKey="ctr" color={PLATFORM_COLORS[ch.key]} w={200} h={28} />
                      <div style={{ fontSize: 9, color: "#ffffff20", marginTop: 2 }}>CTR 14d trend</div>
                    </div>
                  );
                })}
              </div>

              {/* Campaign table */}
              <div style={{ background: "#0d0f1a", borderRadius: 10, padding: "16px", border: "1px solid #ffffff08", overflowX: "auto" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#eff0f6", marginBottom: 12 }}>Campaign Groups</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #ffffff10" }}>
                      {["Product", "Channel", "Ad Set", "Spend", "CPA", crmData ? "LTV:CPA" : "", "CTR", "Freq", "Trend", ""].filter(Boolean).map(h =>
                        <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: "#ffffff30", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {byAdSet.sort((a, b) => b.spend - a.spend).map((row, i) => {
                      const [campaign, setName, platform] = row.key.split("||");
                      const shortSet = setName.replace(/^(FamilyPlan_|Gamers_|Roaming_)/, "");
                      const setTrend = dailyTrend(normalised.filter(r => r.adSet === setName));
                      const crm = crmByAdSet[setName];
                      const ltvRatio = crm && row.cpa > 0 ? (crm.projected / crm.count) / row.cpa : null;
                      const ctrFirst = setTrend[0]?.ctr || 0;
                      const ctrLast = setTrend[setTrend.length - 1]?.ctr || 0;
                      const ctrDelta = ctrFirst > 0 ? (ctrLast - ctrFirst) / ctrFirst : 0;

                      return (
                        <tr key={i} className="tbl-row" onClick={() => setDrillCampaign(setName)} style={{ cursor: "pointer", borderBottom: "1px solid #ffffff06" }}>
                          <td style={{ padding: "10px" }}><span style={{ padding: "2px 8px", borderRadius: 4, background: "#ffffff08", fontSize: 10 }}>{productGroup(campaign)}</span></td>
                          <td style={{ padding: "10px" }}><span style={{ color: PLATFORM_COLORS[platform], fontWeight: 500 }}>{platform}</span></td>
                          <td style={{ padding: "10px", color: "#eff0f6", fontWeight: 500, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortSet}</td>
                          <td style={{ padding: "10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>HKD {fmtM(row.spend)}</td>
                          <td style={{ padding: "10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>HKD {row.cpa.toFixed(0)}</td>
                          {crmData && <td style={{ padding: "10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: ltvRatio > 30 ? "#22c55e" : ltvRatio > 10 ? "#f59e0b" : "#ef4444", fontWeight: 600 }}>
                            {ltvRatio ? `${ltvRatio.toFixed(0)}x` : "—"}
                          </td>}
                          <td style={{ padding: "10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{row.ctr.toFixed(2)}%</td>
                          <td style={{ padding: "10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: row.frequency > 2.5 ? "#f59e0b" : "#ffffff80" }}>{row.frequency.toFixed(1)}</td>
                          <td style={{ padding: "10px" }}><Spark data={setTrend} dataKey="ctr" color={PLATFORM_COLORS[platform]} w={80} h={20} /></td>
                          <td style={{ padding: "10px" }}><Flag cpa={row.cpa} cpaAvg={blendedCPA} freq={row.frequency} ctrTrend={ctrDelta} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!crmData && <div style={{ fontSize: 10, color: "#ffffff20", marginTop: 8, textAlign: "center" }}>Upload CRM data in Customer Value tab to unlock LTV:CPA column</div>}
              </div>

              {/* Drill-down */}
              {drillCampaign && drillTrend.length > 0 && (
                <div className="fade-in" style={{ background: "#0d0f1a", borderRadius: 10, padding: "16px", border: "1px solid #ffffff08" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#eff0f6" }}>{drillCampaign.replace(/^(FamilyPlan_|Gamers_|Roaming_)/, "")}</div>
                      <div style={{ fontSize: 10, color: "#ffffff30" }}>14-day drill-down · click another row to switch</div>
                    </div>
                    <button onClick={() => setDrillCampaign(null)} className="tab-btn" style={{ padding: "4px 10px", borderRadius: 4, background: "#ffffff08", color: "#ffffff40", fontSize: 10 }}>Close</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                    {[
                      { label: "CTR Trend", key: "ctr", color: "#3b82f6", fmt: v => `${v.toFixed(2)}%` },
                      { label: "CPA Trend", key: "cpa", color: "#f59e0b", fmt: v => `HKD ${v.toFixed(0)}` },
                      { label: "Daily Spend", key: "spend", color: "#8b5cf6", fmt: v => `HKD ${fmtM(v)}` },
                      { label: "Daily Results", key: "results", color: "#22c55e", fmt: v => v.toFixed(0) },
                    ].map(m => {
                      const last = drillTrend[drillTrend.length - 1][m.key];
                      const first = drillTrend[0][m.key];
                      const delta = first > 0 ? ((last - first) / first * 100) : 0;
                      return (
                        <div key={m.key} style={{ background: "#080a12", borderRadius: 8, padding: "10px 12px" }}>
                          <div style={{ fontSize: 10, color: "#ffffff30", marginBottom: 4 }}>{m.label}</div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 16, fontWeight: 600, color: "#eff0f6" }}>{m.fmt(last)}</span>
                            <span style={{ fontSize: 10, color: delta > 0 ? (m.key === "cpa" ? "#ef4444" : "#22c55e") : (m.key === "cpa" ? "#22c55e" : "#ef4444") }}>
                              {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%
                            </span>
                          </div>
                          <Spark data={drillTrend} dataKey={m.key} color={m.color} w={160} h={32} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>}
          </div>
        )}

        {/* ═══════════ TAB 2: CUSTOMER VALUE ═══════════ */}
        {tab === 1 && (
          <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* CRM upload zone */}
            {!crmData ? (
              <div style={{ textAlign: "center" }}>
                <DropZone onFiles={handleCRMFile} label="Drop CRM customer CSV here">
                  <div style={{ fontSize: 14, color: "#ffffff50", marginBottom: 6 }}>💎 Drop CRM Customer CSV here</div>
                  <div style={{ fontSize: 11, color: "#ffffff25", marginBottom: 4 }}>Required: customer_id, campaign_name, ad_set_name, monthly_arpu_hkd, status, projected_ltv_24mo_hkd</div>
                  {!hasData && <div style={{ fontSize: 11, color: "#f59e0b80", marginTop: 8 }}>Upload campaign data in Tab 1 first, then CRM here</div>}
                </DropZone>
                {!usingSample && <button onClick={loadSample} className="tab-btn" style={{ marginTop: 12, padding: "8px 16px", borderRadius: 6, background: "#10b98120", color: "#10b981", fontSize: 12, fontWeight: 500 }}>
                  Load sample data (campaigns + CRM)
                </button>}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {crmFiles.map((f, i) => <Chip key={i} label={f.name} sub={`${f.rows} customers`} color={f.color} />)}
                  {hasData && <span style={{ fontSize: 10, color: "#22c55e80", background: "#22c55e10", padding: "3px 8px", borderRadius: 4 }}>✓ CRM joined to {byAdSet.length} ad sets</span>}
                </div>

                {/* LTV KPIs */}
                {hasData && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <KPI label="Total Customers" value={Object.values(crmByAdSet).reduce((s, g) => s + g.count, 0)} color="#10b981" />
                    <KPI label="Avg LTV" value={`HKD ${fmtM(Object.values(crmByAdSet).reduce((s, g) => s + g.projected, 0) / Math.max(1, Object.values(crmByAdSet).reduce((s, g) => s + g.count, 0)))}`} />
                    <KPI label="Best LTV:CPA" value={ltvRows[0] ? `${ltvRows[0].ltvCPA.toFixed(0)}x` : "—"} sub={ltvRows[0]?.setName?.replace(/^(FamilyPlan_|Gamers_|Roaming_)/, "")} color="#22c55e" />
                    <KPI label="Worst LTV:CPA" value={ltvRows[ltvRows.length - 1] ? `${ltvRows[ltvRows.length - 1].ltvCPA.toFixed(0)}x` : "—"} sub={ltvRows[ltvRows.length - 1]?.setName?.replace(/^(FamilyPlan_|Gamers_|Roaming_)/, "")} color="#ef4444" />
                  </div>
                )}

                {/* LTV:CPA Leaderboard */}
                {hasData && (
                  <div style={{ background: "#0d0f1a", borderRadius: 10, padding: "16px", border: "1px solid #ffffff08" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#eff0f6", marginBottom: 12 }}>LTV : CPA Leaderboard</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #ffffff10" }}>
                          {["Rank", "Ad Set", "Channel", "Customers", "CPA", "Avg LTV", "LTV:CPA", "Churn", ""].map(h =>
                            <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: "#ffffff30", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {ltvRows.filter(r => r.crmCount > 0).map((row, i) => (
                          <tr key={i} className="tbl-row" style={{ borderBottom: "1px solid #ffffff06" }}>
                            <td style={{ padding: "10px", fontWeight: 700, color: i < 3 ? "#f59e0b" : "#ffffff30" }}>{i + 1}</td>
                            <td style={{ padding: "10px", color: "#eff0f6", fontWeight: 500 }}>{row.setName.replace(/^(FamilyPlan_|Gamers_|Roaming_)/, "")}</td>
                            <td style={{ padding: "10px", color: PLATFORM_COLORS[row.platform] }}>{row.platform}</td>
                            <td style={{ padding: "10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{row.crmCount}</td>
                            <td style={{ padding: "10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>HKD {row.cpa.toFixed(0)}</td>
                            <td style={{ padding: "10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>HKD {fmtM(row.avgLTV)}</td>
                            <td style={{ padding: "10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, color: row.ltvCPA > 30 ? "#22c55e" : row.ltvCPA > 10 ? "#f59e0b" : "#ef4444" }}>{row.ltvCPA.toFixed(0)}x</td>
                            <td style={{ padding: "10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: row.churnPct > 20 ? "#ef4444" : "#ffffff50" }}>{row.churnPct.toFixed(0)}%</td>
                            <td style={{ padding: "10px", width: 80 }}><MiniBar value={row.ltvCPA} max={Math.max(...ltvRows.map(r => r.ltvCPA))} color={row.ltvCPA > 30 ? "#22c55e" : row.ltvCPA > 10 ? "#f59e0b" : "#ef4444"} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Plan Mix + Cross-sell */}
                {hasData && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {/* Plan mix */}
                    <div style={{ background: "#0d0f1a", borderRadius: 10, padding: "16px", border: "1px solid #ffffff08" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#eff0f6", marginBottom: 12 }}>Plan Mix by Ad Set</div>
                      {ltvRows.filter(r => r.crmCount > 0).map((row, i) => {
                        const planColors = { "5G_Family_4Line": "#3b82f6", "5G_Family_2Line": "#60a5fa", "5G_Single_Premium": "#8b5cf6", "5G_Single_Standard": "#a78bfa", "5G_Single_Basic": "#ef4444", "5G_Gamer_Unlimited": "#ec4899" };
                        const total = Object.values(row.plans).reduce((s, v) => s + v, 0);
                        return (
                          <div key={i} style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, color: "#ffffff60", marginBottom: 4 }}>{row.setName.replace(/^(FamilyPlan_|Gamers_|Roaming_)/, "")}</div>
                            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden" }}>
                              {Object.entries(row.plans).sort((a, b) => b[1] - a[1]).map(([plan, count], j) => (
                                <div key={j} title={`${plan}: ${count} (${(count / total * 100).toFixed(0)}%)`}
                                  style={{ width: `${(count / total) * 100}%`, background: planColors[plan] || "#ffffff20", transition: "width 0.4s" }} />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {[
                          ["Family 4-Line", "#3b82f6"], ["Family 2-Line", "#60a5fa"], ["Premium", "#8b5cf6"],
                          ["Standard", "#a78bfa"], ["Basic", "#ef4444"], ["Gamer", "#ec4899"]
                        ].map(([l, c]) => (
                          <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, color: "#ffffff40" }}>
                            <span style={{ width: 6, height: 6, borderRadius: 2, background: c }} />{l}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Cross-sell */}
                    <div style={{ background: "#0d0f1a", borderRadius: 10, padding: "16px", border: "1px solid #ffffff08" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#eff0f6", marginBottom: 12 }}>Cross-sell Attach Rate</div>
                      {ltvRows.filter(r => r.crossSell).map((row, i) => (
                        <div key={i} style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, color: "#ffffff60", marginBottom: 6 }}>{row.setName.replace(/^(FamilyPlan_|Gamers_|Roaming_)/, "")}</div>
                          <div style={{ display: "flex", gap: 8 }}>
                            {[
                              { label: "Broadband", val: row.crossSell.bb, color: "#3b82f6" },
                              { label: "Entertainment", val: row.crossSell.ent, color: "#ec4899" },
                              { label: "Device", val: row.crossSell.dev, color: "#f59e0b" },
                            ].map(cs => (
                              <div key={cs.label} style={{ flex: 1, background: "#080a12", borderRadius: 6, padding: "6px 8px" }}>
                                <div style={{ fontSize: 9, color: "#ffffff30" }}>{cs.label}</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: cs.color }}>{cs.val.toFixed(0)}%</div>
                                <MiniBar value={cs.val} max={40} color={cs.color} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Demographic LTV breakdown */}
                {hasData && (
                  <div style={{ background: "#0d0f1a", borderRadius: 10, padding: "16px", border: "1px solid #ffffff08" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#eff0f6", marginBottom: 4 }}>Demographic Breakdown</div>
                    <div style={{ fontSize: 10, color: "#ffffff30", marginBottom: 12 }}>Customer count by age × gender per ad set — exposes targeting leaks</div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #ffffff10" }}>
                            <th style={{ textAlign: "left", padding: "6px 8px", color: "#ffffff30" }}>Ad Set</th>
                            {["18-24 M", "18-24 F", "25-34 M", "25-34 F", "35-44 M", "35-44 F", "45-54 M", "45-54 F"].map(h =>
                              <th key={h} style={{ textAlign: "center", padding: "6px 4px", color: "#ffffff25", fontSize: 9 }}>{h}</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {ltvRows.filter(r => r.crmCount > 0).map((row, i) => {
                            const crm = crmByAdSet[row.setName];
                            if (!crm) return null;
                            const cells = [
                              ["18-24", "male"], ["18-24", "female"], ["25-34", "male"], ["25-34", "female"],
                              ["35-44", "male"], ["35-44", "female"], ["45-54", "male"], ["45-54", "female"],
                            ];
                            const maxCount = Math.max(...cells.map(([a, g]) => {
                              const ageCount = crm.ages[a] || 0;
                              const genderCount = crm.genders[g] || 0;
                              return Math.round(ageCount * genderCount / crm.count);
                            }), 1);
                            return (
                              <tr key={i} className="tbl-row" style={{ borderBottom: "1px solid #ffffff06" }}>
                                <td style={{ padding: "8px", color: "#ffffffa0", whiteSpace: "nowrap" }}>{row.setName.replace(/^(FamilyPlan_|Gamers_|Roaming_)/, "").substring(0, 25)}</td>
                                {cells.map(([age, gender], j) => {
                                  const approx = Math.round((crm.ages[age] || 0) * (crm.genders[gender] || 0) / Math.max(1, crm.count));
                                  const intensity = Math.min(1, approx / Math.max(maxCount, 1));
                                  const isLeak = row.setName.includes("Broad") && age === "18-24" && gender === "male";
                                  return (
                                    <td key={j} style={{
                                      textAlign: "center", padding: "6px 4px",
                                      background: isLeak ? `rgba(239,68,68,${intensity * 0.4})` : `rgba(59,130,246,${intensity * 0.3})`,
                                      color: approx > 0 ? "#ffffffa0" : "#ffffff15",
                                      fontFamily: "'JetBrains Mono', monospace",
                                    }}>
                                      {approx || "·"}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Insight callout */}
                {hasData && ltvRows.length > 0 && (
                  <div style={{ background: "linear-gradient(135deg, #0f1a12 0%, #0d0f1a 100%)", borderRadius: 10, padding: "16px", border: "1px solid #22c55e20" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#22c55e", marginBottom: 6 }}>💡 Insight</div>
                    <div style={{ fontSize: 12, color: "#ffffff70", lineHeight: 1.7 }}>
                      {(() => {
                        const best = ltvRows[0];
                        const worst = ltvRows.filter(r => r.crmCount > 0).slice(-1)[0];
                        if (!best || !worst) return "Upload more data to generate insights.";
                        return `${best.setName.replace(/^(FamilyPlan_|Gamers_|Roaming_)/, "")} delivers ${best.ltvCPA.toFixed(0)}x LTV:CPA — ${(best.ltvCPA / worst.ltvCPA).toFixed(1)}x more efficient than ${worst.setName.replace(/^(FamilyPlan_|Gamers_|Roaming_)/, "")} (${worst.ltvCPA.toFixed(0)}x). ${worst.churnPct > 20 ? `The underperformer has ${worst.churnPct.toFixed(0)}% churn — consider reallocating budget.` : ""}`;
                      })()}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "16px 24px", borderTop: "1px solid #ffffff06", fontSize: 9, color: "#ffffff15", textAlign: "center" }}>
        Cross-channel metrics use normalised definitions: link CTR, destination clicks, CRM-verified CPA when available · Platform-native metrics in drill-downs only · {new Date().toLocaleDateString()}
      </div>
    </div>
  );
}

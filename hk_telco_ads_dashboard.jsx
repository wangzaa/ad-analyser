const { useState, useCallback, useRef, useMemo, useEffect } = React;

// ── SUPABASE ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://mlsjehglsotapwvalbor.supabase.co";
const SUPABASE_KEY = "sb_publishable_NLslAfmD7P0Nfu3MJXjSow_4Ole91rH";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const SUPABASE_SELECT_FIELDS = [
  "external_customer_id",
  "campaign_name",
  "ad_set_name",
  "plan_type",
  "monthly_arpu_hkd",
  "status",
  "realized_revenue_hkd",
  "projected_ltv_24mo_hkd",
  "months_active",
];

// ── UTILS ─────────────────────────────────────────────────────────────────────

const num = s => { const m = String(s).match(/[\d.]+/); return m ? parseFloat(m[0]) : 0; };
const fmt = n => n >= 1000000 ? `${(n/1000000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}K` : Number(n).toFixed(0);
const fmtHKD = n => `HKD ${fmt(n)}`;
const fmtDate = d => d ? d.toISOString().slice(0, 10) : '';

// Handles ISO (YYYY-MM-DD) and HK convention DD/MM/YYYY (also DD-MM-YYYY)
function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  let m = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const parseRow = line => {
    const fields = []; let inQ = false, cur = '';
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { fields.push(cur.replace(/"/g, '').trim()); cur = ''; }
      else cur += ch;
    }
    fields.push(cur.replace(/"/g, '').trim());
    return fields;
  };
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(line => {
    const vals = parseRow(line);
    const row = {};
    headers.forEach((h, j) => { row[h] = vals[j] ?? ''; });
    return row;
  });
  return { headers, rows };
}

function detectPlatform(headers) {
  const lc = headers.map(h => h.toLowerCase());
  if (lc.some(h => h.includes('customer_id'))) return 'crm';
  if (lc.some(h => h.includes('amount spent') || h.includes('reporting starts') || h.includes('amount spent (hkd)'))) return 'meta';
  if (lc.some(h => h.includes('6-second video') || h.includes('cost (hkd)') || h.includes('advertiser id') || h.includes('by day'))) return 'douyin';
  if (headers.some(h => ['Campaign Name', 'Ad Set Name', 'Ad Name'].includes(h))) return 'meta';
  if (headers.some(h => ['Campaign ID', 'Ad Group ID'].includes(h))) return 'douyin';
  return null;
}

// ── HEADER ALIAS DICTIONARY ───────────────────────────────────────────────────

// Defaults baked into the bundle. column_aliases.json (loaded at startup) overrides these.
const DEFAULT_ALIASES = {
  meta: {
    Spend:        ['Amount Spent (HKD)', 'Amount spent (HKD)', 'Spend'],
    Impressions:  ['Impressions'],
    Clicks:       ['Link Clicks', 'Link clicks', 'Clicks (All)', 'Unique Link Clicks', 'Outbound Clicks', 'Button Clicks', 'Clicks'],
    CTR:          ['CTR (Link Click-Through Rate)', 'CTR (link click) %', 'CTR (link click)', 'CTR (All)', 'CTR'],
    CPA:          ['Cost Per Link Click (HKD)', 'Cost per Result (HKD)', 'Cost per result (HKD)', 'CPC (Cost Per Click) (HKD)', 'Cost Per Click (All) (HKD)', 'CPC (HKD, link click)', 'Cost per result', 'CPC (HKD)'],
    Conversions:  ['Conversions', 'Results'],
    Frequency:    ['Frequency'],
    Date:         ['Reporting starts', 'Reporting ends', 'Date', 'Day'],
    CampaignName: ['Campaign Name', 'Campaign name'],
    AdSetName:    ['Ad Set Name', 'Ad set name'],
    AdName:       ['Ad Name', 'Ad name'],
  },
  douyin: {
    Spend:        ['Cost (HKD)', 'Spend (HKD)', 'Cost', 'Spend'],
    Impressions:  ['Impressions'],
    Clicks:       ['Clicks', 'Clicks (destination)', 'Ad Interactions', 'Click'],
    CTR:          ['CTR (%)', 'CTR (destination) %', 'CTR (destination)', 'Click-Through Rate (%)', 'CTR'],
    CPA:          ['Cost per Result (HKD)', 'Cost Per Result (HKD)', 'Cost per conversion (HKD)', 'CPC (HKD)', 'Cost Per Click (HKD)', 'Cost per Result', 'Cost Per Conversion'],
    Conversions:  ['Conversions', 'Results', 'Result'],
    Frequency:    ['Frequency'],
    Date:         ['By Day', 'Date', 'Day', 'Reporting starts'],
    CampaignName: ['Campaign Name', 'Campaign name'],
    AdSetName:    ['Ad Group Name', 'Ad Set Name', 'Ad group name'],
    AdName:       ['Ad Name', 'Ad name'],
  },
};

// Mutable, replaced when column_aliases.json loads.
let ALIASES = DEFAULT_ALIASES;

const FIELDS = [
  { key: 'Spend',        label: 'Spend' },
  { key: 'Impressions',  label: 'Impressions' },
  { key: 'Clicks',       label: 'Clicks' },
  { key: 'CTR',          label: 'CTR' },
  { key: 'CPA',          label: 'CPA' },
  { key: 'Conversions',  label: 'Conversions' },
  { key: 'Frequency',    label: 'Frequency' },
  { key: 'Date',         label: 'Date' },
  { key: 'CampaignName', label: 'Campaign Name' },
  { key: 'AdSetName',    label: 'Ad Set Name' },
  { key: 'AdName',       label: 'Ad Name' },
];

// Case- and punctuation-insensitive header normalisation
const normKey = s => String(s).toLowerCase().replace(/[()%,\-]/g, ' ').replace(/\s+/g, ' ').trim();

// Returns { Spend: 'Amount spent (HKD)', Clicks: null, ... } using the live ALIASES dict
function detectFields(headers, platform) {
  const dict = ALIASES[platform] || {};
  const normToOrig = {};
  headers.forEach(h => { normToOrig[normKey(h)] = h; });
  const result = {};
  for (const stdName of Object.keys(dict)) {
    const candidates = dict[stdName] || [];
    const matched = candidates.map(c => normToOrig[normKey(c)]).find(h => h);
    result[stdName] = matched || null;
  }
  return result;
}

// ── LOCAL STORAGE FOR USER OVERRIDES ──────────────────────────────────────────

// Key combines platform + sorted-headers fingerprint, so the same export shape reuses the user's last mapping
function overrideKey(platform, headers) {
  const fingerprint = [...headers].sort().join('|');
  return `aliasOverride::${platform}::${fingerprint}`;
}

function loadOverride(platform, headers) {
  try {
    const raw = localStorage.getItem(overrideKey(platform, headers));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveOverride(platform, headers, fieldMap) {
  try { localStorage.setItem(overrideKey(platform, headers), JSON.stringify(fieldMap)); } catch (e) {}
}

// ── NORMALISATION ─────────────────────────────────────────────────────────────

const pickByMap = (row, fieldMap, std) => {
  const h = fieldMap[std];
  return h && row[h] != null ? row[h] : '';
};

function normaliseRows(rawRows, fieldMap, platform) {
  const warnings = [];
  const out = rawRows.map(row => {
    const impressions = num(pickByMap(row, fieldMap, 'Impressions'));
    const clicks = num(pickByMap(row, fieldMap, 'Clicks'));
    const spend = num(pickByMap(row, fieldMap, 'Spend'));
    const cpa = num(pickByMap(row, fieldMap, 'CPA'));
    const ctrField = pickByMap(row, fieldMap, 'CTR');
    const ctr = ctrField ? num(ctrField) : (impressions > 0 ? (clicks / impressions) * 100 : 0);
    const date = parseDate(pickByMap(row, fieldMap, 'Date'));
    return {
      campaign_name: pickByMap(row, fieldMap, 'CampaignName'),
      ad_set_name:   pickByMap(row, fieldMap, 'AdSetName'),
      ad_name:       pickByMap(row, fieldMap, 'AdName'),
      platform: platform === 'meta' ? 'Meta' : 'Douyin',
      spend, impressions, clicks, ctr, cpa,
      frequency: num(pickByMap(row, fieldMap, 'Frequency')),
      conversions: num(pickByMap(row, fieldMap, 'Conversions')),
      date, dateStr: fmtDate(date),
    };
  });
  const zeroImp = out.filter(r => r.impressions === 0).length;
  if (zeroImp > 0) warnings.push(`${zeroImp} row${zeroImp > 1 ? 's' : ''} with zero impressions, excluded from analysis`);
  const valid = out.filter(r => r.impressions > 0);
  if (valid.length > 0 && valid.every(r => r.clicks === 0) && !fieldMap.Clicks) {
    warnings.push(`Clicks column not mapped — set it manually in the field preview below`);
  }
  return { rows: valid, warnings };
}

function aggByKey(data, key) {
  const agg = {};
  data.forEach(row => {
    const k = row[key] || '(unset)';
    if (!agg[k]) agg[k] = {
      [key]: k, spend: 0, impressions: 0, clicks: 0, conversions: 0, platform: row.platform,
      _ctrW: 0, _ctrImp: 0, _cpaW: 0, _cpaSpend: 0,
    };
    agg[k].spend += row.spend || 0;
    agg[k].impressions += row.impressions || 0;
    agg[k].clicks += row.clicks || 0;
    agg[k].conversions += row.conversions || 0;
    if (row.ctr > 0) { agg[k]._ctrW += row.ctr * row.impressions; agg[k]._ctrImp += row.impressions; }
    if (row.cpa > 0) { agg[k]._cpaW += row.cpa * row.spend; agg[k]._cpaSpend += row.spend; }
  });
  return Object.values(agg).map(r => ({
    ...r,
    ctr: r.clicks > 0 ? (r.clicks / r.impressions) * 100 : r._ctrImp > 0 ? r._ctrW / r._ctrImp : 0,
    cpa: r.clicks > 0 ? r.spend / r.clicks : r._cpaSpend > 0 ? r._cpaW / r._cpaSpend : 0,
  }));
}

const CRM_SCHEMA = [
  { name: 'customer_id',          required: true,  desc: 'Unique customer identifier (e.g., HK_CUST_00012). Used to dedupe and count customers.' },
  { name: 'campaign_name',        required: true,  desc: 'Campaign name from Meta or Douyin export. Joins CRM rows to ad data.' },
  { name: 'ad_set_name',          required: true,  desc: 'Ad set / ad group name. Primary join key for the LTV:CPA leaderboard.' },
  { name: 'monthly_arpu_hkd',     required: true,  desc: 'Monthly average revenue per user, in HKD. Used to compute long-term value.' },
  { name: 'status',               required: true,  desc: 'Customer state: active, churned, or pending. Used for retention/cohort analysis.' },
  { name: 'realized_revenue_hkd', required: true,  desc: 'Total revenue realised since acquisition, in HKD. Numerator of LTV:CPA.' },
  { name: 'plan_type',            required: false, desc: 'Plan SKU (e.g., 5G_Family_500GB). Drives the Plan Mix donut.' },
  { name: 'tenure_months',        required: false, desc: 'Months since signup. Used for cohort retention curves.' },
];

const REQUIRED_CRM = CRM_SCHEMA.filter(c => c.required).map(c => c.name);

function processCRM(rows, campaignData) {
  const headers = Object.keys(rows[0] || {}).map(h => h.toLowerCase());
  const missing = REQUIRED_CRM.filter(c => !headers.includes(c));
  if (missing.length > 0) return { error: `Column${missing.length > 1 ? 's' : ''} not found: ${missing.join(', ')}. Check your CRM export settings.` };

  const adSetNames = new Set(campaignData.map(r => r.ad_set_name));
  const warnings = [];
  let joined = 0;
  rows.forEach(r => { if (adSetNames.has(r.ad_set_name)) joined++; });

  const joinPct = rows.length > 0 ? (joined / rows.length) * 100 : 0;
  if (joinPct < 50 && campaignData.length > 0) {
    warnings.push(`Low join rate (${joinPct.toFixed(0)}%). Check that campaign/ad set names match between CRM and ad platform exports.`);
  }

  return { rows, warnings, joinRate: { joined, total: rows.length, unmatched: rows.length - joined } };
}

function buildLeaderboard(crmRows, campaignData) {
  const platformCPA = {};
  aggByKey(campaignData, 'ad_set_name').forEach(r => { platformCPA[r.ad_set_name] = r.cpa; });

  const byAdSet = {};
  crmRows.forEach(r => {
    const k = r.ad_set_name || '(unknown)';
    if (!byAdSet[k]) byAdSet[k] = { ad_set_name: k, count: 0, totalARPU: 0, totalRevenue: 0, totalAcqCost: 0 };
    byAdSet[k].count++;
    byAdSet[k].totalARPU += num(r.monthly_arpu_hkd || 0);
    byAdSet[k].totalRevenue += num(r.realized_revenue_hkd || 0);
    byAdSet[k].totalAcqCost += num(r.acquisition_cost || 0);
  });

  return Object.values(byAdSet).map(r => {
    const avgRevenue = r.totalRevenue / r.count;
    const cpa = r.totalAcqCost > 0 ? r.totalAcqCost / r.count : (platformCPA[r.ad_set_name] || 0);
    return { ...r, avgARPU: r.totalARPU / r.count, avgRevenue, cpa, ltvCpa: cpa > 0 ? avgRevenue / cpa : 0 };
  }).sort((a, b) => b.ltvCpa - a.ltvCpa);
}

function buildPlanMix(rows) {
  const mix = {};
  rows.forEach(r => { const k = r.plan_type || r.product_type || '(unknown)'; mix[k] = (mix[k] || 0) + 1; });
  return Object.entries(mix).map(([label, value]) => ({ label, value }));
}

// ── COMPONENTS ────────────────────────────────────────────────────────────────

function KPI({ label, value, sub, badge, badgeType }) {
  const badgeColor = badgeType === 'verified'
    ? { bg: '#d1fae5', text: '#065f46' }
    : { bg: '#fef3c7', text: '#92400e' };
  return (
    <div style={{ padding: '16px', background: '#fff', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: '600', color: '#111827' }}>{value}</div>
      {badge && (
        <div style={{ marginTop: '5px', display: 'inline-block', fontSize: '10px', padding: '2px 7px', background: badgeColor.bg, color: badgeColor.text, borderRadius: '4px' }}>
          {badge}
        </div>
      )}
      {sub && <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

function Donut({ data }) {
  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div style={{ color: '#9ca3af', fontSize: '13px' }}>No data</div>;
  const W = 140, H = 140, r = 58, ir = 34, cx = W / 2, cy = H / 2;
  let angle = -Math.PI / 2;
  const paths = data.map((d, i) => {
    const sa = (d.value / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + sa), y2 = cy + r * Math.sin(angle + sa);
    const x3 = cx + ir * Math.cos(angle + sa), y3 = cy + ir * Math.sin(angle + sa);
    const x4 = cx + ir * Math.cos(angle), y4 = cy + ir * Math.sin(angle);
    const lg = sa > Math.PI ? 1 : 0;
    const pd = `M${x1},${y1} A${r},${r} 0 ${lg},1 ${x2},${y2} L${x3},${y3} A${ir},${ir} 0 ${lg},0 ${x4},${y4}Z`;
    angle += sa;
    return <path key={i} d={pd} fill={COLORS[i % COLORS.length]} />;
  });
  return (
    <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={W} height={H}>{paths}</svg>
      <div style={{ fontSize: '12px', lineHeight: '1.8' }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
            <span>{d.label}: {((d.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Banner({ type, message, onDismiss }) {
  const s = { success: ['#d1fae5','#065f46'], warning: ['#fef3c7','#92400e'], error: ['#fee2e2','#991b1b'], info: ['#eff6ff','#1e40af'] }[type] || ['#eff6ff','#1e40af'];
  return (
    <div style={{ padding: '10px 16px', borderRadius: '6px', marginBottom: '10px', background: s[0], color: s[1], display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
      <span>{message}</span>
      {onDismiss && <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: s[1], marginLeft: '12px', fontSize: '16px', lineHeight: 1 }}>x</button>}
    </div>
  );
}

function FileChip({ file, onRemove }) {
  const colors = { Meta: '#1877f2', Douyin: '#ff0050', crm: '#7c3aed' };
  const c = colors[file.platform] || '#6b7280';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '4px 10px 4px 8px', background: '#f8fafc', borderRadius: '20px', fontSize: '12px', border: '1px solid #e2e8f0' }}>
      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: c, flexShrink: 0 }} />
      <span style={{ fontWeight: '500' }}>{file.name}</span>
      <span style={{ color: '#9ca3af' }}>
        {file.rowCount} rows · {file.platform}
        {file.campaignCount ? ` · ${file.campaignCount} campaign${file.campaignCount > 1 ? 's' : ''}` : ''}
        {file.warnings && file.warnings.length > 0 ? ` · ${file.warnings.length} warning${file.warnings.length > 1 ? 's' : ''}` : ''}
        {file.savedMapping ? ' · saved mapping' : ''}
      </span>
      <button onClick={() => onRemove(file.name)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '0 2px', fontSize: '13px', lineHeight: 1 }}>x</button>
    </div>
  );
}

function InfoTip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: '4px' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '13px', height: '13px', borderRadius: '50%',
        background: '#e5e7eb', color: '#6b7280',
        fontSize: '9px', fontWeight: '700', cursor: 'help', fontStyle: 'italic'
      }}>i</span>
      {show && (
        <span style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: '6px', padding: '6px 10px', background: '#1f2937', color: '#fff',
          fontSize: '11px', fontWeight: '400', borderRadius: '4px', whiteSpace: 'normal',
          width: '220px', textAlign: 'left', lineHeight: '1.4', zIndex: 10,
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
        }}>{text}</span>
      )}
    </span>
  );
}

// ── INGEST ZONE ───────────────────────────────────────────────────────────────

function IngestZone({ files, onFiles, onRemoveFile, loading, title, hint }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const processFiles = useCallback(fileList => {
    const arr = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.csv'));
    if (arr.length) onFiles(arr);
  }, [onFiles]);

  return (
    <div style={{ marginBottom: '16px' }}>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{
          padding: '28px',
          border: dragging ? '2px solid #3b82f6' : '2px dashed #d1d5db',
          borderRadius: '8px', textAlign: 'center', cursor: 'pointer',
          background: dragging ? '#eff6ff' : '#fafafa', transition: 'all 0.15s'
        }}
      >
        {loading
          ? <div style={{ color: '#6b7280' }}>Reading files...</div>
          : <>
              <div style={{ color: '#374151', fontWeight: '500' }}>{title}</div>
              <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '4px' }}>{hint}</div>
            </>
        }
        <input ref={inputRef} type="file" accept=".csv" multiple onChange={e => { processFiles(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
      </div>
      {files.length > 0 && (
        <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          {files.map(f => <FileChip key={f.name} file={f} onRemove={onRemoveFile} />)}
        </div>
      )}
    </div>
  );
}

// ── FIELD PREVIEW WITH MANUAL OVERRIDE ────────────────────────────────────────

function FieldPreview({ files, onMappingChange, onResetMapping }) {
  if (files.length === 0) return null;

  return (
    <div style={{ background: '#fff', borderRadius: '8px', padding: '14px 16px', marginBottom: '14px', border: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Detected Fields ({files.length} file{files.length > 1 ? 's' : ''})
        </div>
        <div style={{ fontSize: '11px', color: '#9ca3af' }}>
          Click any cell to remap. Saved per export shape.
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 10px', color: '#6b7280', fontWeight: '600', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>Standard field</th>
              {files.map(f => (
                <th key={f.name} style={{ textAlign: 'left', padding: '6px 10px', color: '#374151', fontWeight: '600', borderBottom: '1px solid #e5e7eb', minWidth: '180px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <div>
                      <div>{f.name}</div>
                      <div style={{ fontSize: '10px', color: '#9ca3af', fontWeight: '400' }}>
                        {f.platform}{f.savedMapping ? ' · saved mapping in use' : ''}
                      </div>
                    </div>
                    {f.savedMapping && (
                      <button onClick={() => onResetMapping(f.name)}
                        title="Clear saved mapping for this export shape"
                        style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', color: '#6b7280', cursor: 'pointer' }}>
                        Reset
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(field => (
              <tr key={field.key}>
                <td style={{ padding: '6px 10px', color: '#374151', fontWeight: '500', borderBottom: '1px solid #f9fafb', whiteSpace: 'nowrap' }}>{field.label}</td>
                {files.map(f => {
                  const matched = f.fieldMap && f.fieldMap[field.key];
                  return (
                    <td key={f.name} style={{ padding: '6px 10px', borderBottom: '1px solid #f9fafb' }}>
                      <select
                        value={matched || ''}
                        onChange={e => onMappingChange(f.name, field.key, e.target.value || null)}
                        style={{
                          width: '100%', padding: '4px 6px', fontSize: '11px',
                          border: matched ? '1px solid #d1d5db' : '1px solid #fca5a5',
                          borderRadius: '4px',
                          background: matched ? '#fff' : '#fef2f2',
                          color: matched ? '#065f46' : '#991b1b',
                          fontFamily: matched ? 'monospace' : 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="">— not mapped —</option>
                        {f.headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '10px', fontSize: '11px', color: '#9ca3af' }}>
        Auto-detection is case- and punctuation-insensitive. Manual overrides are saved to your browser
        (keyed by platform + column-set) and reapplied automatically on future uploads with the same shape.
      </div>
    </div>
  );
}

// ── CAMPAIGN TAB ──────────────────────────────────────────────────────────────

function CampaignTab({ data, crmLoaded, ltvByAdSet, aggregateLTVCPA, onOpenFields }) {
  const [drill, setDrill] = useState(null);
  const [dateMode, setDateMode] = useState('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const dateBounds = useMemo(() => {
    const dates = data.map(r => r.date).filter(d => d);
    if (dates.length === 0) return { min: null, max: null };
    const ts = dates.map(d => d.getTime());
    return { min: new Date(Math.min(...ts)), max: new Date(Math.max(...ts)) };
  }, [data]);

  const filteredData = useMemo(() => {
    if (dateMode === 'all' || !dateBounds.max) return data;
    if (dateMode === 'custom') {
      if (!customStart || !customEnd) return data;
      const s = new Date(customStart), e = new Date(customEnd);
      e.setHours(23, 59, 59, 999);
      return data.filter(r => r.date && r.date >= s && r.date <= e);
    }
    const days = { '7d': 7, '14d': 14, '28d': 28 }[dateMode];
    const cutoff = new Date(dateBounds.max);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    return data.filter(r => r.date && r.date >= cutoff && r.date <= dateBounds.max);
  }, [data, dateMode, customStart, customEnd, dateBounds]);

  const campaigns = useMemo(() => aggByKey(filteredData, 'campaign_name'), [filteredData]);

  const totalSpend = filteredData.reduce((s, r) => s + r.spend, 0);
  const totalImpressions = filteredData.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = filteredData.reduce((s, r) => s + r.clicks, 0);
  const ctrW = filteredData.reduce((s, r) => s + r.ctr * r.impressions, 0);
  const avgCTR = totalClicks > 0
    ? (totalClicks / totalImpressions) * 100
    : totalImpressions > 0 ? ctrW / totalImpressions : 0;
  const cpaW = filteredData.reduce((s, r) => s + r.cpa * r.spend, 0);
  const avgCPA = totalClicks > 0
    ? totalSpend / totalClicks
    : totalSpend > 0 ? cpaW / totalSpend : 0;
  const metaSpend = filteredData.filter(r => r.platform === 'Meta').reduce((s, r) => s + r.spend, 0);
  const douyinSpend = filteredData.filter(r => r.platform === 'Douyin').reduce((s, r) => s + r.spend, 0);

  const drillData = drill ? aggByKey(filteredData.filter(r => r.campaign_name === drill), 'ad_set_name') : null;

  const datePresets = [['all', 'All'], ['7d', 'L7D'], ['14d', 'L14D'], ['28d', 'L28D'], ['custom', 'Custom']];
  const dateBtn = active => ({
    padding: '5px 12px', border: '1px solid #e5e7eb', borderRadius: '5px',
    background: active ? '#1e40af' : '#fff', color: active ? '#fff' : '#374151',
    fontSize: '12px', cursor: 'pointer', fontWeight: active ? '600' : '400',
  });

  const TH = ({ children, right }) => (
    <th style={{ textAlign: right ? 'right' : 'left', padding: '8px 10px', color: '#6b7280', fontWeight: '600', fontSize: '12px', borderBottom: '2px solid #f3f4f6' }}>
      {children}
    </th>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500' }}>Date range:</span>
        {datePresets.map(([m, l]) => (
          <button key={m} onClick={() => setDateMode(m)} style={dateBtn(dateMode === m)}>{l}</button>
        ))}
        {dateMode === 'custom' && (
          <>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              style={{ padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: '5px', fontSize: '12px' }} />
            <span style={{ color: '#9ca3af', fontSize: '12px' }}>→</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              style={{ padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: '5px', fontSize: '12px' }} />
          </>
        )}
        {dateBounds.max && (
          <span style={{ fontSize: '11px', color: '#9ca3af', marginLeft: 'auto' }}>
            Data range: {fmtDate(dateBounds.min)} → {fmtDate(dateBounds.max)}
            {' · '}{filteredData.length} of {data.length} rows
          </span>
        )}
        {onOpenFields && (
          <button onClick={onOpenFields} style={{ padding: '5px 12px', border: '1px solid #e5e7eb', borderRadius: '5px', background: '#fff', color: '#374151', fontSize: '12px', cursor: 'pointer' }}>
            View Detected Fields
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <KPI label="Total Spend" value={fmtHKD(totalSpend)} />
        <KPI label="Impressions" value={fmt(totalImpressions)} />
        <KPI label="Avg CTR" value={`${avgCTR.toFixed(2)}%`} />
        <KPI label="Avg CPA" value={fmtHKD(avgCPA)}
          badge={crmLoaded ? 'CRM-verified' : 'Pixel-reported'}
          badgeType={crmLoaded ? 'verified' : 'pixel'} />
        <KPI
          label="LTV : CPA"
          value={aggregateLTVCPA && aggregateLTVCPA > 0 ? `${aggregateLTVCPA.toFixed(1)}x` : '—'}
          sub={crmLoaded
            ? (aggregateLTVCPA > 0 ? 'Aggregate revenue ÷ acquisition cost' : 'No matched CRM rows')
            : 'Upload CRM to unlock'}
        />
      </div>

      {(metaSpend > 0 || douyinSpend > 0) && (
        <div style={{ background: '#fff', borderRadius: '8px', padding: '16px', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Spend by Channel</div>
          <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {[['Meta', metaSpend, '#1877f2'], ['Douyin', douyinSpend, '#ff0050']].filter(([, v]) => v > 0).map(([name, val, color]) => (
              <div key={name}>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>{name}</div>
                <div style={{ fontWeight: '600', fontSize: '15px' }}>{fmtHKD(val)}</div>
                <div style={{ fontSize: '11px', color: '#9ca3af' }}>{totalSpend > 0 ? ((val / totalSpend) * 100).toFixed(0) : 0}%</div>
              </div>
            ))}
          </div>
          {metaSpend > 0 && douyinSpend > 0 && (
            <div style={{ height: '5px', borderRadius: '3px', background: '#e5e7eb', overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${(metaSpend / totalSpend) * 100}%`, background: '#1877f2' }} />
              <div style={{ flex: 1, background: '#ff0050' }} />
            </div>
          )}
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: '8px', padding: '16px', overflowX: 'auto' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Campaign Performance</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr>
              <TH>Campaign</TH>
              <TH right>Channel</TH>
              <TH right>Spend</TH>
              <TH right>Impressions</TH>
              <TH right>CTR</TH>
              <TH right>CPA</TH>
              <TH right>LTV : CPA</TH>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f9fafb', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '9px 10px' }}>
                  <button onClick={() => setDrill(drill === c.campaign_name ? null : c.campaign_name)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: '13px', padding: 0, textAlign: 'left' }}>
                    {c.campaign_name}
                  </button>
                </td>
                <td style={{ textAlign: 'right', padding: '9px 10px', color: '#6b7280', fontSize: '12px' }}>{c.platform}</td>
                <td style={{ textAlign: 'right', padding: '9px 10px' }}>HKD {c.spend?.toFixed(0)}</td>
                <td style={{ textAlign: 'right', padding: '9px 10px' }}>{c.impressions?.toLocaleString()}</td>
                <td style={{ textAlign: 'right', padding: '9px 10px' }}>{c.ctr?.toFixed(2)}%</td>
                <td style={{ textAlign: 'right', padding: '9px 10px' }}>HKD {c.cpa?.toFixed(2)}</td>
                <td style={{ textAlign: 'right', padding: '9px 10px' }}>
                  {ltvByAdSet
                    ? (() => {
                        const adSets = filteredData.filter(r => r.campaign_name === c.campaign_name)
                          .map(r => r.ad_set_name).filter((v, i, a) => a.indexOf(v) === i);
                        const vals = adSets.map(k => ltvByAdSet[k]).filter(v => v > 0);
                        const ratio = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
                        return ratio > 0
                          ? <span style={{ fontWeight: '600', color: ratio >= 1 ? '#059669' : '#dc2626' }}>{ratio.toFixed(1)}x</span>
                          : <span style={{ color: '#9ca3af' }}>—</span>;
                      })()
                    : <span title="Upload CRM data in Customer Value tab to unlock" style={{ color: '#9ca3af', cursor: 'help', borderBottom: '1px dashed #d1d5db' }}>—</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {drill && drillData && (
          <div style={{ marginTop: '14px', padding: '12px 14px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>Ad Sets — {drill}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  {['Ad Set', 'Spend', 'Impressions', 'CTR', 'CPA'].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '6px 8px', color: '#6b7280', fontWeight: '600' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drillData.map((a, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 8px' }}>{a.ad_set_name}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>HKD {a.spend?.toFixed(0)}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>{a.impressions?.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>{a.ctr?.toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>HKD {a.cpa?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CRM PREVIEW TABLE ─────────────────────────────────────────────────────────

function CRMPreviewTable({ rows }) {
  const all = rows || [];
  const headers = all.length > 0 ? Object.keys(all[0]).map(h => h.toLowerCase()) : [];

  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('all');
  const [planF, setPlanF] = useState('all');
  const [sort, setSort] = useState({ field: null, dir: 'asc' });

  const statusOptions = useMemo(() => [...new Set(all.map(r => r.status).filter(Boolean))].sort(), [all]);
  const planOptions = useMemo(() => [...new Set(all.map(r => r.plan_type).filter(Boolean))].sort(), [all]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(r => {
      if (statusF !== 'all' && r.status !== statusF) return false;
      if (planF !== 'all' && r.plan_type !== planF) return false;
      if (needle) {
        const hay = `${r.customer_id || ''} ${r.campaign_name || ''} ${r.ad_set_name || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [all, q, statusF, planF]);

  const sorted = useMemo(() => {
    if (!sort.field) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.field], bv = b[sort.field];
      const aMissing = av == null || av === '';
      const bMissing = bv == null || bv === '';
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;   // missing values sink to bottom regardless of dir
      if (bMissing) return -1;
      const an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn) && String(av).match(/^-?\d/) && String(bv).match(/^-?\d/)) {
        return (an - bn) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sort]);

  const handleSort = field => {
    setSort(s => s.field === field
      ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: 'asc' });
  };

  const sortIcon = field => {
    if (sort.field !== field) return <span style={{ color: '#d1d5db', marginLeft: '4px', fontSize: '9px' }}>↕</span>;
    return <span style={{ color: '#1e40af', marginLeft: '4px', fontSize: '10px' }}>{sort.dir === 'asc' ? '▲' : '▼'}</span>;
  };

  const hasFilter = q.trim() !== '' || statusF !== 'all' || planF !== 'all';
  const ctrlStyle = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '5px', color: '#374151', padding: '6px 10px', fontSize: '12px', fontFamily: 'inherit' };

  return (
    <div style={{ background: '#fff', borderRadius: '8px', padding: '16px', marginBottom: '14px', border: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          CRM Data {all.length > 0
            ? (hasFilter ? `(${filtered.length.toLocaleString()} of ${all.length.toLocaleString()} rows)` : `(${all.length.toLocaleString()} rows)`)
            : '(no data)'}
        </div>
        {all.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              style={{ ...ctrlStyle, minWidth: '220px' }}
              placeholder="Search customer / campaign / ad set…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <select style={ctrlStyle} value={statusF} onChange={e => setStatusF(e.target.value)}>
              <option value="all">All statuses</option>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select style={ctrlStyle} value={planF} onChange={e => setPlanF(e.target.value)}>
              <option value="all">All plans</option>
              {planOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {hasFilter && (
              <button
                onClick={() => { setQ(''); setStatusF('all'); setPlanF('all'); }}
                style={{ ...ctrlStyle, color: '#6b7280', cursor: 'pointer' }}
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>
      <div style={{ overflow: 'auto', maxHeight: '60vh', border: '1px solid #f3f4f6', borderRadius: '4px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1, boxShadow: 'inset 0 -2px 0 #f3f4f6' }}>
            <tr>
              {CRM_SCHEMA.map(col => (
                <th key={col.name} style={{ textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap', background: '#fff', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSort(col.name)}
                    title={`Sort by ${col.name}`}>
                  <div style={{ display: 'flex', alignItems: 'center', color: '#374151', fontWeight: '600', fontSize: '11px' }}>
                    <span>{col.name}</span>
                    {sortIcon(col.name)}
                    <InfoTip text={col.desc} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {all.length === 0 ? (
              <tr>
                <td colSpan={CRM_SCHEMA.length} style={{ padding: '18px 10px', textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>
                  Click "Fetch from Supabase" above to load customer data.
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={CRM_SCHEMA.length} style={{ padding: '18px 10px', textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>
                  No rows match the current filters.
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => {
                const lcRow = {};
                Object.keys(row).forEach(k => { lcRow[k.toLowerCase()] = row[k]; });
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #f9fafb' }}>
                    {CRM_SCHEMA.map(col => {
                      const val = lcRow[col.name];
                      const present = headers.includes(col.name);
                      return (
                        <td key={col.name} style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: present ? '#111827' : '#d1d5db' }}>
                          {present ? (val !== undefined && val !== '' && val !== null ? val : <span style={{ color: '#d1d5db' }}>—</span>) : <span style={{ color: '#d1d5db' }}>not provided</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── CUSTOMER TAB ──────────────────────────────────────────────────────────────

function CustomerTab({ crmResult, loading, lastFetch, campaignData, onFetch }) {
  const leaderboard = useMemo(
    () => (crmResult && !crmResult.error) ? buildLeaderboard(crmResult.rows, campaignData) : [],
    [crmResult, campaignData]
  );
  const planMix = useMemo(
    () => (crmResult && !crmResult.error) ? buildPlanMix(crmResult.rows) : [],
    [crmResult]
  );

  const previewRows = crmResult && !crmResult.error ? crmResult.rows : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '14px' }}>
        <div>
          <div style={{ color: '#374151', fontWeight: '500', fontSize: '13px' }}>Customer data · Supabase</div>
          <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '2px' }}>
            Source: <code>v_customer_360</code> on <code>mlsjehglsotapwvalbor</code>
            {lastFetch && <span style={{ marginLeft: '8px' }}>· last fetched {lastFetch.toLocaleTimeString()}</span>}
          </div>
        </div>
        <button
          onClick={onFetch}
          disabled={loading}
          style={{ background: loading ? '#93c5fd' : '#1e40af', color: '#fff', border: 'none', borderRadius: '5px', padding: '8px 16px', fontSize: '12px', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Fetching…' : (crmResult ? '↻ Refresh' : 'Fetch from Supabase')}
        </button>
      </div>

      {crmResult && !crmResult.error && (
        <>
          {crmResult.warnings && crmResult.warnings.map((w, i) => <Banner key={i} type="warning" message={w} />)}

          {crmResult.joinRate && (
            <div style={{ background: '#fff', borderRadius: '8px', padding: '14px 16px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontWeight: '600', fontSize: '13px' }}>
                  Joined {crmResult.joinRate.joined}/{crmResult.joinRate.total} customers ({crmResult.joinRate.total > 0 ? ((crmResult.joinRate.joined / crmResult.joinRate.total) * 100).toFixed(0) : 0}%)
                </span>
                {crmResult.joinRate.unmatched > 0 && (
                  <span style={{ fontSize: '12px', color: '#6b7280' }}>{crmResult.joinRate.unmatched} unmatched — likely attribution gaps</span>
                )}
              </div>
              <div style={{ height: '5px', borderRadius: '3px', background: '#e5e7eb', overflow: 'hidden' }}>
                <div style={{ width: `${crmResult.joinRate.total > 0 ? (crmResult.joinRate.joined / crmResult.joinRate.total) * 100 : 0}%`, height: '100%', background: '#10b981' }} />
              </div>
            </div>
          )}

          <div style={{ background: '#fff', borderRadius: '8px', padding: '16px', overflowX: 'auto', marginBottom: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>LTV : CPA Leaderboard</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  {[['Ad Set', false], ['Customers', true], ['Avg ARPU', true], ['Avg Revenue', true], ['CPA', true], ['LTV : CPA', true]].map(([h, r]) => (
                    <th key={h} style={{ textAlign: r ? 'right' : 'left', padding: '8px 10px', color: '#6b7280', fontWeight: '600', fontSize: '12px', borderBottom: '2px solid #f3f4f6' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f9fafb' }}>
                    <td style={{ padding: '9px 10px' }}>{r.ad_set_name}</td>
                    <td style={{ textAlign: 'right', padding: '9px 10px' }}>{r.count}</td>
                    <td style={{ textAlign: 'right', padding: '9px 10px' }}>HKD {r.avgARPU.toFixed(0)}</td>
                    <td style={{ textAlign: 'right', padding: '9px 10px' }}>HKD {r.avgRevenue.toFixed(0)}</td>
                    <td style={{ textAlign: 'right', padding: '9px 10px' }}>HKD {r.cpa.toFixed(0)}</td>
                    <td style={{ textAlign: 'right', padding: '9px 10px', fontWeight: '600', color: r.ltvCpa >= 1 ? '#059669' : '#dc2626' }}>
                      {r.ltvCpa > 0 ? `${r.ltvCpa.toFixed(1)}x` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {planMix.length > 0 && (
            <div style={{ background: '#fff', borderRadius: '8px', padding: '16px', marginBottom: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Plan Mix</div>
              <Donut data={planMix} />
            </div>
          )}

          <CRMPreviewTable rows={previewRows} />
        </>
      )}
    </div>
  );
}

// ── MAIN DASHBOARD ────────────────────────────────────────────────────────────

function Dashboard() {
  const [campaignFiles, setCampaignFiles] = useState([]);
  const [committedFiles, setCommittedFiles] = useState([]);
  const [crmResult, setCrmResult] = useState(null);
  const [loadingCRM, setLoadingCRM] = useState(false);
  const [lastCrmFetch, setLastCrmFetch] = useState(null);
  const [tab, setTab] = useState('campaigns');
  const [loading, setLoading] = useState(false);
  const [banners, setBanners] = useState([]);
  const [aliasesLoaded, setAliasesLoaded] = useState(false);

  // Try to fetch the external alias dictionary on mount; fall back silently to defaults.
  useEffect(() => {
    fetch('./column_aliases.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && (data.meta || data.douyin)) {
          ALIASES = {
            meta:   { ...DEFAULT_ALIASES.meta,   ...(data.meta   || {}) },
            douyin: { ...DEFAULT_ALIASES.douyin, ...(data.douyin || {}) },
          };
          setAliasesLoaded(true);
        }
      })
      .catch(() => {});
  }, []);

  const campaignData = useMemo(() => committedFiles.flatMap(f => f.rows), [committedFiles]);

  const hasCampaignPending = useMemo(() => {
    if (campaignFiles.length !== committedFiles.length) return true;
    const cByName = Object.fromEntries(committedFiles.map(f => [f.name, f]));
    return campaignFiles.some(f => cByName[f.name] !== f);
  }, [campaignFiles, committedFiles]);

  const ltvByAdSet = useMemo(() => {
    if (!crmResult || crmResult.error) return null;
    const board = buildLeaderboard(crmResult.rows, campaignData);
    const map = {};
    board.forEach(r => { if (r.ltvCpa > 0) map[r.ad_set_name] = r.ltvCpa; });
    return map;
  }, [crmResult, campaignData]);

  // Aggregate LTV:CPA across all CRM customers — total revenue ÷ total acquisition cost.
  // Uses CRM-reported acquisition_cost when present, else the platform-reported per-ad-set CPA.
  const aggregateLTVCPA = useMemo(() => {
    if (!crmResult || crmResult.error) return 0;
    const platformCPA = {};
    aggByKey(campaignData, 'ad_set_name').forEach(r => { platformCPA[r.ad_set_name] = r.cpa; });
    let totalRev = 0, totalCost = 0;
    crmResult.rows.forEach(r => {
      totalRev += num(r.realized_revenue_hkd);
      const acq = num(r.acquisition_cost);
      const cost = acq > 0 ? acq : (platformCPA[r.ad_set_name] || 0);
      totalCost += cost;
    });
    return totalCost > 0 ? totalRev / totalCost : 0;
  }, [crmResult, campaignData]);

  const pushBanner = useCallback((type, message) => {
    const id = Date.now() + Math.random();
    setBanners(prev => [...prev, { id, type, message }]);
    setTimeout(() => setBanners(prev => prev.filter(b => b.id !== id)), 7000);
  }, []);

  const buildFileMeta = (file, fieldMap, normalized) => ({
    ...file,
    fieldMap,
    rows: normalized.rows,
    rowCount: normalized.rows.length,
    campaignCount: new Set(normalized.rows.map(r => r.campaign_name)).size,
    warnings: normalized.warnings,
  });

  const handleCampaignFiles = useCallback(async (fileList) => {
    setLoading(true);
    const incoming = [];
    const fileWarnings = [];

    for (const file of Array.from(fileList)) {
      try {
        const text = await file.text();
        const { headers, rows: rawRows } = parseCSV(text);
        if (rawRows.length === 0) { fileWarnings.push(`${file.name}: empty file, skipped`); continue; }

        const platform = detectPlatform(headers);
        if (!platform || platform === 'crm') { fileWarnings.push(`${file.name}: unrecognised format — skipped`); continue; }

        const autoMap = detectFields(headers, platform);
        const saved = loadOverride(platform, headers);
        const fieldMap = saved ? { ...autoMap, ...saved } : autoMap;
        const normalized = normaliseRows(rawRows, fieldMap, platform);

        incoming.push({
          name: file.name,
          platform: platform === 'meta' ? 'Meta' : 'Douyin',
          platformKey: platform,
          rowCount: normalized.rows.length,
          campaignCount: new Set(normalized.rows.map(r => r.campaign_name)).size,
          warnings: normalized.warnings,
          rows: normalized.rows,
          headers,
          rawRows,
          fieldMap,
          savedMapping: !!saved,
        });
        normalized.warnings.forEach(w => fileWarnings.push(`${file.name}: ${w}`));
      } catch (e) {
        fileWarnings.push(`${file.name}: failed to read — ${e.message}`);
      }
    }

    setCampaignFiles(prev => {
      const incomingNames = new Set(incoming.map(f => f.name));
      const kept = prev.filter(f => !incomingNames.has(f.name));
      return [...kept, ...incoming];
    });

    fileWarnings.forEach(w => pushBanner('warning', w));
    if (incoming.length > 0) {
      pushBanner('info', `${incoming.length} file${incoming.length > 1 ? 's' : ''} ready. Click Update to apply.`);
    }
    setLoading(false);
  }, [pushBanner]);

  const handleRemoveFile = useCallback(name => {
    setCampaignFiles(prev => prev.filter(f => f.name !== name));
    setCommittedFiles(prev => prev.filter(f => f.name !== name));
  }, []);

  const handleUpdateCampaigns = useCallback(() => {
    setCommittedFiles(campaignFiles);
    pushBanner('success', `Applied ${campaignFiles.length} file${campaignFiles.length === 1 ? '' : 's'}. ${campaignFiles.reduce((s, f) => s + f.rowCount, 0)} rows in dashboard.`);
  }, [campaignFiles, pushBanner]);

  const handleMappingChange = useCallback((fileName, field, newHeader) => {
    setCampaignFiles(prev => prev.map(f => {
      if (f.name !== fileName) return f;
      const fieldMap = { ...f.fieldMap, [field]: newHeader };
      saveOverride(f.platformKey, f.headers, fieldMap);
      const normalized = normaliseRows(f.rawRows, fieldMap, f.platformKey);
      return { ...buildFileMeta(f, fieldMap, normalized), savedMapping: true };
    }));
  }, []);

  const handleResetMapping = useCallback(fileName => {
    setCampaignFiles(prev => prev.map(f => {
      if (f.name !== fileName) return f;
      try { localStorage.removeItem(overrideKey(f.platformKey, f.headers)); } catch (e) {}
      const fieldMap = detectFields(f.headers, f.platformKey);
      const normalized = normaliseRows(f.rawRows, fieldMap, f.platformKey);
      return { ...buildFileMeta(f, fieldMap, normalized), savedMapping: false };
    }));
    pushBanner('info', `Reset saved mapping for ${fileName}.`);
  }, [pushBanner]);

  const handleFetchSupabase = useCallback(async () => {
    setLoadingCRM(true);
    try {
      const { data, error } = await sb
        .from('v_customer_360')
        .select(SUPABASE_SELECT_FIELDS.join(','));
      if (error) throw error;
      // Map Supabase columns to the legacy CRM-CSV column names so that
      // processCRM / buildLeaderboard / buildPlanMix continue to work unchanged.
      const renamed = (data || []).map(r => ({
        ...r,
        customer_id: r.external_customer_id,
        tenure_months: r.months_active,
      }));
      const result = processCRM(renamed, campaignData);
      if (result.error) { pushBanner('error', result.error); return; }
      setCrmResult({ ...result, name: 'Supabase v_customer_360' });
      setLastCrmFetch(new Date());
      pushBanner(
        'success',
        `Fetched ${renamed.length} customers from Supabase. ${result.joinRate.joined}/${result.joinRate.total} matched ad sets.`,
      );
    } catch (e) {
      pushBanner('error', `Supabase fetch failed: ${e.message || e}`);
    } finally {
      setLoadingCRM(false);
    }
  }, [campaignData, pushBanner]);

  const handleReset = () => {
    if (!confirm('Clear all loaded data and start over?')) return;
    setCampaignFiles([]);
    setCommittedFiles([]);
    setCrmResult(null);
    setLastCrmFetch(null);
    setTab('campaigns');
    setBanners([]);
  };

  const tabStyle = active => ({
    padding: '8px 18px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500',
    background: active ? '#1e40af' : 'transparent',
    color: active ? '#fff' : '#6b7280',
    transition: 'all 0.15s',
  });

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#111827' }}>HK Telco Ads Dashboard</div>
          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
            Meta and Douyin campaign analysis
            {aliasesLoaded && <span style={{ marginLeft: '8px', fontSize: '11px', color: '#10b981' }}>· custom column_aliases.json loaded</span>}
          </div>
        </div>
        {(campaignFiles.length > 0 || crmResult) && (
          <button onClick={handleReset} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '6px 14px', fontSize: '12px', color: '#6b7280', cursor: 'pointer' }}>
            Reset
          </button>
        )}
      </div>

      {banners.map(b => <Banner key={b.id} type={b.type} message={b.message} onDismiss={() => setBanners(prev => prev.filter(x => x.id !== b.id))} />)}

      <div style={{ display: 'flex', gap: '2px', marginBottom: '20px', background: '#f3f4f6', padding: '4px', borderRadius: '8px', width: 'fit-content' }}>
        <button onClick={() => setTab('campaigns')} style={tabStyle(tab === 'campaigns')}>Campaign Performance</button>
        <button onClick={() => setTab('customers')} style={tabStyle(tab === 'customers')}>Customer Value</button>
        <button onClick={() => setTab('fields')} style={tabStyle(tab === 'fields')}>
          Detected Fields{campaignFiles.length > 0 ? ` (${campaignFiles.length})` : ''}
        </button>
      </div>

      {tab === 'campaigns' && (
        <>
          <IngestZone
            files={campaignFiles}
            onFiles={handleCampaignFiles}
            onRemoveFile={handleRemoveFile}
            loading={loading}
            title="Upload CSV files"
            hint="Drop Meta or Douyin exports here or click to browse — multiple files supported"
          />

          {hasCampaignPending && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: '#eff6ff', color: '#1e40af', borderRadius: '6px', marginBottom: '14px', fontSize: '13px' }}>
              <span>
                {campaignFiles.length} file{campaignFiles.length === 1 ? '' : 's'} pending
                {' · '}
                {campaignFiles.reduce((s, f) => s + f.rowCount, 0)} rows. Click Update to apply.
              </span>
              <button onClick={handleUpdateCampaigns} style={{ background: '#1e40af', color: '#fff', border: 'none', borderRadius: '5px', padding: '6px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                Update
              </button>
            </div>
          )}

          {campaignData.length === 0
            ? (
              <div style={{ textAlign: 'center', padding: '50px 20px', color: '#9ca3af' }}>
                <div style={{ fontSize: '15px', fontWeight: '500', color: '#6b7280', marginBottom: '6px' }}>No data applied</div>
                <div style={{ fontSize: '13px' }}>
                  {campaignFiles.length === 0
                    ? 'Upload Meta or Douyin CSV exports above to get started'
                    : 'Click Update above to apply uploaded files to the dashboard'}
                </div>
              </div>
            )
            : <CampaignTab
                data={campaignData}
                crmLoaded={!!crmResult && !crmResult.error}
                ltvByAdSet={ltvByAdSet}
                aggregateLTVCPA={aggregateLTVCPA}
                onOpenFields={() => setTab('fields')}
              />
          }
        </>
      )}

      {tab === 'customers' && (
        <CustomerTab
          crmResult={crmResult}
          loading={loadingCRM}
          lastFetch={lastCrmFetch}
          campaignData={campaignData}
          onFetch={handleFetchSupabase}
        />
      )}

      {tab === 'fields' && (
        campaignFiles.length === 0
          ? (
            <div style={{ textAlign: 'center', padding: '50px 20px', color: '#9ca3af' }}>
              <div style={{ fontSize: '15px', fontWeight: '500', color: '#6b7280', marginBottom: '6px' }}>No files uploaded</div>
              <div style={{ fontSize: '13px' }}>Upload Meta or Douyin CSV exports on the Campaign Performance tab to inspect detected fields here.</div>
            </div>
          )
          : <FieldPreview
              files={campaignFiles}
              onMappingChange={handleMappingChange}
              onResetMapping={handleResetMapping}
            />
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<Dashboard />);

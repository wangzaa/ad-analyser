const { useState, useCallback, useRef, useMemo } = React;

// ── UTILS ─────────────────────────────────────────────────────────────────────

const num = s => { const m = String(s).match(/[\d.]+/); return m ? parseFloat(m[0]) : 0; };
const fmt = n => n >= 1000000 ? `${(n/1000000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}K` : Number(n).toFixed(0);
const fmtHKD = n => `HKD ${fmt(n)}`;

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
  if (lc.some(h => h.includes('6-second video') || h.includes('cost (hkd)') || h.includes('advertiser id') || h.includes('by day'))) return 'tiktok';
  if (headers.some(h => ['Campaign Name', 'Ad Set Name', 'Ad Name'].includes(h))) return 'meta';
  if (headers.some(h => ['Campaign ID', 'Ad Group ID'].includes(h))) return 'tiktok';
  return null;
}

function normaliseMeta(rows) {
  const warnings = [];
  const out = rows.map(row => ({
    campaign_name: row['Campaign Name'] || row['Campaign name'] || '',
    ad_set_name: row['Ad Set Name'] || row['Ad set name'] || '',
    ad_name: row['Ad Name'] || row['Ad name'] || '',
    platform: 'Meta',
    spend: num(row['Amount Spent (HKD)'] || row['Amount spent (HKD)'] || row['Spend'] || 0),
    impressions: num(row['Impressions'] || 0),
    clicks: num(row['Link Clicks'] || row['Clicks'] || 0),
    cpa: num(row['Cost Per Link Click (HKD)'] || row['Cost per Result (HKD)'] || row['Cost per result'] || 0),
    frequency: num(row['Frequency'] || 0),
    conversions: num(row['Conversions'] || row['Results'] || 0),
  }));
  const zeroImp = out.filter(r => r.impressions === 0).length;
  if (zeroImp > 0) warnings.push(`${zeroImp} row${zeroImp > 1 ? 's' : ''} with zero impressions, excluded from analysis`);
  const valid = out.filter(r => r.impressions > 0);
  valid.forEach(r => { r.ctr = (r.clicks / r.impressions) * 100; });
  return { rows: valid, warnings };
}

function normaliseTikTok(rows) {
  const warnings = [];
  const out = rows.map(row => ({
    campaign_name: row['Campaign Name'] || row['Campaign name'] || '',
    ad_set_name: row['Ad Group Name'] || row['Ad Set Name'] || '',
    ad_name: row['Ad Name'] || '',
    platform: 'TikTok',
    spend: num(row['Cost (HKD)'] || row['Spend (HKD)'] || row['Cost'] || 0),
    impressions: num(row['Impressions'] || 0),
    clicks: num(row['Clicks'] || 0),
    cpa: num(row['Cost per Result (HKD)'] || row['Cost per Result'] || 0),
    frequency: num(row['Frequency'] || 0),
    conversions: num(row['Conversions'] || row['Results'] || 0),
  }));
  const zeroImp = out.filter(r => r.impressions === 0).length;
  if (zeroImp > 0) warnings.push(`${zeroImp} row${zeroImp > 1 ? 's' : ''} with zero impressions, excluded from analysis`);
  const valid = out.filter(r => r.impressions > 0);
  valid.forEach(r => { r.ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0; });
  return { rows: valid, warnings };
}

function aggByKey(data, key) {
  const agg = {};
  data.forEach(row => {
    const k = row[key] || '(unset)';
    if (!agg[k]) agg[k] = { [key]: k, spend: 0, impressions: 0, clicks: 0, conversions: 0, platform: row.platform };
    agg[k].spend += row.spend || 0;
    agg[k].impressions += row.impressions || 0;
    agg[k].clicks += row.clicks || 0;
    agg[k].conversions += row.conversions || 0;
  });
  return Object.values(agg).map(r => ({
    ...r,
    ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
    cpa: r.clicks > 0 ? r.spend / r.clicks : 0,
  }));
}

const REQUIRED_CRM = ['customer_id', 'campaign_name', 'ad_set_name', 'monthly_arpu_hkd', 'status', 'realized_revenue_hkd'];

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
  const cpaByCampaign = {};
  aggByKey(campaignData, 'ad_set_name').forEach(r => { cpaByCampaign[r.ad_set_name] = r.cpa; });

  const byAdSet = {};
  crmRows.forEach(r => {
    const k = r.ad_set_name || '(unknown)';
    if (!byAdSet[k]) byAdSet[k] = { ad_set_name: k, count: 0, totalARPU: 0, totalRevenue: 0 };
    byAdSet[k].count++;
    byAdSet[k].totalARPU += num(r.monthly_arpu_hkd || 0);
    byAdSet[k].totalRevenue += num(r.realized_revenue_hkd || 0);
  });

  return Object.values(byAdSet).map(r => {
    const avgRevenue = r.totalRevenue / r.count;
    const cpa = cpaByCampaign[r.ad_set_name] || 0;
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
  const colors = { Meta: '#1877f2', TikTok: '#ff0050', crm: '#7c3aed' };
  const c = colors[file.platform] || '#6b7280';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '4px 10px 4px 8px', background: '#f8fafc', borderRadius: '20px', fontSize: '12px', border: '1px solid #e2e8f0' }}>
      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: c, flexShrink: 0 }} />
      <span style={{ fontWeight: '500' }}>{file.name}</span>
      <span style={{ color: '#9ca3af' }}>
        {file.rowCount} rows · {file.platform}
        {file.campaignCount ? ` · ${file.campaignCount} campaign${file.campaignCount > 1 ? 's' : ''}` : ''}
        {file.warnings && file.warnings.length > 0 ? ` · ${file.warnings.length} warning${file.warnings.length > 1 ? 's' : ''}` : ''}
      </span>
      <button onClick={() => onRemove(file.name)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '0 2px', fontSize: '13px', lineHeight: 1 }}>x</button>
    </div>
  );
}

// ── INGEST ZONE ───────────────────────────────────────────────────────────────

function IngestZone({ files, onFiles, onRemoveFile, collapsed, onToggleCollapse, loading }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const hasFiles = files.length > 0;

  const processFiles = useCallback(fileList => {
    const arr = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.csv'));
    if (arr.length) onFiles(arr);
  }, [onFiles]);

  return (
    <div style={{ marginBottom: '20px' }}>
      {(!hasFiles || !collapsed) && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          style={{
            padding: hasFiles ? '14px 20px' : '40px',
            border: dragging ? '2px solid #3b82f6' : '2px dashed #d1d5db',
            borderRadius: '8px', textAlign: 'center', cursor: 'pointer',
            background: dragging ? '#eff6ff' : '#fafafa', transition: 'all 0.15s'
          }}
        >
          {loading
            ? <div style={{ color: '#6b7280' }}>Reading files...</div>
            : <>
                <div style={{ color: '#374151', fontWeight: '500' }}>Drop CSV files here or click to upload</div>
                <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '4px' }}>
                  Accepts Meta, TikTok, and demographics exports — multiple files at once
                </div>
              </>
          }
          <input ref={inputRef} type="file" accept=".csv" multiple onChange={e => processFiles(e.target.files)} style={{ display: 'none' }} />
        </div>
      )}
      {hasFiles && (
        <div style={{ marginTop: collapsed ? 0 : '10px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          {files.map(f => <FileChip key={f.name} file={f} onRemove={onRemoveFile} />)}
          <button onClick={onToggleCollapse} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '3px 10px', fontSize: '11px', color: '#6b7280', cursor: 'pointer' }}>
            {collapsed ? 'Add more files' : 'Collapse'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── CAMPAIGN TAB ──────────────────────────────────────────────────────────────

function CampaignTab({ data, crmLoaded }) {
  const [drill, setDrill] = useState(null);
  const campaigns = useMemo(() => aggByKey(data, 'campaign_name'), [data]);

  const totalSpend = data.reduce((s, r) => s + r.spend, 0);
  const totalImpressions = data.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = data.reduce((s, r) => s + r.clicks, 0);
  const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCPA = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const metaSpend = data.filter(r => r.platform === 'Meta').reduce((s, r) => s + r.spend, 0);
  const tiktokSpend = data.filter(r => r.platform === 'TikTok').reduce((s, r) => s + r.spend, 0);

  const drillData = drill ? aggByKey(data.filter(r => r.campaign_name === drill), 'ad_set_name') : null;

  const TH = ({ children, right }) => (
    <th style={{ textAlign: right ? 'right' : 'left', padding: '8px 10px', color: '#6b7280', fontWeight: '600', fontSize: '12px', borderBottom: '2px solid #f3f4f6' }}>
      {children}
    </th>
  );

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <KPI label="Total Spend" value={fmtHKD(totalSpend)} />
        <KPI label="Impressions" value={fmt(totalImpressions)} />
        <KPI label="Avg CTR" value={`${avgCTR.toFixed(2)}%`} />
        <KPI label="Avg CPA" value={fmtHKD(avgCPA)}
          badge={crmLoaded ? 'CRM-verified' : 'Pixel-reported'}
          badgeType={crmLoaded ? 'verified' : 'pixel'} />
        <KPI label="LTV : CPA" value="—" sub={crmLoaded ? 'See Customer Value tab' : 'Upload CRM to unlock'} />
      </div>

      {(metaSpend > 0 || tiktokSpend > 0) && (
        <div style={{ background: '#fff', borderRadius: '8px', padding: '16px', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Spend by Channel</div>
          <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {[['Meta', metaSpend, '#1877f2'], ['TikTok', tiktokSpend, '#ff0050']].filter(([, v]) => v > 0).map(([name, val, color]) => (
              <div key={name}>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>{name}</div>
                <div style={{ fontWeight: '600', fontSize: '15px' }}>{fmtHKD(val)}</div>
                <div style={{ fontSize: '11px', color: '#9ca3af' }}>{totalSpend > 0 ? ((val / totalSpend) * 100).toFixed(0) : 0}%</div>
              </div>
            ))}
          </div>
          {metaSpend > 0 && tiktokSpend > 0 && (
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
                <td style={{ textAlign: 'right', padding: '9px 10px', color: '#9ca3af' }}>
                  <span title={crmLoaded ? '' : 'Upload CRM data in Customer Value tab to unlock'} style={{ cursor: crmLoaded ? 'default' : 'help', borderBottom: crmLoaded ? 'none' : '1px dashed #d1d5db' }}>
                    —
                  </span>
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

// ── CUSTOMER TAB ──────────────────────────────────────────────────────────────

function CustomerTab({ crmResult, campaignData, onCRMFile }) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const handleFile = useCallback(async fileList => {
    const f = Array.from(fileList).find(f => f.name.toLowerCase().endsWith('.csv'));
    if (!f) return;
    setLoading(true);
    await onCRMFile(f);
    setLoading(false);
  }, [onCRMFile]);

  if (!crmResult) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ color: '#374151', fontWeight: '600', fontSize: '16px', marginBottom: '8px' }}>Upload CRM data to unlock</div>
        <div style={{ color: '#6b7280', fontSize: '13px', maxWidth: '420px', margin: '0 auto 24px' }}>
          LTV:CPA leaderboard, plan mix, cohort retention, cross-sell heatmap, and CRM-verified CPA will appear here.
        </div>
        <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          style={{ padding: '28px', border: dragging ? '2px solid #7c3aed' : '2px dashed #d1d5db', borderRadius: '8px', cursor: 'pointer', background: dragging ? '#f5f3ff' : '#fafafa', maxWidth: '400px', margin: '0 auto', transition: 'all 0.15s' }}>
          {loading ? <div style={{ color: '#6b7280' }}>Reading...</div> :
            <>
              <div style={{ color: '#374151', fontWeight: '500' }}>Drop CRM CSV here</div>
              <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '4px' }}>
                Required columns: customer_id, campaign_name, ad_set_name, monthly_arpu_hkd, status, realized_revenue_hkd
              </div>
            </>
          }
          <input ref={inputRef} type="file" accept=".csv" onChange={e => handleFile(e.target.files)} style={{ display: 'none' }} />
        </div>
      </div>
    );
  }

  if (crmResult.error) {
    return <Banner type="error" message={crmResult.error} />;
  }

  const { rows, warnings, joinRate } = crmResult;
  const leaderboard = useMemo(() => buildLeaderboard(rows, campaignData), [rows, campaignData]);
  const planMix = useMemo(() => buildPlanMix(rows), [rows]);

  return (
    <div>
      {warnings && warnings.map((w, i) => <Banner key={i} type="warning" message={w} />)}

      {joinRate && (
        <div style={{ background: '#fff', borderRadius: '8px', padding: '14px 16px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontWeight: '600', fontSize: '13px' }}>
              Joined {joinRate.joined}/{joinRate.total} customers ({joinRate.total > 0 ? ((joinRate.joined / joinRate.total) * 100).toFixed(0) : 0}%)
            </span>
            {joinRate.unmatched > 0 && (
              <span style={{ fontSize: '12px', color: '#6b7280' }}>{joinRate.unmatched} unmatched — likely attribution gaps</span>
            )}
          </div>
          <div style={{ height: '5px', borderRadius: '3px', background: '#e5e7eb', overflow: 'hidden' }}>
            <div style={{ width: `${joinRate.total > 0 ? (joinRate.joined / joinRate.total) * 100 : 0}%`, height: '100%', background: '#10b981' }} />
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
        <div style={{ background: '#fff', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Plan Mix</div>
          <Donut data={planMix} />
        </div>
      )}
    </div>
  );
}

// ── MAIN DASHBOARD ────────────────────────────────────────────────────────────

function Dashboard() {
  const [campaignFiles, setCampaignFiles] = useState([]);
  const [crmResult, setCrmResult] = useState(null);
  const [tab, setTab] = useState('campaigns');
  const [ingestCollapsed, setIngestCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [banners, setBanners] = useState([]);

  const campaignData = useMemo(() => campaignFiles.flatMap(f => f.rows), [campaignFiles]);

  const pushBanner = useCallback((type, message) => {
    const id = Date.now() + Math.random();
    setBanners(prev => [...prev, { id, type, message }]);
    setTimeout(() => setBanners(prev => prev.filter(b => b.id !== id)), 7000);
  }, []);

  const handleCampaignFiles = useCallback(async (fileList) => {
    setLoading(true);
    const incoming = [];
    const fileWarnings = [];

    for (const file of Array.from(fileList)) {
      try {
        const text = await file.text();
        const { headers, rows } = parseCSV(text);
        if (rows.length === 0) { fileWarnings.push(`${file.name}: empty file, skipped`); continue; }

        const platform = detectPlatform(headers);
        if (!platform || platform === 'crm') { fileWarnings.push(`${file.name}: unrecognised format — skipped`); continue; }

        let normalized, warnings;
        if (platform === 'meta') ({ rows: normalized, warnings } = normaliseMeta(rows));
        else ({ rows: normalized, warnings } = normaliseTikTok(rows));

        const campaignCount = new Set(normalized.map(r => r.campaign_name)).size;
        incoming.push({ name: file.name, platform: platform === 'meta' ? 'Meta' : 'TikTok', rowCount: normalized.length, campaignCount, warnings, rows: normalized });
        warnings.forEach(w => fileWarnings.push(`${file.name}: ${w}`));
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
      setIngestCollapsed(true);
      pushBanner('success', `Loaded ${incoming.length} file${incoming.length > 1 ? 's' : ''}. ${incoming.reduce((s, f) => s + f.rowCount, 0)} rows ready.`);
    }
    setLoading(false);
  }, [pushBanner]);

  const handleRemoveFile = useCallback(name => {
    setCampaignFiles(prev => prev.filter(f => f.name !== name));
  }, []);

  const handleCRMFile = useCallback(async (file) => {
    try {
      const text = await file.text();
      const { rows } = parseCSV(text);
      if (rows.length === 0) { pushBanner('error', `${file.name}: empty file`); return; }

      const result = processCRM(rows, campaignData);
      if (result.error) { pushBanner('error', result.error); setCrmResult({ error: result.error }); return; }

      setCrmResult(result);
      pushBanner('success', `CRM joined. CPA and LTV now reflect verified customer data. (${result.joinRate.joined}/${result.joinRate.total} customers matched)`);
    } catch (e) {
      pushBanner('error', `${file.name}: failed to read — ${e.message}`);
    }
  }, [campaignData, pushBanner]);

  const handleReset = () => {
    if (!confirm('Clear all loaded data and start over?')) return;
    setCampaignFiles([]);
    setCrmResult(null);
    setTab('campaigns');
    setIngestCollapsed(false);
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
          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>Meta and TikTok campaign analysis</div>
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
        <button
          onClick={() => setTab('customers')}
          style={{ ...tabStyle(tab === 'customers'), color: tab !== 'customers' && !crmResult ? '#d1d5db' : tab === 'customers' ? '#fff' : '#6b7280' }}
          title={!crmResult && campaignData.length === 0 ? 'Upload campaign data first' : ''}
        >
          Customer Value{!crmResult ? '' : ''}
        </button>
      </div>

      {tab === 'campaigns' && (
        <>
          <IngestZone
            files={campaignFiles}
            onFiles={handleCampaignFiles}
            onRemoveFile={handleRemoveFile}
            collapsed={ingestCollapsed}
            onToggleCollapse={() => setIngestCollapsed(c => !c)}
            loading={loading}
          />
          {campaignData.length === 0
            ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af' }}>
                <div style={{ fontSize: '15px', fontWeight: '500', color: '#6b7280', marginBottom: '6px' }}>No data loaded</div>
                <div style={{ fontSize: '13px' }}>Drop Meta or TikTok CSV exports above to get started</div>
              </div>
            )
            : <CampaignTab data={campaignData} crmLoaded={!!crmResult && !crmResult.error} />
          }
        </>
      )}

      {tab === 'customers' && (
        <CustomerTab crmResult={crmResult} campaignData={campaignData} onCRMFile={handleCRMFile} />
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<Dashboard />);

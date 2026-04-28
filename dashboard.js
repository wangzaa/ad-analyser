const { useState, useCallback, useRef, useEffect } = React;

// CSV PARSER
function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];

  const headers = [];
  let in_quote = false;
  let current = '';
  for (const char of lines[0]) {
    if (char === '"') in_quote = !in_quote;
    else if (char === ',' && !in_quote) {
      headers.push(current.replace(/"/g, '').trim());
      current = '';
    } else current += char;
  }
  headers.push(current.replace(/"/g, '').trim());

  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const row = {};
    in_quote = false;
    current = '';
    let col = 0;
    for (const char of lines[i]) {
      if (char === '"') in_quote = !in_quote;
      else if (char === ',' && !in_quote) {
        row[headers[col]] = current.replace(/"/g, '').trim();
        current = '';
        col++;
      } else current += char;
    }
    row[headers[col]] = current.replace(/"/g, '').trim();
    data.push(row);
  }
  return data;
}

// PLATFORM DETECTION
function detectPlatform(headers) {
  if (headers.some(h => h.includes('customer_id'))) return 'crm';
  if (headers.some(h => ['Campaign Name', 'Ad Set Name'].includes(h))) return 'meta';
  if (headers.some(h => ['Advertiser ID', 'Campaign ID'].includes(h))) return 'tiktok';
  if (headers.some(h => h.includes('Gender') && h.includes('Age'))) return 'meta_demographics';
  return null;
}

// NUMBER PARSER
const num = (s) => {
  const match = String(s).match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
};

// NORMALISE META
function normaliseMeta(data) {
  return data.map(row => ({
    campaign_name: row['Campaign Name'] || '',
    ad_set_name: row['Ad Set Name'] || '',
    ad_name: row['Ad Name'] || '',
    spend: num(row['Amount Spent (HKD)'] || 0),
    impressions: num(row['Impressions'] || 0),
    clicks: num(row['Clicks'] || 0),
    ctr: (num(row['Clicks'] || 0) / num(row['Impressions'] || 1)) * 100,
    cpa: num(row['Cost Per Link Click (HKD)'] || 0),
    frequency: num(row['Frequency'] || 0),
    conversions: num(row['Conversions'] || 0),
  }));
}

// NORMALISE TIKTOK
function normaliseTikTok(data) {
  return data.map(row => ({
    campaign_name: row['Campaign Name'] || '',
    ad_set_name: row['Ad Set Name'] || '',
    ad_name: row['Ad Name'] || '',
    spend: num(row['Spend (RMB)'] || 0) / 1.2,
    impressions: num(row['Impressions'] || 0),
    clicks: num(row['Clicks'] || 0),
    ctr: (num(row['Clicks'] || 0) / num(row['Impressions'] || 1)) * 100,
    cpa: num(row['Cost per Result (RMB)'] || 0) / 1.2,
    frequency: num(row['Impressions'] || 0) / num(row['Reach'] || 1),
    conversions: num(row['Conversions'] || 0),
  }));
}

// AGGREGATION
function aggByKey(data, key) {
  const agg = {};
  data.forEach(row => {
    const k = row[key];
    if (!agg[k]) agg[k] = {};
    Object.entries(row).forEach(([field, val]) => {
      if (typeof val === 'number') agg[k][field] = (agg[k][field] || 0) + val;
      else agg[k][field] = val;
    });
  });
  return Object.entries(agg).map(([k, v]) => ({ [key]: k, ...v }));
}

// DAILY TREND
function dailyTrend(data) {
  if (!data.some(r => r.date)) return data;
  const daily = {};
  data.forEach(row => {
    const d = row.date;
    if (!daily[d]) daily[d] = {};
    Object.entries(row).forEach(([field, val]) => {
      if (typeof val === 'number') daily[d][field] = (daily[d][field] || 0) + val;
      else daily[d][field] = val;
    });
  });
  return Object.entries(daily).map(([d, v]) => ({ date: d, ...v }));
}

// SPARKLINE
function Spark({ values, width = 60, height = 20 }) {
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - minV) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ verticalAlign: 'middle' }}>
      <polyline points={points} fill="none" stroke="#3b82f6" strokeWidth="1.5" />
    </svg>
  );
}

// MINI BAR
function MiniBar({ value, max = 100 }) {
  const pct = (value / max) * 100;
  return (
    <div style={{
      width: '60px',
      height: '8px',
      backgroundColor: '#e5e7eb',
      borderRadius: '4px',
      overflow: 'hidden'
    }}>
      <div style={{
        width: `${Math.min(pct, 100)}%`,
        height: '100%',
        backgroundColor: '#10b981',
        transition: 'width 0.3s'
      }} />
    </div>
  );
}

// DROP ZONE
function DropZone({ onFile }) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      style={{
        padding: '40px',
        border: dragging ? '2px solid #3b82f6' : '2px dashed #9ca3af',
        borderRadius: '8px',
        textAlign: 'center',
        cursor: 'pointer',
        backgroundColor: dragging ? '#eff6ff' : 'transparent',
        transition: 'all 0.2s'
      }}
      onClick={() => fileInputRef.current?.click()}
    >
      <div>📁 Drag CSV file here or click to upload</div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        style={{ display: 'none' }}
      />
    </div>
  );
}

// CHIP
function Chip({ fileName, size }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 12px',
      backgroundColor: '#e0e7ff',
      color: '#312e81',
      borderRadius: '16px',
      fontSize: '12px',
      marginTop: '12px'
    }}>
      📄 {fileName} ({(size / 1024).toFixed(1)} KB)
    </span>
  );
}

// KPI
function KPI({ label, value, change }) {
  return (
    <div style={{
      padding: '16px',
      backgroundColor: '#fff',
      borderRadius: '8px',
      borderLeft: '4px solid #3b82f6'
    }}>
      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: '600', color: '#1f2937' }}>
        {typeof value === 'number' ? value.toFixed(2) : value}
      </div>
      {change && (
        <div style={{
          fontSize: '12px',
          color: change > 0 ? '#10b981' : '#ef4444',
          marginTop: '4px'
        }}>
          {change > 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

// FLAG
function Flag({ value, threshold, direction = 'higher' }) {
  const isBad = direction === 'higher' ? value < threshold * 0.8 : value > threshold * 1.2;
  const isWarning = direction === 'higher' ? value < threshold : value > threshold;
  return isBad ? '🚩' : isWarning ? '🟨' : '✅';
}

// DONUT
function Donut({ data, width = 200, height = 200 }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = Math.min(width, height) / 2 - 10;
  const centerX = width / 2;
  const centerY = height / 2;
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  let currentAngle = -Math.PI / 2;
  const paths = data.map((d, i) => {
    const sliceAngle = (d.value / total) * 2 * Math.PI;
    const x1 = centerX + radius * Math.cos(currentAngle);
    const y1 = centerY + radius * Math.sin(currentAngle);
    const x2 = centerX + radius * Math.cos(currentAngle + sliceAngle);
    const y2 = centerY + radius * Math.sin(currentAngle + sliceAngle);
    const largeArc = sliceAngle > Math.PI ? 1 : 0;
    const innerRadius = radius * 0.6;
    const x3 = centerX + innerRadius * Math.cos(currentAngle + sliceAngle);
    const y3 = centerY + innerRadius * Math.sin(currentAngle + sliceAngle);
    const x4 = centerX + innerRadius * Math.cos(currentAngle);
    const y4 = centerY + innerRadius * Math.sin(currentAngle);
    const pathData = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    currentAngle += sliceAngle;
    return (
      <path key={i} d={pathData} fill={colors[i % colors.length]} />
    );
  });

  return (
    <div>
      <svg width={width} height={height}>{paths}</svg>
      <div style={{ fontSize: '12px', marginTop: '12px' }}>
        {data.map((d, i) => (
          <div key={i} style={{ marginBottom: '4px' }}>
            <span style={{
              display: 'inline-block',
              width: '12px',
              height: '12px',
              backgroundColor: colors[i % colors.length],
              marginRight: '6px'
            }} />
            {d.label}: {((d.value / total) * 100).toFixed(1)}%
          </div>
        ))}
      </div>
    </div>
  );
}

// MAIN DASHBOARD
function Dashboard() {
  const [tab, setTab] = useState('campaigns');
  const [fileName, setFileName] = useState(null);
  const [allData, setAllData] = useState([]);
  const [meta, setMeta] = useState([]);
  const [tiktok, setTiktok] = useState([]);
  const [crm, setCRM] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  const handleFile = useCallback(async (file) => {
    const text = await file.text();
    const parsed = parseCSV(text);
    const platform = detectPlatform(Object.keys(parsed[0] || {}));

    setFileName(file.name);

    if (platform === 'meta') {
      const normalized = normaliseMeta(parsed);
      setMeta(normalized);
      setAllData(normalized);
    } else if (platform === 'tiktok') {
      const normalized = normaliseTikTok(parsed);
      setTiktok(normalized);
      setAllData(normalized);
    } else if (platform === 'crm') {
      setCRM(parsed);
    }
  }, []);

  const campaigns = tab === 'campaigns' ? aggByKey(allData, 'campaign_name') : [];
  const totalSpend = campaigns.reduce((sum, c) => sum + (c.spend || 0), 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + (c.impressions || 0), 0);
  const avgCTR = campaigns.length > 0 ? campaigns.reduce((sum, c) => sum + (c.ctr || 0), 0) / campaigns.length : 0;
  const avgCPA = campaigns.length > 0 ? campaigns.reduce((sum, c) => sum + (c.cpa || 0), 0) / campaigns.length : 0;

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '20px' }}>🎯 HK Telco Ads Dashboard</h1>

      <DropZone onFile={handleFile} />
      {fileName && <Chip fileName={fileName} size={1024} />}

      {allData.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: '8px', marginTop: '20px', marginBottom: '20px' }}>
            <button
              onClick={() => { setTab('campaigns'); setSelectedCampaign(null); }}
              style={{
                padding: '8px 16px',
                backgroundColor: tab === 'campaigns' ? '#3b82f6' : '#e5e7eb',
                color: tab === 'campaigns' ? 'white' : 'black',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Campaign Performance
            </button>
            <button
              onClick={() => { setTab('customers'); setSelectedCampaign(null); }}
              style={{
                padding: '8px 16px',
                backgroundColor: tab === 'customers' ? '#3b82f6' : '#e5e7eb',
                color: tab === 'customers' ? 'white' : 'black',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Customer Value
            </button>
          </div>

          {tab === 'campaigns' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                <KPI label="Total Spend (HKD)" value={totalSpend} />
                <KPI label="Impressions" value={totalImpressions} />
                <KPI label="Avg CTR (%)" value={avgCTR} />
                <KPI label="Avg CPA (HKD)" value={avgCPA} />
              </div>

              <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '16px', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600' }}>Campaign</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>Spend</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>Impressions</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>CTR</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>CPA</th>
                      <th style={{ textAlign: 'center', padding: '8px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((camp, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px', cursor: 'pointer', color: '#3b82f6' }} onClick={() => setSelectedCampaign(camp.campaign_name)}>
                          {camp.campaign_name}
                        </td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>HKD {camp.spend?.toFixed(0)}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{camp.impressions?.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{camp.ctr?.toFixed(2)}%</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>HKD {camp.cpa?.toFixed(2)}</td>
                        <td style={{ textAlign: 'center', padding: '8px' }}>
                          <Flag value={camp.ctr} threshold={2} direction="higher" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'customers' && crm.length > 0 && (
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '16px' }}>
              <h2>Customer Value Analysis</h2>
              <p style={{ color: '#6b7280', marginTop: '12px' }}>
                Total Customers: {crm.length}
              </p>
              <div style={{ marginTop: '20px' }}>
                <Donut data={[
                  { label: '5G Plans', value: crm.filter(c => c.product_type === '5G').length },
                  { label: 'Roaming', value: crm.filter(c => c.product_type === 'roaming').length },
                  { label: 'Gamer Plans', value: crm.filter(c => c.product_type === 'gamer').length }
                ]} />
              </div>
            </div>
          )}

          {tab === 'customers' && crm.length === 0 && (
            <div style={{ backgroundColor: '#fef3c7', padding: '16px', borderRadius: '8px', color: '#92400e' }}>
              ⚠️ No CRM data loaded. Upload customer data CSV to view customer value analysis.
            </div>
          )}
        </>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<Dashboard />);

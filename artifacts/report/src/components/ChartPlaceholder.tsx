import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const data = [
  { name: '2024 Q1', adoption: 45 },
  { name: '2024 Q2', adoption: 52 },
  { name: '2024 Q3', adoption: 61 },
  { name: '2024 Q4', adoption: 74 },
  { name: '2025 Q1', adoption: 83 },
  { name: '2025 Q2', adoption: 90 },
];

export function ChartPlaceholder() {
  return (
    <div className="h-[400px] w-full mt-12 mb-12 p-6 rounded-2xl border border-[#e5e7eb]" style={{ backgroundColor: '#fafafa' }}>
      <h4 style={{ fontFamily: 'Montserrat', fontWeight: 600, fontSize: '11px', color: '#D63425', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '28px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#D63425', display: 'inline-block' }} />
        AI Adoption Trajectory Overview (Hong Kong)
      </h4>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorAdoption" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#D63425" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#D63425" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="name"
              stroke="#B6B6B6"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              dy={10}
              tick={{ fill: '#B6B6B6', fontFamily: 'Montserrat' }}
            />
            <YAxis
              stroke="#B6B6B6"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => `${val}%`}
              dx={-10}
              tick={{ fill: '#B6B6B6', fontFamily: 'Montserrat' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#ffffff',
                borderColor: '#e5e7eb',
                color: '#4d4d4d',
                borderRadius: '8px',
                fontFamily: 'Montserrat',
                fontSize: '13px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
              }}
              itemStyle={{ color: '#D63425', fontFamily: 'Montserrat', fontWeight: 600 }}
              labelStyle={{ color: '#B6B6B6', marginBottom: '6px', fontFamily: 'Montserrat', fontSize: '11px' }}
            />
            <Area
              type="monotone"
              dataKey="adoption"
              stroke="#D63425"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#colorAdoption)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

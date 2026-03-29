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
    <div className="h-[400px] w-full mt-12 mb-12 p-6 bg-card/40 backdrop-blur-sm border border-primary/20 rounded-2xl relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      <h4 className="font-display font-semibold text-primary uppercase tracking-widest text-xs mb-8 flex items-center">
        <span className="w-2 h-2 rounded-full bg-primary mr-3 animate-pulse" />
        AI Adoption Trajectory Overview (Hong Kong)
      </h4>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorAdoption" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dy={10} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}%`} dx={-10} />
            <Tooltip 
              contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))', borderRadius: '8px' }}
              itemStyle={{ color: 'hsl(var(--primary))', fontFamily: 'var(--font-display)', fontWeight: 'bold' }}
              labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '8px' }}
            />
            <Area type="monotone" dataKey="adoption" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorAdoption)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

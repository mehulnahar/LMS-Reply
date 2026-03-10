import { useEffect, useState, useMemo } from "react";
import { useTheme } from "../context/ThemeContext";
import { api } from "../api";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// ─────────────────────────────────────────
// Chart color palettes (light / dark)
// ─────────────────────────────────────────
const COLORS = {
  light: {
    primary: "#4f46e5", secondary: "#818cf8", emerald: "#10b981",
    amber: "#f59e0b", red: "#ef4444", gray: "#9ca3af",
    text: "#374151", subtext: "#9ca3af", grid: "#e5e7eb", bg: "#ffffff",
  },
  dark: {
    primary: "#818cf8", secondary: "#a5b4fc", emerald: "#34d399",
    amber: "#fbbf24", red: "#f87171", gray: "#6b7280",
    text: "#e5e7eb", subtext: "#6b7280", grid: "#374151", bg: "#111827",
  },
};

const SCORE_COLORS = ["#10b981", "#4f46e5", "#f59e0b", "#9ca3af", "#ef4444"];
const SCORE_COLORS_DARK = ["#34d399", "#818cf8", "#fbbf24", "#6b7280", "#f87171"];

const RANGES = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "all", label: "All Time" },
];

// ─────────────────────────────────────────
// Main Dashboard
// ─────────────────────────────────────────
export default function Dashboard() {
  const { dark } = useTheme();
  const c = dark ? COLORS.dark : COLORS.light;

  const [range, setRange] = useState("30d");
  const [emailData, setEmailData] = useState(null);
  const [emailLoading, setEmailLoading] = useState(true);

  // Call state
  const [callEvents, setCallEvents] = useState([]);
  const [callLoading, setCallLoading] = useState(true);

  // Fetch email analytics
  useEffect(() => {
    setEmailLoading(true);
    api.getEmailAnalytics(range)
      .then(setEmailData)
      .catch(() => setEmailData(null))
      .finally(() => setEmailLoading(false));
  }, [range]);

  // Fetch call events for current month
  useEffect(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    setCallLoading(true);
    api.getCallEvents(monthStart.toISOString(), monthEnd.toISOString())
      .then((data) => setCallEvents(data.events || []))
      .catch(() => setCallEvents([]))
      .finally(() => setCallLoading(false));
  }, []);

  // Compute call stats
  const callStats = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    let thisWeek = 0;
    let thisMonth = callEvents.length;
    let dbMatch = 0;
    let gmailFallback = 0;
    let noMatch = 0;
    const upcoming = [];

    for (const evt of callEvents) {
      const start = new Date(evt.start);
      if (start >= weekStart && start <= weekEnd) thisWeek++;
      if (start > now) upcoming.push(evt);

      if (evt.client) {
        if (evt.client.gmail_fallback) gmailFallback++;
        else dbMatch++;
      } else {
        noMatch++;
      }
    }

    upcoming.sort((a, b) => new Date(a.start) - new Date(b.start));

    return { thisWeek, thisMonth, dbMatch, gmailFallback, noMatch, upcoming: upcoming.slice(0, 5) };
  }, [callEvents]);

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Email and call performance overview
          </p>
        </div>
        <DateRangeSelector range={range} onChange={setRange} />
      </div>

      {/* ═══════ EMAIL ANALYTICS ═══════ */}
      <Section title="Email Analytics" icon={emailIcon}>
        {emailLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} />)}
          </div>
        ) : !emailData ? (
          <EmptyState message="Failed to load email analytics" />
        ) : (
          <div className="space-y-6">
            {/* Signal cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SignalCard icon={phoneIcon} label="With Phone" value={emailData.signals.with_phone} color="brand" />
              <SignalCard icon={urgentIcon} label="Urgent" value={emailData.signals.urgent} color="amber" />
              <SignalCard icon={hotIcon} label="Hot Signal" value={emailData.signals.hot_signal} color="red" />
              <SignalCard icon={unreadIcon} label="Unread" value={emailData.signals.unread} color="gray" />
            </div>

            {/* Pipeline Funnel */}
            <FunnelBar funnel={emailData.funnel} />

            {/* Charts row 1: Volume + Lead Scores */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="card p-5">
                <h3 className="text-sm font-semibold mb-4">Email Volume</h3>
                {emailData.volume.length === 0 ? (
                  <EmptyState message="No email data for this period" small />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={emailData.volume}>
                      <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: c.subtext }}
                        tickFormatter={(v) => { const d = new Date(v + "T00:00:00"); return `${d.getMonth() + 1}/${d.getDate()}`; }} />
                      <YAxis tick={{ fontSize: 10, fill: c.subtext }} allowDecimals={false} />
                      <Tooltip contentStyle={{ backgroundColor: c.bg, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 12 }}
                        labelFormatter={(v) => new Date(v + "T00:00:00").toLocaleDateString()} />
                      <Line type="monotone" dataKey="count" stroke={c.primary} strokeWidth={2} dot={false} name="Emails" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="card p-5">
                <h3 className="text-sm font-semibold mb-4">Lead Score Distribution</h3>
                {emailData.leadScores.length === 0 ? (
                  <EmptyState message="No scored emails yet" small />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={emailData.leadScores} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke={c.grid} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: c.subtext }} allowDecimals={false} />
                      <YAxis dataKey="band" type="category" width={110} tick={{ fontSize: 10, fill: c.subtext }} />
                      <Tooltip contentStyle={{ backgroundColor: c.bg, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" name="Emails" radius={[0, 4, 4, 0]}>
                        {emailData.leadScores.map((_, i) => (
                          <Cell key={i} fill={dark ? SCORE_COLORS_DARK[i] : SCORE_COLORS[i]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Charts row 2: Intent + Account breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="card p-5">
                <h3 className="text-sm font-semibold mb-4">Intent Breakdown</h3>
                {emailData.intents.length === 0 ? (
                  <EmptyState message="No intent data yet" small />
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(200, emailData.intents.length * 32)}>
                    <BarChart data={emailData.intents} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke={c.grid} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: c.subtext }} allowDecimals={false} />
                      <YAxis dataKey="label" type="category" width={130} tick={{ fontSize: 10, fill: c.subtext }} />
                      <Tooltip contentStyle={{ backgroundColor: c.bg, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" fill={c.primary} radius={[0, 4, 4, 0]} name="Emails" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="card p-5">
                <h3 className="text-sm font-semibold mb-4">Per Account</h3>
                {emailData.accounts.length === 0 ? (
                  <EmptyState message="No accounts connected" small />
                ) : (
                  <div className="space-y-3">
                    {emailData.accounts.map((a) => (
                      <div key={a.email} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{a.email}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {a.highQuality} high quality of {a.total} total
                          </p>
                        </div>
                        <span className="text-lg font-semibold">{a.total}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Velocity card */}
            <div className="card p-5">
              <h3 className="text-sm font-semibold mb-3">Response Velocity</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <VelocityStat
                  label="Avg Time to Reply"
                  value={emailData.velocity.avgHours != null ? formatHours(emailData.velocity.avgHours) : " - "}
                />
                <VelocityStat
                  label="Median Time to Reply"
                  value={emailData.velocity.medianHours != null ? formatHours(emailData.velocity.medianHours) : " - "}
                />
                <VelocityStat
                  label="Total Replied"
                  value={emailData.velocity.totalReplied.toString()}
                />
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* ═══════ CALL ANALYTICS ═══════ */}
      <Section title="Call Analytics" icon={callIcon}>
        {callLoading ? (
          <div className="grid grid-cols-2 gap-4">
            <Skeleton /> <Skeleton />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Count cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SignalCard icon={weekIcon} label="This Week" value={callStats.thisWeek} color="brand" />
              <SignalCard icon={monthIcon} label="This Month" value={callStats.thisMonth} color="purple" />
              <SignalCard icon={matchIcon} label="Auto-Matched" value={callStats.dbMatch + callStats.gmailFallback} color="emerald" />
              <SignalCard icon={noMatchIcon} label="No Match" value={callStats.noMatch} color="gray" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Match quality donut */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold mb-4">Match Quality</h3>
                {callStats.thisMonth === 0 ? (
                  <EmptyState message="No calls this month" small />
                ) : (
                  <MatchQualityChart stats={callStats} colors={c} dark={dark} />
                )}
              </div>

              {/* Upcoming calls */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold mb-4">Upcoming Calls</h3>
                {callStats.upcoming.length === 0 ? (
                  <EmptyState message="No upcoming calls" small />
                ) : (
                  <div className="space-y-2.5">
                    {callStats.upcoming.map((evt) => (
                      <UpcomingCallRow key={evt.id} event={evt} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

// ═══════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════

function DateRangeSelector({ range, onChange }) {
  return (
    <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
      {RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            range === r.value
              ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-gray-400 dark:text-gray-500">{icon}</span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

const SIGNAL_COLORS = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-900/20 dark:text-brand-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400",
  red: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400",
  gray: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
  purple: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400",
};

function SignalCard({ icon, label, value, color }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${SIGNAL_COLORS[color]}`}>
          {icon}
        </div>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function FunnelBar({ funnel }) {
  const total = funnel.new + funnel.replied + funnel.proposal_sent + funnel.won + funnel.lost + funnel.ignored;
  if (total === 0) return <EmptyState message="No emails in the pipeline yet" small />;

  const stages = [
    { label: "New", count: funnel.new, color: "bg-gray-200 dark:bg-gray-700" },
    { label: "Replied", count: funnel.replied, color: "bg-brand-200 dark:bg-brand-800" },
    { label: "Proposal Sent", count: funnel.proposal_sent, color: "bg-brand-400 dark:bg-brand-600" },
    { label: "Won", count: funnel.won, color: "bg-emerald-400 dark:bg-emerald-600" },
  ];

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold mb-4">Pipeline Funnel</h3>
      <div className="flex items-center gap-2">
        {stages.map((s, i) => {
          const prev = i === 0 ? total : stages[i - 1].count;
          const pct = prev > 0 ? Math.round((s.count / prev) * 100) : 0;
          return (
            <div key={s.label} className="flex items-center gap-2 flex-1">
              <div className="flex-1">
                <div className="flex items-baseline gap-1.5 mb-1">
                  <span className="text-lg font-bold">{s.count}</span>
                  {i > 0 && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">{pct}%</span>
                  )}
                </div>
                <div className={`h-2 rounded-full ${s.color}`} />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{s.label}</p>
              </div>
              {i < stages.length - 1 && (
                <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          );
        })}
      </div>
      {(funnel.lost > 0 || funnel.ignored > 0) && (
        <div className="flex gap-4 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
          {funnel.lost > 0 && (
            <span className="text-xs text-red-500 dark:text-red-400">
              {funnel.lost} lost
            </span>
          )}
          {funnel.ignored > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {funnel.ignored} ignored
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function VelocityStat({ label, value }) {
  return (
    <div className="text-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

function MatchQualityChart({ stats, colors: c, dark: isDark }) {
  const data = [
    { name: "DB Match", value: stats.dbMatch, color: isDark ? "#34d399" : "#10b981" },
    { name: "Gmail Fallback", value: stats.gmailFallback, color: isDark ? "#fbbf24" : "#f59e0b" },
    { name: "No Match", value: stats.noMatch, color: isDark ? "#6b7280" : "#9ca3af" },
  ].filter((d) => d.value > 0);

  if (data.length === 0) return <EmptyState message="No match data" small />;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={2}
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ backgroundColor: c.bg, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 12 }} />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          formatter={(value) => <span className="text-gray-600 dark:text-gray-300">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

function UpcomingCallRow({ event }) {
  const start = new Date(event.start);
  const hasPrep = !!event.prepOverrides;
  const clientName = event.client?.from_name || event.attendees?.[0]?.name || "Unknown";

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{event.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          {" at "}
          {start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          {" - "}
          {clientName}
        </p>
      </div>
      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
        hasPrep
          ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
          : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
      }`}>
        {hasPrep ? "Prepped" : "No prep"}
      </span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="card p-5 animate-pulse">
      <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/3 mb-3" />
      <div className="h-7 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
    </div>
  );
}

function EmptyState({ message, small }) {
  return (
    <div className={`flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 ${small ? "py-10" : "py-16"}`}>
      <svg className="w-8 h-8 mb-2 opacity-50" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function formatHours(h) {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

// ─────────────────────────────────────────
// Icons (inline SVG)
// ─────────────────────────────────────────
const emailIcon = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
  </svg>
);
const callIcon = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
  </svg>
);
const phoneIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
  </svg>
);
const urgentIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
);
const hotIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1.001A3.75 3.75 0 0012 18z" />
  </svg>
);
const unreadIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.98l7.5-4.04a2.25 2.25 0 012.134 0l7.5 4.04a2.25 2.25 0 011.183 1.98V19.5z" />
  </svg>
);
const weekIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
  </svg>
);
const monthIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
  </svg>
);
const matchIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.182-5.564a4.5 4.5 0 00-6.364 6.364L10.5 12.5" />
  </svg>
);
const noMatchIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
  </svg>
);

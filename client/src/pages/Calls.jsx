import { useState, useEffect, useCallback } from "react";
import { api } from "../api";

/* ================================================================
   Constants & pure helpers
   ================================================================ */
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6 AM - 9 PM
const HOUR_PX = 64;
const START_HOUR = 6;

function getMonday(offset = 0) {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function fmtDate(d) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function eventPosition(evt) {
  const s = new Date(evt.start);
  const e = new Date(evt.end);
  const startMins = (s.getHours() - START_HOUR) * 60 + s.getMinutes();
  const endMins = (e.getHours() - START_HOUR) * 60 + e.getMinutes();
  return {
    top: (startMins / 60) * HOUR_PX,
    height: Math.max(((endMins - startMins) / 60) * HOUR_PX, 28),
  };
}

function eventsForDay(events, date) {
  return events.filter((e) => isSameDay(new Date(e.start), date));
}

/* ================================================================
   Small shared components
   ================================================================ */
function Signals({ client }) {
  if (!client) return null;
  return (
    <span className="flex items-center gap-0.5 text-xs">
      {client.has_phone && <span title="Phone">📞</span>}
      {client.has_urgency && <span title="Urgency">⚡</span>}
      {client.hot_signal_flagged && <span title="Hot">🔥</span>}
    </span>
  );
}

function ScoreBadge({ score }) {
  if (!score) return null;
  const color = score >= 80
    ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
    : score >= 60
      ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400";
  return (
    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${color}`}>{score}</span>
  );
}

/* ================================================================
   Main page
   ================================================================ */
export default function Calls() {
  const [view, setView] = useState("week");
  const [weekOffset, setWeekOffset] = useState(0);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [selected, setSelected] = useState(null);

  const monday = getMonday(weekOffset);
  const weekDates = getWeekDates(monday);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = new Date(weekDates[0]);
      const end = new Date(weekDates[6]);
      end.setHours(23, 59, 59, 999);
      const data = await api.getCallEvents(start.toISOString(), end.toISOString());
      setEvents(data.events || []);
      setNeedsReauth(!!data.needsReauth);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const weekLabel = `${weekDates[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${weekDates[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="flex h-[calc(100vh-4rem)] -mx-4 sm:-mx-6">

      {/* ── Left: calendar area ── */}
      <div className={`flex flex-col flex-1 min-w-0 overflow-hidden ${selected ? "border-r border-gray-200 dark:border-gray-800" : ""}`}>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 bg-white dark:bg-gray-950">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Calls</h1>
            {loading && (
              <div className="w-3.5 h-3.5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Week nav */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setWeekOffset((w) => w - 1)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
              <button
                onClick={() => setWeekOffset(0)}
                className="px-3 py-1 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
              >
                Today
              </button>
              <button
                onClick={() => setWeekOffset((w) => w + 1)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400 hidden sm:inline ml-1">
                {weekLabel}
              </span>
            </div>

            {/* View toggle */}
            <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
              {["week", "list"].map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors capitalize
                    ${view === v
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Reauth banner */}
        {needsReauth && (
          <div className="mx-4 sm:mx-6 mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span>
              Calendar access not granted. Go to <strong>Settings &rarr; Gmail Accounts</strong>, disconnect your account, and reconnect it to grant calendar read access.
            </span>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mx-4 sm:mx-6 mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* View content */}
        <div className="flex-1 overflow-auto">
          {view === "week"
            ? <WeekView events={events} weekDates={weekDates} selected={selected} onSelect={setSelected} needsReauth={needsReauth} />
            : <ListView events={events} weekDates={weekDates} selected={selected} onSelect={setSelected} needsReauth={needsReauth} />
          }
        </div>
      </div>

      {/* ── Right: detail panel ── */}
      {selected && (
        <DetailPanel
          event={selected}
          onClose={() => setSelected(null)}
          onPrepSaved={(eventId, prep) => {
            setEvents(prev => prev.map(e => e.id === eventId ? { ...e, prepOverrides: prep } : e));
            setSelected(prev => prev && prev.id === eventId ? { ...prev, prepOverrides: prep } : prev);
          }}
        />
      )}
    </div>
  );
}

/* ================================================================
   Week View
   ================================================================ */
function WeekView({ events, weekDates, selected, onSelect }) {
  const today = new Date();
  const totalH = HOURS.length * HOUR_PX;
  const now = new Date();
  const nowTop = (now.getHours() - START_HOUR + now.getMinutes() / 60) * HOUR_PX;

  return (
    <div className="flex flex-col">
      {/* Day headers */}
      <div className="flex flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 sticky top-0 z-10" style={{ paddingLeft: "64px" }}>
        {weekDates.map((date, i) => {
          const isToday = isSameDay(date, today);
          return (
            <div key={i} className="flex-1 text-center py-2 border-l border-gray-200 dark:border-gray-800 first:border-l-0">
              <div className={`text-xs font-semibold uppercase tracking-wide ${isToday ? "text-brand-600 dark:text-brand-400" : "text-gray-400 dark:text-gray-500"}`}>
                {date.toLocaleDateString("en-US", { weekday: "short" })}
              </div>
              <div className={`mx-auto mt-0.5 w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold
                ${isToday ? "bg-brand-600 text-white" : "text-gray-800 dark:text-gray-200"}`}>
                {date.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="flex" style={{ minHeight: `${totalH}px` }}>
        {/* Time labels */}
        <div className="flex-shrink-0 relative" style={{ width: "64px", height: `${totalH}px` }}>
          {HOURS.map((h) => (
            <div key={h} style={{ position: "absolute", top: `${(h - START_HOUR) * HOUR_PX}px`, right: "6px" }}>
              <span className="text-xs text-gray-400 dark:text-gray-600">
                {h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`}
              </span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDates.map((date, colIdx) => {
          const dayEvts = eventsForDay(events, date);
          const isToday = isSameDay(date, today);

          return (
            <div
              key={colIdx}
              className="flex-1 border-l border-gray-200 dark:border-gray-800 relative"
              style={{ height: `${totalH}px` }}
            >
              {/* Hour lines */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-gray-100 dark:border-gray-800/70"
                  style={{ top: `${(h - START_HOUR) * HOUR_PX}px` }}
                />
              ))}

              {/* Half-hour lines */}
              {HOURS.map((h) => (
                <div
                  key={`h${h}`}
                  className="absolute left-0 right-0 border-t border-gray-50 dark:border-gray-800/30"
                  style={{ top: `${(h - START_HOUR) * HOUR_PX + HOUR_PX / 2}px` }}
                />
              ))}

              {/* Today highlight */}
              {isToday && (
                <div className="absolute inset-0 bg-brand-50/20 dark:bg-brand-900/5 pointer-events-none" />
              )}

              {/* Current time indicator */}
              {isToday && now.getHours() >= START_HOUR && (
                <div
                  className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                  style={{ top: `${nowTop}px` }}
                >
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1.5 flex-shrink-0 shadow-sm" />
                  <div className="flex-1 border-t-2 border-red-400" />
                </div>
              )}

              {/* Events */}
              {dayEvts.map((evt) => {
                const { top, height } = eventPosition(evt);
                const isSelected = selected?.id === evt.id;
                const hasClient = !!evt.client;

                return (
                  <button
                    key={evt.id}
                    onClick={() => onSelect(isSelected ? null : evt)}
                    className={`absolute left-1 right-1 rounded-lg px-2 py-1 text-left text-xs transition-all overflow-hidden z-10
                      ${hasClient
                        ? isSelected
                          ? "bg-emerald-600 text-white shadow-lg ring-2 ring-emerald-400 ring-offset-1"
                          : "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-100 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-200 dark:hover:bg-emerald-900/70"
                        : isSelected
                          ? "bg-gray-600 text-white shadow-md ring-2 ring-gray-400"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700"
                      }`}
                    style={{ top: `${top}px`, height: `${height}px` }}
                  >
                    <div className="font-semibold truncate leading-tight">{evt.title}</div>
                    {height > 36 && (
                      <div className="opacity-75 truncate mt-0.5">{fmtTime(evt.start)}</div>
                    )}
                    {height > 52 && evt.client?.from_name && (
                      <div className="opacity-75 truncate">{evt.client.from_name}</div>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================
   List View
   ================================================================ */
function ListView({ events, weekDates, selected, onSelect, needsReauth }) {
  const today = new Date();
  const grouped = weekDates
    .map((date) => ({ date, evts: eventsForDay(events, date) }))
    .filter((g) => g.evts.length > 0);

  if (!events.length && !grouped.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-600">
        <svg className="w-12 h-12 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <p className="text-sm font-medium">No calls this week</p>
        <p className="text-xs mt-1">
          {needsReauth
            ? "Reconnect Gmail in Settings to grant calendar access"
            : "Connect your Gmail to sync Google Calendar"}
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 py-5 space-y-6">
      {grouped.map(({ date, evts }) => {
        const isToday = isSameDay(date, today);
        return (
          <div key={date.toISOString()}>
            <div className="flex items-center gap-3 mb-3">
              <h3 className={`text-xs font-bold uppercase tracking-widest flex-shrink-0
                ${isToday ? "text-brand-600 dark:text-brand-400" : "text-gray-400 dark:text-gray-500"}`}>
                {isToday ? "Today" : fmtDate(date)}
              </h3>
              <div className="flex-1 border-t border-gray-200 dark:border-gray-800" />
            </div>

            <div className="space-y-2">
              {evts.map((evt) => {
                const isSelected = selected?.id === evt.id;
                const hasClient = !!evt.client;
                return (
                  <button
                    key={evt.id}
                    onClick={() => onSelect(isSelected ? null : evt)}
                    className={`w-full text-left rounded-xl border px-4 py-3 transition-all
                      ${isSelected
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20"
                        : hasClient
                          ? "border-emerald-200 dark:border-emerald-800/60 bg-white dark:bg-gray-900 hover:border-emerald-400 dark:hover:border-emerald-700"
                          : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700"
                      }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2
                          ${hasClient ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"}`}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">{evt.title}</span>
                            <Signals client={evt.client} />
                          </div>
                          {hasClient && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                              {evt.client.from_name}
                              {evt.client.job_heading ? ` · ${evt.client.job_heading}` : ""}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex-shrink-0 text-right">
                        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">{fmtTime(evt.start)}</div>
                        {hasClient && <ScoreBadge score={evt.client.lead_score} />}
                      </div>
                    </div>

                    {hasClient && (
                      <div className="mt-2 ml-4 flex items-center gap-2 flex-wrap">
                        {evt.client.country && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">{evt.client.country}</span>
                        )}
                        {evt.client.stage && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {evt.client.stage.replace(/_/g, " ")}
                          </span>
                        )}
                        {evt.client.follow_up_count > 0 && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {evt.client.follow_up_count} follow-up{evt.client.follow_up_count !== 1 ? "s" : ""}
                          </span>
                        )}
                        {evt.meetLink && (
                          <span className="text-xs text-blue-500 dark:text-blue-400">Meet link</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================
   Detail Panel
   ================================================================ */
function mergeClientData(autoClient, prepOverrides, attendees) {
  const defaultEmail = (attendees || []).filter(a => !a.self).map(a => a.email).join(", ");
  const base = {
    from_name: "", from_email: defaultEmail, lead_score: null, country: "",
    job_heading: "", job_description: "", email_body: "", reply_text: "",
    reply_date: null, has_phone: false, has_urgency: false, hot_signal_flagged: false,
    follow_up_count: 0, kill_switch_active: false, stage: null, match_status: null,
    gmail_fallback: false, gmail_threads_found: 0, gmail_subject: "", notes: "",
  };
  if (autoClient) {
    for (const k of Object.keys(base)) {
      if (autoClient[k] !== undefined && autoClient[k] !== null && autoClient[k] !== "") base[k] = autoClient[k];
    }
  }
  if (prepOverrides) {
    if (prepOverrides.client_name) base.from_name = prepOverrides.client_name;
    if (prepOverrides.client_email) base.from_email = prepOverrides.client_email;
    if (prepOverrides.lead_score != null) base.lead_score = prepOverrides.lead_score;
    if (prepOverrides.country) base.country = prepOverrides.country;
    if (prepOverrides.job_heading) base.job_heading = prepOverrides.job_heading;
    if (prepOverrides.job_description) base.job_description = prepOverrides.job_description;
    if (prepOverrides.what_they_said) base.email_body = prepOverrides.what_they_said;
    if (prepOverrides.our_last_reply) base.reply_text = prepOverrides.our_last_reply;
    if (prepOverrides.has_phone != null) base.has_phone = prepOverrides.has_phone;
    if (prepOverrides.has_urgency != null) base.has_urgency = prepOverrides.has_urgency;
    if (prepOverrides.hot_signal_flagged != null) base.hot_signal_flagged = prepOverrides.hot_signal_flagged;
    if (prepOverrides.notes) base.notes = prepOverrides.notes;
  }
  return base;
}

function DetailPanel({ event, onClose, onPrepSaved }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState(null);

  const display = mergeClientData(event.client, event.prepOverrides, event.attendees);

  const sourceLabel = event.client
    ? event.client.gmail_fallback
      ? `Gmail fallback${event.client.gmail_threads_found > 1 ? ` - ${event.client.gmail_threads_found} threads` : ""}`
      : "DB match"
    : "No auto-match";

  const sourceColor = event.client
    ? event.client.gmail_fallback
      ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
      : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
    : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";

  const d = editing ? editData : display;

  const handleEdit = () => {
    setEditData({ ...display });
    setEditing(true);
  };
  const handleCancel = () => { setEditing(false); setEditData(null); };
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.saveCallPrep(event.id, {
        client_name: editData.from_name || null,
        client_email: editData.from_email || null,
        lead_score: editData.lead_score,
        country: editData.country || null,
        job_heading: editData.job_heading || null,
        job_description: editData.job_description || null,
        what_they_said: editData.email_body || null,
        our_last_reply: editData.reply_text || null,
        notes: editData.notes || null,
        has_phone: editData.has_phone,
        has_urgency: editData.has_urgency,
        hot_signal_flagged: editData.hot_signal_flagged,
      });
      if (onPrepSaved) onPrepSaved(event.id, res.prep);
      setEditing(false);
      setEditData(null);
    } catch (err) {
      console.error("Save call prep failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field, value) => setEditData(prev => ({ ...prev, [field]: value }));

  const copyCallPrep = () => {
    const externalAttendees = (event.attendees || []).filter((a) => !a.self);
    const parts = [
      `CALL: ${event.title}`,
      `TIME: ${fmtTime(event.start)} - ${fmtTime(event.end)}`,
      event.location ? `LOCATION: ${event.location}` : null,
      event.meetLink ? `MEET: ${event.meetLink}` : null,
      externalAttendees.length
        ? `ATTENDEES: ${externalAttendees.map((a) => a.name && a.name !== a.email ? `${a.name} (${a.email})` : a.email).join(", ")}`
        : null,
      "",
      d.from_name || d.from_email ? `CLIENT: ${d.from_name}${d.from_email ? ` (${d.from_email})` : ""}` : null,
      d.lead_score ? `SCORE: ${d.lead_score}${d.country ? ` | ${d.country}` : ""}` : null,
      "",
      d.job_heading ? `PROJECT: ${d.job_heading}` : null,
      "",
      d.job_description ? `JOB DESCRIPTION:\n${d.job_description}` : null,
      "",
      d.email_body ? `WHAT THEY SAID:\n${d.email_body}` : null,
      "",
      d.reply_text ? `OUR LAST REPLY:\n${d.reply_text}` : null,
      "",
      d.notes ? `NOTES:\n${d.notes}` : null,
      "",
      `SIGNALS: ${[
        d.has_phone && "Phone provided",
        d.has_urgency && "Urgency detected",
        d.hot_signal_flagged && "Hot prospect",
      ].filter(Boolean).join(" | ") || "None"}`,
    ].filter((l) => l !== null);

    navigator.clipboard.writeText(parts.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inputCls = "w-full text-xs bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500";
  const textareaCls = `${inputCls} resize-none`;
  const placeholderText = "text-xs italic text-gray-300 dark:text-gray-600";

  return (
    <div className="w-[400px] flex-shrink-0 flex flex-col border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 overflow-hidden">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white leading-tight">{event.title}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {fmtTime(event.start)} - {fmtTime(event.end)}
            <span className="mx-1.5">·</span>
            <span className="truncate">{event.calendarAccount}</span>
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {editing ? (
            <>
              <button onClick={handleCancel} className="px-2.5 py-1 text-xs rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="px-2.5 py-1 text-xs rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <button onClick={handleEdit} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Edit">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* Meet link */}
        {event.meetLink && (
          <a
            href={event.meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors font-medium"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Join Meeting
          </a>
        )}

        {/* Client summary card */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/60">
            {editing ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputCls} value={editData.from_name} onChange={e => updateField("from_name", e.target.value)} placeholder="Client name" />
                  <input className={inputCls} type="number" value={editData.lead_score ?? ""} onChange={e => updateField("lead_score", e.target.value ? parseInt(e.target.value) : null)} placeholder="Score" />
                </div>
                <input className={inputCls} value={editData.from_email} onChange={e => updateField("from_email", e.target.value)} placeholder="Client email" />
                <input className={inputCls} value={editData.country} onChange={e => updateField("country", e.target.value)} placeholder="Country" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
                      {d.from_name || <span className={placeholderText}>No client name</span>}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {d.from_email || <span className={placeholderText}>No email</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Signals client={d} />
                    <ScoreBadge score={d.lead_score} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${sourceColor}`}>{sourceLabel}</span>
                  {d.country && <Tag>{d.country}</Tag>}
                  {d.stage && <Tag>{d.stage.replace(/_/g, " ")}</Tag>}
                  {d.follow_up_count > 0 && (
                    <Tag>{d.follow_up_count} follow-up{d.follow_up_count !== 1 ? "s" : ""}</Tag>
                  )}
                  {d.kill_switch_active && (
                    <Tag className="!text-red-600 dark:!text-red-400 !border-red-200 dark:!border-red-800 !bg-red-50 dark:!bg-red-900/20">
                      Kill switch
                    </Tag>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Job Heading */}
        <InfoSection title="Project">
          {editing ? (
            <input className={inputCls} value={editData.job_heading} onChange={e => updateField("job_heading", e.target.value)} placeholder="Project / job heading" />
          ) : (
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {d.job_heading || <span className={placeholderText}>No project heading</span>}
            </p>
          )}
        </InfoSection>

        {/* Job Description */}
        <InfoSection title="Job Description">
          {editing ? (
            <textarea className={textareaCls} rows={4} value={editData.job_description} onChange={e => updateField("job_description", e.target.value)} placeholder="Job description..." />
          ) : (
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line">
              {d.job_description || <span className={placeholderText}>No job description</span>}
            </p>
          )}
        </InfoSection>

        {/* What They Said */}
        <InfoSection title="What They Said">
          {editing ? (
            <textarea className={textareaCls} rows={4} value={editData.email_body} onChange={e => updateField("email_body", e.target.value)} placeholder="Client's message..." />
          ) : (
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line">
              {d.email_body || <span className={placeholderText}>No email content</span>}
            </p>
          )}
        </InfoSection>

        {/* Our Last Reply */}
        <InfoSection title="Our Last Reply">
          {editing ? (
            <textarea className={textareaCls} rows={3} value={editData.reply_text} onChange={e => updateField("reply_text", e.target.value)} placeholder="Our reply..." />
          ) : (
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line">
              {d.reply_text || <span className={placeholderText}>No reply sent</span>}
            </p>
          )}
        </InfoSection>

        {/* Notes */}
        <InfoSection title="Notes">
          {editing ? (
            <textarea className={textareaCls} rows={3} value={editData.notes} onChange={e => updateField("notes", e.target.value)} placeholder="Your prep notes..." />
          ) : (
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line">
              {d.notes || <span className={placeholderText}>No notes</span>}
            </p>
          )}
        </InfoSection>

        {/* Key Signals */}
        <InfoSection title="Key Signals">
          {editing ? (
            <div className="space-y-2">
              {[
                { key: "has_phone", label: "Phone number provided" },
                { key: "has_urgency", label: "Urgency language detected" },
                { key: "hot_signal_flagged", label: "Hot prospect flagged" },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={!!editData[key]} onChange={e => updateField(key, e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500" />
                  {label}
                </label>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <SignalRow active={d.has_phone} label="Phone number provided" />
              <SignalRow active={d.has_urgency} label="Urgency language detected" />
              <SignalRow active={d.hot_signal_flagged} label="Hot prospect flagged" />
            </div>
          )}
        </InfoSection>

        {/* Copy Call Prep */}
        <button
          onClick={copyCallPrep}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all mt-2
            ${copied
              ? "bg-emerald-600 text-white"
              : "bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-100"
            }`}
        >
          {copied ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Copied to clipboard!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              Copy Call Prep
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ================================================================
   Micro-components
   ================================================================ */
function InfoSection({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">{title}</h3>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 bg-white dark:bg-gray-900/60">
        {children}
      </div>
    </div>
  );
}

function Tag({ children, className = "" }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 ${className}`}>
      {children}
    </span>
  );
}

function SignalRow({ active, label }) {
  return (
    <div className={`flex items-center gap-2 text-xs ${active ? "text-gray-700 dark:text-gray-300" : "text-gray-400 dark:text-gray-600"}`}>
      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0
        ${active ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" : "bg-gray-100 dark:bg-gray-800 text-gray-400"}`}>
        {active ? (
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ) : (
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>
      {label}
    </div>
  );
}

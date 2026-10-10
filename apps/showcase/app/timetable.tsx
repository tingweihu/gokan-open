"use client";

import { useMemo } from "react";

export type TimetableItem = { id?: string; eventId?: string; title: string; startAt: string; endAt: string; venue: string | null; detail?: string; day?: 1 | 2; conflict?: boolean; selected?: boolean };

function taipeiTime(value: string) { return new Date(value).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }); }
function minutes(value: string) { const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).formatToParts(new Date(value)); return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0); }
function dateKey(value: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(value)); }
function dayLabel(day: 1 | 2, competitionStartsAt?: string | null) { if (!competitionStartsAt) return `第${day}天`; const date = new Date(new Date(competitionStartsAt).getTime() + (day - 1) * 86_400_000); return `第${day}天 · ${new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", weekday: "short", timeZone: "Asia/Taipei" }).format(date)}`; }
function inferDay(item: TimetableItem, competitionStartsAt?: string | null): 1 | 2 { if (item.day) return item.day; if (!competitionStartsAt) return 1; return dateKey(item.startAt) === dateKey(competitionStartsAt) ? 1 : 2; }
function venueClass(venue: string | null) { const value = (venue ?? "未指定場地").trim(); if (value.includes("操場")) return "venue-mint"; if (value.includes("籃球")) return "venue-yellow"; if (value.includes("排球")) return "venue-pink"; const hash = [...value].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 0); return `venue-fallback-${hash % 3}`; }

export function SharedTimetable({ items, competitionStartsAt, onItemClick, emptyText = "目前沒有可顯示的賽事。" }: { items: TimetableItem[]; competitionStartsAt?: string | null; onItemClick?: (item: TimetableItem) => void; emptyText?: string }) {
  const grouped = useMemo(() => ([1, 2] as const).map((day) => ({ day, items: items.filter((item) => inferDay(item, competitionStartsAt) === day).sort((a, b) => minutes(a.startAt) - minutes(b.startAt)) })), [items, competitionStartsAt]);
  if (!items.length) return <p className="empty-note">{emptyText}</p>;
  return <div className="shared-timetable">{grouped.map(({ day, items: dayItems }) => {
    const venues = [...new Set(dayItems.map((item) => item.venue || "未指定場地"))];
    const min = dayItems.length ? Math.min(...dayItems.map((item) => minutes(item.startAt))) : 8 * 60;
    const max = dayItems.length ? Math.max(...dayItems.map((item) => minutes(item.endAt))) : 20 * 60;
    const range = Math.max(60, max - min);
    const height = Math.max(480, range * 1.8);
    const minBlockHeight = (72 / height) * 100;
    return <section className="shared-timetable-day card" key={day}>
      <div className="section-heading"><div><p className="eyebrow">比賽日</p><h2>{dayLabel(day, competitionStartsAt)}</h2></div><span className="badge">{dayItems.length} 項</span></div>
      {!dayItems.length ? <p className="empty-note">這一天目前沒有已發布賽事。</p> : <>
        <div className="timetable-grid"><div className="time-axis"><div className="time-axis-header" aria-hidden="true" /><div className="time-axis-body" style={{ minHeight: height }}>{Array.from({ length: Math.floor(range / 60) + 1 }, (_, index) => <span key={index} style={{ top: `${(index * 60 / range) * 100}%` }}>{`${String(Math.floor((min + index * 60) / 60)).padStart(2, "0")}:00`}</span>)}</div></div>
          {venues.map((venue) => <div className="venue-lane" key={venue}><h3>{venue}</h3><div className="venue-lane-body" style={{ minHeight: height }}>{dayItems.filter((item) => (item.venue || "未指定場地") === venue).map((item) => {
            const top = ((minutes(item.startAt) - min) / range) * 100;
            const blockHeight = Math.max(minBlockHeight, ((minutes(item.endAt) - minutes(item.startAt)) / range) * 100);
            const className = `event-timetable-card schedule-block ${venueClass(item.venue)}${item.conflict ? " schedule-conflict" : ""}${item.selected === true ? " is-selected" : item.selected === false ? " is-unselected" : ""}`;
            return <span className="event-timetable-position" style={{ top: `${top}%`, height: `${blockHeight}%` }} key={item.id ?? `${item.startAt}-${item.title}`}><button type="button" className={className} onClick={() => onItemClick?.(item)} disabled={!onItemClick}><strong>{item.title}</strong><span>{taipeiTime(item.startAt)}–{taipeiTime(item.endAt)}</span><small>{item.venue || "未指定場地"}{item.detail ? ` · ${item.detail}` : ""}</small>{item.conflict && <small className="conflict-text">時間衝突，請檢查</small>}</button></span>;
          })}</div></div>)}
        </div>
        <div className="mobile-timetable">{dayItems.map((item) => <button type="button" className={`event-timetable-card ${venueClass(item.venue)}${item.conflict ? " schedule-conflict" : ""}${item.selected === true ? " is-selected" : item.selected === false ? " is-unselected" : ""}`} key={`mobile-${item.id ?? `${item.startAt}-${item.title}`}`} onClick={() => onItemClick?.(item)} disabled={!onItemClick}><strong>{item.title}</strong><span>{taipeiTime(item.startAt)}–{taipeiTime(item.endAt)}</span><small>{item.venue || "未指定場地"}{item.detail ? ` · ${item.detail}` : ""}</small></button>)}</div>
      </>}
    </section>;
  })}</div>;
}

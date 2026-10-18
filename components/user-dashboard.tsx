"use client";

import { useMemo } from "react";
import { AlertCircleIcon, BellIcon, CheckCircleIcon, ClockIcon } from "@/components/icons";
import {
  DUE_CLASS,
  EmptyState,
  cardClass,
  dueStatus,
  formatDateTime,
  timeAgo,
  useWorkspace,
} from "@/components/ui/kit";

/** Personal view: tasks and checklist items assigned to me, plus mentions. */
export function UserDashboard() {
  const { snapshot, navigate, run } = useWorkspace();
  const me = snapshot.me.id;

  const myCards = useMemo(
    () =>
      snapshot.cards
        .filter((c) => c.assignee_ids.includes(me))
        .sort((a, b) => (a.due_at || "9999").localeCompare(b.due_at || "9999")),
    [snapshot.cards, me],
  );
  const open = myCards.filter((c) => !c.completed_at);
  const done = myCards.filter((c) => c.completed_at);
  const overdue = open.filter((c) => dueStatus(c.due_at, null) === "overdue");
  const soon = open.filter((c) => dueStatus(c.due_at, null) === "soon");
  const myItems = snapshot.cards.flatMap((c) =>
    c.checklist_items.filter((i) => i.assignee_id === me && !i.is_done).map((i) => ({ item: i, card: c })),
  );
  const mentions = snapshot.notifications.filter((n) => n.type === "mention").slice(0, 8);
  const listName = (id: string) => snapshot.lists.find((l) => l.id === id)?.name || "-";
  const boardName = (id: string) => snapshot.boards.find((b) => b.id === id)?.name || "-";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Tugas aktif", value: open.length, icon: <ClockIcon className="h-4 w-4 text-primary" /> },
          { label: "Deadline < 24 jam", value: soon.length, icon: <BellIcon className="h-4 w-4 text-[#a87400]" /> },
          { label: "Lewat deadline", value: overdue.length, icon: <AlertCircleIcon className="h-4 w-4 text-danger" /> },
          { label: "Selesai", value: done.length, icon: <CheckCircleIcon className="h-4 w-4 text-success" /> },
        ].map((s) => (
          <div key={s.label} className={cardClass}>
            <div className="flex items-center gap-2 text-[11px] font-semibold text-muted">
              {s.icon} {s.label}
            </div>
            <div className="mt-1 text-2xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className={`${cardClass} space-y-2 lg:col-span-2`}>
          <h2 className="text-sm font-bold">Tugas saya</h2>
          {open.length === 0 && <EmptyState title="Tidak ada tugas aktif">Semua tugas Anda sudah beres.</EmptyState>}
          {open.map((c) => {
            const status = dueStatus(c.due_at, c.completed_at);
            const doneItems = c.checklist_items.filter((i) => i.is_done).length;
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line p-3">
                <button type="button" onClick={() => navigate({ tab: "kanban", boardId: c.board_id, cardId: c.id })} className="min-w-0 cursor-pointer text-left">
                  <div className="truncate text-xs font-semibold hover:text-primary">{c.title}</div>
                  <div className="text-[11px] text-muted">
                    {boardName(c.board_id)} · {listName(c.list_id)}
                    {c.checklist_items.length > 0 && ` · checklist ${doneItems}/${c.checklist_items.length}`}
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  {c.due_at && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${DUE_CLASS[status]}`}>{formatDateTime(c.due_at)}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => run("card:update", { card_id: c.id, completed: true }, "Tugas ditandai selesai")}
                    className="cursor-pointer rounded-card border border-success/30 px-2.5 py-1 text-[11px] font-semibold text-success hover:bg-success/10"
                  >
                    Selesai
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-5">
          <div className={`${cardClass} space-y-2`}>
            <h2 className="text-sm font-bold">Checklist untuk saya</h2>
            {myItems.length === 0 && <div className="text-[11px] text-muted">Tidak ada item checklist.</div>}
            {myItems.map(({ item, card }) => (
              <label key={item.id} className="flex cursor-pointer items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5" onChange={() => run("checklist:toggle_item", { item_id: item.id })} />
                <span>
                  {item.content}
                  <span className="block text-[10px] text-muted">
                    {card.title}
                    {item.due_at && ` · ${formatDateTime(item.due_at)}`}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className={`${cardClass} space-y-2`}>
            <h2 className="text-sm font-bold">Mention terbaru</h2>
            {mentions.length === 0 && <div className="text-[11px] text-muted">Belum ada yang menyebut Anda.</div>}
            {mentions.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  const msg = snapshot.messages.find((m) => m.id === n.ref_id);
                  if (msg) navigate({ tab: "chat", roomId: msg.room_id });
                }}
                className={`block w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-floor ${n.is_read ? "text-muted" : "font-semibold"}`}
              >
                {n.title}
                <span className="block text-[10px] font-normal text-subtle">{timeAgo(n.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {done.length > 0 && (
        <div className={`${cardClass} space-y-2`}>
          <h2 className="text-sm font-bold">Sudah selesai</h2>
          <div className="flex flex-wrap gap-2">
            {done.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate({ tab: "kanban", boardId: c.board_id, cardId: c.id })}
                className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-[11px] text-muted line-through hover:border-primary"
              >
                {c.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

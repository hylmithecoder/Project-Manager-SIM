"use client";

import { useMemo, useState } from "react";
import {
  ArrowRightIcon,
  ChatIcon,
  CheckIcon,
  ClockIcon,
  EditIcon,
  LinkIcon,
  LockIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
} from "@/components/icons";
import {
  Avatar,
  DUE_CLASS,
  EmptyState,
  Modal,
  Toggle,
  cardClass,
  dueStatus,
  formatDateTime,
  inputClass,
  labelColor,
  outlineBtn,
  primaryBtn,
  smallInputClass,
  timeAgo,
  useWorkspace,
} from "@/components/ui/kit";
import type { BoardDto, CardDto } from "@/server/ws/protocol";
import { CardDetailModal } from "./card-detail-modal";

export function KanbanBoardView() {
  const { snapshot, nav, navigate, run } = useWorkspace();
  const activeWs = snapshot.workspaces.find((w) => w.id === snapshot.active_workspace_id);
  const myRole = activeWs?.my_role || "guest";
  const canWrite = myRole !== "guest";
  const board = snapshot.boards.find((b) => b.id === nav.boardId) || snapshot.boards[0] || null;
  const canManageBoard =
    !!board && (myRole === "owner" || myRole === "admin" || (board.created_by === snapshot.me.id && canWrite));

  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [cardDraft, setCardDraft] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ listId: string; index: number } | null>(null);
  const [filterMine, setFilterMine] = useState(false);

  const lists = useMemo(
    () => (board ? snapshot.lists.filter((l) => l.board_id === board.id).sort((a, b) => a.position - b.position) : []),
    [snapshot.lists, board],
  );
  const cardsByList = useMemo(() => {
    const map = new Map<string, CardDto[]>();
    if (!board) return map;
    for (const c of snapshot.cards) {
      if (c.board_id !== board.id) continue;
      if (filterMine && !c.assignee_ids.includes(snapshot.me.id)) continue;
      map.set(c.list_id, [...(map.get(c.list_id) || []), c]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [snapshot.cards, snapshot.me.id, board, filterMine]);
  const userById = useMemo(() => new Map(snapshot.users.map((u) => [u.id, u])), [snapshot.users]);
  const openCard = snapshot.cards.find((c) => c.id === nav.cardId);
  const activities = board ? snapshot.activities.filter((a) => a.board_id === board.id).slice(0, 12) : [];

  const drop = (listId: string, index: number) => {
    if (!dragCardId) return;
    const card = snapshot.cards.find((c) => c.id === dragCardId);
    setDragCardId(null);
    setDropHint(null);
    if (!card) return;
    const siblings = cardsByList.get(listId) || [];
    const currentIndex = siblings.findIndex((c) => c.id === card.id);
    if (card.list_id === listId && (currentIndex === index || currentIndex === index - 1)) return;
    const targetIndex = card.list_id === listId && currentIndex >= 0 && currentIndex < index ? index - 1 : index;
    run("card:move", { card_id: card.id, target_list_id: listId, target_index: targetIndex });
  };

  if (!board) {
    return (
      <div className="space-y-4">
        <EmptyState title="Belum ada board di workspace ini">
          {canWrite ? "Buat board pertama untuk mulai mengelola tugas tim." : "Tunggu admin membuat board."}
        </EmptyState>
        {canWrite && (
          <div className="flex justify-center">
            <button type="button" className={primaryBtn} onClick={() => setNewBoardOpen(true)}>
              <PlusIcon className="h-4 w-4" /> Board baru
            </button>
          </div>
        )}
        <NewBoardModal open={newBoardOpen} onClose={() => setNewBoardOpen(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className={`${cardClass} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {snapshot.boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => navigate({ boardId: b.id })}
              className={`flex cursor-pointer items-center gap-1.5 rounded-card px-3.5 py-1.5 text-xs font-semibold transition ${
                board.id === b.id ? "bg-primary text-on-primary" : "border border-line bg-floor text-ink hover:border-primary hover:text-primary"
              }`}
            >
              {b.visibility === "private" && <LockIcon className="h-3 w-3" />}
              {b.name}
            </button>
          ))}
          {canWrite && (
            <button type="button" onClick={() => setNewBoardOpen(true)} className={outlineBtn}>
              <PlusIcon className="h-3.5 w-3.5" /> Board
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-muted">
            <Toggle checked={filterMine} onChange={setFilterMine} /> Tugas saya
          </label>
          {board.room_id && (
            <button type="button" className={outlineBtn} onClick={() => navigate({ tab: "chat", roomId: board.room_id! })}>
              <ChatIcon className="h-3.5 w-3.5" /> Diskusi board
            </button>
          )}
          {canManageBoard && (
            <button type="button" className={outlineBtn} onClick={() => setSettingsOpen(true)}>
              <SettingsIcon className="h-3.5 w-3.5" /> Atur
            </button>
          )}
        </div>
      </section>

      {!canWrite && (
        <div className="rounded-card border border-line bg-bg px-4 py-2.5 text-[11px] text-muted">
          Anda bergabung sebagai <strong>tamu</strong>: dapat melihat board dan berdiskusi di chat, tetapi tidak mengubah tugas.
        </div>
      )}

      <div className="flex items-start gap-4 overflow-x-auto pb-4">
        {lists.map((list, listIdx) => {
          const cards = cardsByList.get(list.id) || [];
          return (
            <div
              key={list.id}
              className={`flex w-72 shrink-0 flex-col rounded-card border bg-bg p-3 shadow-soft transition ${
                dropHint?.listId === list.id ? "border-primary" : "border-line"
              }`}
              onDragOver={(e) => {
                if (!dragCardId) return;
                e.preventDefault();
                if (dropHint?.listId !== list.id) setDropHint({ listId: list.id, index: cards.length });
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(list.id, dropHint?.listId === list.id ? dropHint.index : cards.length);
              }}
            >
              <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2">
                {renaming?.id === list.id ? (
                  <form
                    className="flex-1"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await run("list:update", { list_id: list.id, name: renaming.name })) setRenaming(null);
                    }}
                  >
                    <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: list.id, name: e.target.value })} onBlur={() => setRenaming(null)} className={smallInputClass} />
                  </form>
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="truncate text-sm font-bold">{list.name}</h2>
                    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold text-primary">{cards.length}</span>
                  </div>
                )}
                {canWrite && renaming?.id !== list.id && (
                  <div className="flex shrink-0 items-center gap-1 text-muted">
                    <button type="button" title="Geser kiri" disabled={listIdx === 0} onClick={() => run("list:move", { list_id: list.id, direction: -1 })} className="cursor-pointer rotate-180 hover:text-primary disabled:opacity-30">
                      <ArrowRightIcon className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" title="Geser kanan" disabled={listIdx === lists.length - 1} onClick={() => run("list:move", { list_id: list.id, direction: 1 })} className="cursor-pointer hover:text-primary disabled:opacity-30">
                      <ArrowRightIcon className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" title="Ganti nama" onClick={() => setRenaming({ id: list.id, name: list.name })} className="cursor-pointer hover:text-primary">
                      <EditIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Arsipkan kolom"
                      onClick={() => {
                        if (window.confirm(`Arsipkan kolom "${list.name}" beserta card di dalamnya?`)) run("list:delete", { list_id: list.id });
                      }}
                      className="cursor-pointer hover:text-danger"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="min-h-8 space-y-2.5">
                {cards.map((card, idx) => (
                  <div key={card.id}>
                    {dropHint?.listId === list.id && dropHint.index === idx && dragCardId && <div className="mb-2 h-1 rounded-full bg-primary" />}
                    <CardPreview
                      card={card}
                      draggable={canWrite}
                      userName={(id) => userById.get(id)?.name || "?"}
                      labels={snapshot.labels}
                      onOpen={() => navigate({ cardId: card.id })}
                      onDragStart={() => setDragCardId(card.id)}
                      onDragEnd={() => {
                        setDragCardId(null);
                        setDropHint(null);
                      }}
                      onDragOver={(e) => {
                        if (!dragCardId) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const index = e.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
                        if (dropHint?.listId !== list.id || dropHint.index !== index) setDropHint({ listId: list.id, index });
                      }}
                    />
                  </div>
                ))}
                {dropHint?.listId === list.id && dropHint.index === cards.length && dragCardId && <div className="h-1 rounded-full bg-primary" />}
              </div>

              {canWrite && (
                <form
                  className="mt-3 flex gap-1.5 border-t border-line pt-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const title = cardDraft[list.id]?.trim();
                    if (!title) return;
                    if (await run("card:create", { list_id: list.id, title })) setCardDraft((p) => ({ ...p, [list.id]: "" }));
                  }}
                >
                  <input value={cardDraft[list.id] || ""} onChange={(e) => setCardDraft((p) => ({ ...p, [list.id]: e.target.value }))} placeholder="Judul card baru..." className={smallInputClass} />
                  <button type="submit" className={`${primaryBtn} px-2.5`} aria-label="Tambah card">
                    <PlusIcon className="h-3.5 w-3.5" />
                  </button>
                </form>
              )}
            </div>
          );
        })}

        {canWrite && (
          <form
            className="w-64 shrink-0 space-y-2 rounded-card border border-dashed border-line bg-bg/60 p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newListName.trim()) return;
              if (await run("list:create", { board_id: board.id, name: newListName })) setNewListName("");
            }}
          >
            <input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="Nama kolom baru..." className={smallInputClass} />
            <button type="submit" className={`${outlineBtn} w-full`}>
              <PlusIcon className="h-3.5 w-3.5" /> Tambah kolom
            </button>
          </form>
        )}
      </div>

      <section className={cardClass}>
        <h3 className="mb-3 text-xs font-bold">Aktivitas terbaru di board ini</h3>
        {activities.length === 0 && <div className="text-[11px] text-muted">Belum ada aktivitas.</div>}
        <div className="grid gap-2 md:grid-cols-2">
          {activities.map((a) => {
            const card = a.card_id ? snapshot.cards.find((c) => c.id === a.card_id) : null;
            return (
              <div key={a.id} className="flex items-start gap-2 text-[11px]">
                <Avatar name={a.actor_name} size="sm" />
                <div className="min-w-0">
                  <span className="font-semibold">{a.actor_name}</span> <span className="text-muted">{a.action.replace(/_/g, " ")}</span>
                  {card && (
                    <button type="button" onClick={() => navigate({ cardId: card.id })} className="ml-1 cursor-pointer font-semibold text-primary hover:underline">
                      {card.title}
                    </button>
                  )}
                  <div className="text-[10px] text-subtle">{timeAgo(a.created_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <NewBoardModal open={newBoardOpen} onClose={() => setNewBoardOpen(false)} />
      {settingsOpen && <BoardSettingsModal board={board} onClose={() => setSettingsOpen(false)} />}
      {openCard && openCard.board_id === board.id && (
        <CardDetailModal key={openCard.id} card={openCard} canWrite={canWrite} onClose={() => navigate({ cardId: "" })} />
      )}
    </div>
  );
}

function CardPreview({
  card,
  draggable,
  labels,
  userName,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
}: {
  card: CardDto;
  draggable: boolean;
  labels: { id: string; name: string; color: string }[];
  userName: (id: string) => string;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  const done = card.checklist_items.filter((i) => i.is_done).length;
  const total = card.checklist_items.length;
  const status = dueStatus(card.due_at, card.completed_at);
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onClick={onOpen}
      className={`cursor-pointer rounded-card border border-line bg-floor/60 p-3 text-xs transition hover:border-primary/50 hover:bg-bg ${card.completed_at ? "opacity-75" : ""}`}
    >
      {card.label_ids.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {card.label_ids.map((lid) => {
            const l = labels.find((x) => x.id === lid);
            if (!l) return null;
            const c = labelColor(l.color);
            return (
              <span key={lid} style={{ backgroundColor: `${c}1f`, color: c }} className="rounded px-1.5 py-0.5 text-[10px] font-bold">
                {l.name}
              </span>
            );
          })}
        </div>
      )}
      <div className={`leading-snug font-semibold ${card.completed_at ? "text-muted line-through" : "text-ink"}`}>{card.title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted">
        {card.due_at && (
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${DUE_CLASS[status]}`}>
            <ClockIcon className="h-3 w-3" />
            {formatDateTime(card.due_at)}
          </span>
        )}
        {total > 0 && (
          <span className={`inline-flex items-center gap-1 ${done === total ? "font-semibold text-success" : ""}`}>
            <CheckIcon className="h-3 w-3" />
            {done}/{total}
          </span>
        )}
        {card.attachments.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <LinkIcon className="h-3 w-3" />
            {card.attachments.length}
          </span>
        )}
        {card.room_id && <ChatIcon className="h-3 w-3" />}
        {card.assignee_ids.length > 0 && (
          <span className="ml-auto flex -space-x-1.5">
            {card.assignee_ids.slice(0, 3).map((id) => (
              <span key={id} title={userName(id)}>
                <Avatar name={userName(id)} size="sm" />
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function NewBoardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snapshot, run, navigate } = useWorkspace();
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Board baru">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await run<{ id: string }>(
            "board:create",
            { workspace_id: snapshot.active_workspace_id, name, visibility: isPrivate ? "private" : "workspace" },
            "Board dibuat",
          );
          if (res) {
            setName("");
            onClose();
            navigate({ tab: "kanban", boardId: res.id });
          }
        }}
      >
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama board" className={inputClass} />
        <label className="flex items-center justify-between gap-3 text-xs">
          <span>
            <span className="font-semibold">Board privat</span>
            <span className="block text-[11px] text-muted">Hanya anggota board yang dapat melihat.</span>
          </span>
          <Toggle checked={isPrivate} onChange={setIsPrivate} />
        </label>
        <button type="submit" className={`${primaryBtn} w-full`} disabled={!name.trim()}>
          Buat board
        </button>
      </form>
    </Modal>
  );
}

function BoardSettingsModal({ board, onClose }: { board: BoardDto; onClose: () => void }) {
  const { snapshot, run, navigate } = useWorkspace();
  const [name, setName] = useState(board.name);
  return (
    <Modal open onClose={onClose} title={`Pengaturan: ${board.name}`}>
      <div className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("board:update", { board_id: board.id, name }, "Board diperbarui");
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} className={smallInputClass} />
          <button type="submit" className={outlineBtn}>
            Simpan
          </button>
        </form>
        <label className="flex items-center justify-between gap-3 text-xs">
          <span>
            <span className="font-semibold">Board privat</span>
            <span className="block text-[11px] text-muted">Jika aktif, hanya anggota board di bawah yang dapat melihat board & diskusinya.</span>
          </span>
          <Toggle
            checked={board.visibility === "private"}
            onChange={(v) => run("board:update", { board_id: board.id, visibility: v ? "private" : "workspace" })}
          />
        </label>
        <div>
          <div className="mb-2 text-xs font-bold">Anggota board</div>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {snapshot.users.map((u) => {
              const on = board.member_ids.includes(u.id);
              return (
                <div key={u.id} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <Avatar name={u.name} size="sm" online={u.online} />
                    {u.name}
                  </span>
                  <Toggle
                    checked={on}
                    disabled={u.id === board.created_by}
                    onChange={() => run("board:toggle_member", { board_id: board.id, user_id: u.id })}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          className="w-full cursor-pointer rounded-card border border-danger/30 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10"
          onClick={async () => {
            if (!window.confirm(`Arsipkan board "${board.name}"?`)) return;
            if (await run("board:delete", { board_id: board.id }, "Board diarsipkan")) {
              onClose();
              navigate({ boardId: "" });
            }
          }}
        >
          Arsipkan board
        </button>
      </div>
    </Modal>
  );
}

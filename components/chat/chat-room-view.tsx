"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  BoardIcon,
  CheckIcon,
  EditIcon,
  LinkIcon,
  LockIcon,
  PlusIcon,
  RocketIcon,
  SendIcon,
  ThumbUpIcon,
  TrashIcon,
  UnlockIcon,
  UsersIcon,
} from "@/components/icons";
import { roomTitle } from "@/components/layout/sidebar";
import {
  Avatar,
  EmptyState,
  Modal,
  Toggle,
  formatTime,
  inputClass,
  outlineBtn,
  primaryBtn,
  readFileBase64,
  smallInputClass,
  useWorkspace,
} from "@/components/ui/kit";
import type { MessageDto, RoomDto } from "@/server/ws/protocol";

const REACTIONS: { emoji: string; icon: React.ReactNode; label: string }[] = [
  { emoji: "👍", icon: <ThumbUpIcon className="h-3 w-3" />, label: "Setuju" },
  { emoji: "✅", icon: <CheckIcon className="h-3 w-3" />, label: "Beres" },
  { emoji: "🚀", icon: <RocketIcon className="h-3 w-3" />, label: "Mantap" },
];

function reactionIcon(emoji: string) {
  return REACTIONS.find((r) => r.emoji === emoji)?.icon ?? <span className="text-[10px]">{emoji}</span>;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Hari ini";
  if (d.toDateString() === y.toDateString()) return "Kemarin";
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
}

/** Highlights @mentions of room members. */
function renderContent(text: string, names: string[]) {
  if (!names.length) return text;
  const escaped = names
    .flatMap((n) => [n, n.split(" ")[0]])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const alternatives = `${escaped.join("|")}|semua|all`;
  const splitter = new RegExp(`(@(?:${alternatives}))`, "gi");
  const whole = new RegExp(`^@(?:${alternatives})$`, "i");
  return text.split(splitter).map((part, i) =>
    whole.test(part) ? (
      <span key={i} className="rounded bg-primary-soft px-0.5 font-semibold text-primary">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export function ChatRoomView() {
  const { snapshot, nav, navigate, run } = useWorkspace();
  const me = snapshot.me;
  const activeWs = snapshot.workspaces.find((w) => w.id === snapshot.active_workspace_id);
  const isManager = activeWs?.my_role === "owner" || activeWs?.my_role === "admin";
  const room = snapshot.rooms.find((r) => r.id === nav.roomId) || snapshot.rooms[0] || null;
  const [newRoomOpen, setNewRoomOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);

  useEffect(() => {
    if (room && room.unread_count > 0) run("message:mark_read", { room_id: room.id });
  }, [room, run]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {activeWs?.my_role !== "guest" && (
          <button type="button" className={outlineBtn} onClick={() => setNewRoomOpen(true)}>
            <PlusIcon className="h-3.5 w-3.5" /> Ruang grup
          </button>
        )}
        <button type="button" className={outlineBtn} onClick={() => setDmOpen(true)}>
          <UsersIcon className="h-3.5 w-3.5" /> Pesan langsung
        </button>
      </div>

      {room ? (
        <RoomPanel key={room.id} room={room} isManager={isManager} />
      ) : (
        <EmptyState title="Belum ada ruang chat">Buat ruang grup atau kirim pesan langsung ke rekan kerja.</EmptyState>
      )}

      <NewRoomModal open={newRoomOpen} onClose={() => setNewRoomOpen(false)} />
      <Modal open={dmOpen} onClose={() => setDmOpen(false)} title="Pesan langsung">
        <div className="space-y-1.5">
          {snapshot.users
            .filter((u) => u.id !== me.id)
            .map((u) => (
              <button
                key={u.id}
                type="button"
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-card border border-line px-3 py-2 text-left text-xs hover:border-primary"
                onClick={async () => {
                  const res = await run<{ room_id: string }>("room:open_direct", { workspace_id: snapshot.active_workspace_id, user_id: u.id });
                  if (res) {
                    setDmOpen(false);
                    navigate({ roomId: res.room_id });
                  }
                }}
              >
                <Avatar name={u.name} online={u.online} />
                <span>
                  <span className="block font-semibold">{u.name}</span>
                  <span className="text-[11px] text-muted">{u.email}</span>
                </span>
              </button>
            ))}
        </div>
      </Modal>
    </div>
  );
}

function RoomPanel({ room, isManager }: { room: RoomDto; isManager: boolean }) {
  const { snapshot, run, navigate } = useWorkspace();
  const me = snapshot.me;
  const messages = useMemo(() => snapshot.messages.filter((m) => m.room_id === room.id), [snapshot.messages, room.id]);
  const members = snapshot.users.filter((u) => room.member_ids.includes(u.id));
  const memberNames = members.map((m) => m.name);
  const isRoomAdmin = room.my_role === "admin" || isManager;
  const canSend = !room.only_admins_can_send || isRoomAdmin;
  const title = roomTitle(room, snapshot.users, me.id);
  const board = room.board_id ? snapshot.boards.find((b) => b.id === room.board_id) : null;
  const cardOfRoom = room.card_id ? snapshot.cards.find((c) => c.id === room.card_id) : null;
  const muted = room.muted_until && new Date(room.muted_until) > new Date();

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [cardRef, setCardRef] = useState<string>(cardOfRoom?.id || "");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [toCard, setToCard] = useState<MessageDto | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const mentionQuery = /(^|\s)@([\w.]*)$/.exec(draft)?.[2];
  const suggestions =
    mentionQuery !== undefined
      ? [
          ...members.filter((m) => m.id !== me.id && m.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 5),
        ]
      : [];

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    const res = await run("message:send", { room_id: room.id, content, reply_to_id: replyTo?.id, card_id: cardRef || undefined });
    setSending(false);
    if (res) {
      setDraft("");
      setReplyTo(null);
      if (!cardOfRoom) setCardRef("");
      textRef.current?.focus();
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const data = await readFileBase64(file);
    await run("attachment:upload", { room_id: room.id, file_name: file.name, mime_type: file.type, data_base64: data, content: draft.trim() || undefined });
    setDraft("");
  };

  const tick = (m: MessageDto) => {
    if (m.sender_id !== me.id || m.deleted_at) return null;
    const others = room.member_ids.filter((id) => id !== me.id);
    const readAll = others.length > 0 && others.every((id) => m.read_by.includes(id));
    const delivered = m.delivered_to.length > 0;
    return (
      <span
        title={readAll ? "Dibaca semua" : m.read_by.length ? `Dibaca ${m.read_by.length} orang` : delivered ? "Terkirim" : "Dikirim"}
        className={`inline-flex ${readAll ? "text-primary" : "text-subtle"}`}
      >
        <CheckIcon className="h-3 w-3" />
        {(delivered || m.read_by.length > 0) && <CheckIcon className="-ml-1.5 h-3 w-3" />}
      </span>
    );
  };

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[420px] flex-col overflow-hidden rounded-card border border-line bg-bg shadow-soft">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold">
            {room.type === "direct" ? <Avatar name={title} size="sm" online={members.find((m) => m.id !== me.id)?.online} /> : <span className="text-muted">#</span>}
            <span className="truncate">{title}</span>
            {room.only_admins_can_send && <LockIcon className="h-3.5 w-3.5 text-danger" />}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <button type="button" onClick={() => setMembersOpen(true)} className="cursor-pointer hover:text-primary">
              {members.length} anggota · {members.filter((m) => m.online).length} online
            </button>
            {board && (
              <button type="button" onClick={() => navigate({ tab: "kanban", boardId: board.id })} className="inline-flex cursor-pointer items-center gap-1 text-primary hover:underline">
                <BoardIcon className="h-3 w-3" /> {board.name}
              </button>
            )}
            {cardOfRoom && (
              <button type="button" onClick={() => navigate({ tab: "kanban", boardId: cardOfRoom.board_id, cardId: cardOfRoom.id })} className="inline-flex cursor-pointer items-center gap-1 text-primary hover:underline">
                <LinkIcon className="h-3 w-3" /> {cardOfRoom.title}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={muted ? "muted" : ""}
            onChange={(e) => run("room:mute", { room_id: room.id, minutes: e.target.value === "" ? 0 : Number(e.target.value) })}
            className="h-8 cursor-pointer rounded-lg border border-line bg-bg px-2 text-[11px]"
            title="Bisukan email & notifikasi chat ruang ini"
          >
            <option value="">{muted ? "Aktifkan notifikasi" : "Notifikasi aktif"}</option>
            {muted && <option value="muted">Dibisukan</option>}
            <option value="60">Bisukan 1 jam</option>
            <option value="480">Bisukan 8 jam</option>
            <option value="10080">Bisukan 1 minggu</option>
          </select>
          {isRoomAdmin && room.type !== "direct" && (
            <button
              type="button"
              className={outlineBtn}
              title="Hanya admin yang boleh mengirim pesan"
              onClick={() => run("admin:toggle_room_permission", { room_id: room.id, only_admins_can_send: !room.only_admins_can_send })}
            >
              {room.only_admins_can_send ? <LockIcon className="h-3.5 w-3.5" /> : <UnlockIcon className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{room.only_admins_can_send ? "Hanya admin" : "Semua bisa kirim"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <div className="py-10 text-center text-xs text-muted">Belum ada pesan. Mulai percakapan!</div>}
        {messages.map((m, idx) => {
          const day = dayLabel(m.created_at);
          const showDay = idx === 0 || dayLabel(messages[idx - 1].created_at) !== day;
          const own = m.sender_id === me.id;
          const reply = m.reply_to_id ? snapshot.messages.find((x) => x.id === m.reply_to_id) : null;
          const mentioned = m.mention_ids.includes(me.id);
          return (
            <Fragment key={m.id}>
              {showDay && (
                <div className="my-3 flex items-center gap-3 text-[10px] font-semibold text-muted">
                  <div className="h-px flex-1 bg-line" /> {day} <div className="h-px flex-1 bg-line" />
                </div>
              )}
              {m.type === "task_event" || m.type === "system" ? (
                <div className="my-1.5 flex justify-center">
                  <button
                    type="button"
                    disabled={!m.card_id}
                    onClick={() => {
                      const c = snapshot.cards.find((x) => x.id === m.card_id);
                      if (c) navigate({ tab: "kanban", boardId: c.board_id, cardId: c.id });
                    }}
                    className="max-w-[90%] rounded-full border border-line bg-floor px-3 py-1 text-center text-[11px] text-muted enabled:cursor-pointer enabled:hover:border-primary"
                  >
                    {m.type === "task_event" && <BoardIcon className="mr-1 inline h-3 w-3 text-primary" />}
                    {m.content} · {formatTime(m.created_at)}
                  </button>
                </div>
              ) : (
                <div className={`group flex gap-2.5 py-1 ${own ? "flex-row-reverse" : ""}`}>
                  <Avatar name={m.sender_name || "?"} size="sm" />
                  <div className={`max-w-[78%] min-w-0 ${own ? "items-end text-right" : ""} flex flex-col`}>
                    <div className="text-[10px] text-muted">
                      <span className="font-semibold text-ink">{own ? "Anda" : m.sender_name}</span> · {formatTime(m.created_at)}
                      {m.edited_at && !m.deleted_at && " · diedit"}
                    </div>
                    <div
                      className={`mt-0.5 rounded-card px-3 py-2 text-left text-xs leading-relaxed whitespace-pre-wrap ${
                        m.deleted_at
                          ? "border border-dashed border-line text-muted italic"
                          : own
                            ? "bg-primary text-on-primary"
                            : mentioned
                              ? "border border-primary/30 bg-primary-soft/50 text-ink"
                              : "bg-floor text-ink"
                      }`}
                    >
                      {reply && (
                        <div className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 text-[11px] ${own ? "border-on-primary/60 bg-on-primary/15" : "border-primary bg-bg"}`}>
                          <span className="font-semibold">{reply.sender_name}</span>: <span className="line-clamp-2">{reply.content}</span>
                        </div>
                      )}
                      {editing?.id === m.id ? (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (await run("message:update", { message_id: m.id, content: editing.text })) setEditing(null);
                          }}
                          className="space-y-1"
                        >
                          <textarea value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} rows={2} className="w-full rounded border border-line bg-bg p-1.5 text-xs text-ink" />
                          <div className="flex justify-end gap-1">
                            <button type="button" onClick={() => setEditing(null)} className="cursor-pointer rounded px-2 py-0.5 text-[10px] underline">
                              Batal
                            </button>
                            <button type="submit" className="cursor-pointer rounded bg-bg px-2 py-0.5 text-[10px] font-semibold text-primary">
                              Simpan
                            </button>
                          </div>
                        </form>
                      ) : (
                        renderContent(m.content || "", memberNames)
                      )}
                      {m.attachments.map((a) =>
                        a.mime_type.startsWith("image/") ? (
                          <a key={a.id} href={a.file_url} target="_blank" rel="noreferrer" className="mt-1.5 block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.file_url} alt={a.file_name} className="max-h-56 rounded-lg" />
                          </a>
                        ) : (
                          <a key={a.id} href={a.file_url} target="_blank" rel="noreferrer" className="mt-1.5 flex items-center gap-1.5 font-semibold underline">
                            <LinkIcon className="h-3 w-3" /> {a.file_name}
                          </a>
                        ),
                      )}
                      {m.card_id && m.card_title && (
                        <button
                          type="button"
                          onClick={() => {
                            const c = snapshot.cards.find((x) => x.id === m.card_id);
                            if (c) navigate({ tab: "kanban", boardId: c.board_id, cardId: c.id });
                          }}
                          className={`mt-1.5 flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold ${own ? "bg-on-primary/15" : "bg-bg text-primary"}`}
                        >
                          <BoardIcon className="h-3 w-3" /> {m.card_title}
                        </button>
                      )}
                    </div>
                    <div className={`mt-0.5 flex flex-wrap items-center gap-1 ${own ? "justify-end" : ""}`}>
                      {Object.entries(
                        m.reactions.reduce<Record<string, string[]>>((acc, r) => {
                          (acc[r.emoji] ||= []).push(r.user_id);
                          return acc;
                        }, {}),
                      ).map(([emoji, users]) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => run("message:react", { message_id: m.id, emoji })}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${users.includes(me.id) ? "border-primary bg-primary-soft text-primary" : "border-line text-muted"}`}
                        >
                          {reactionIcon(emoji)} {users.length}
                        </button>
                      ))}
                      {tick(m)}
                      {!m.deleted_at && (
                        <span className="hidden items-center gap-1.5 text-muted group-hover:inline-flex">
                          {REACTIONS.map((r) => (
                            <button key={r.emoji} type="button" title={r.label} onClick={() => run("message:react", { message_id: m.id, emoji: r.emoji })} className="cursor-pointer hover:text-primary">
                              {r.icon}
                            </button>
                          ))}
                          <button type="button" onClick={() => setReplyTo(m)} className="cursor-pointer text-[10px] hover:text-primary">
                            Balas
                          </button>
                          {activeRoleCanWrite(snapshot) && (
                            <button type="button" onClick={() => setToCard(m)} className="cursor-pointer text-[10px] hover:text-primary">
                              Jadikan card
                            </button>
                          )}
                          {own && m.type === "text" && (
                            <button type="button" title="Edit" onClick={() => setEditing({ id: m.id, text: m.content || "" })} className="cursor-pointer hover:text-primary">
                              <EditIcon className="h-3 w-3" />
                            </button>
                          )}
                          {(own || isRoomAdmin) && (
                            <button type="button" title="Hapus" onClick={() => window.confirm("Hapus pesan ini untuk semua orang?") && run("message:delete", { message_id: m.id })} className="cursor-pointer hover:text-danger">
                              <TrashIcon className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-line p-3">
        {!canSend ? (
          <div className="rounded-card bg-floor p-3 text-center text-xs text-muted">
            <LockIcon className="mr-1 inline h-3.5 w-3.5" /> Hanya admin yang dapat mengirim pesan di ruang ini.
          </div>
        ) : (
          <div className="space-y-2">
            {replyTo && (
              <div className="flex items-center justify-between rounded-lg border-l-2 border-primary bg-primary-soft/40 px-3 py-1.5 text-[11px]">
                <span className="truncate">
                  Membalas <strong>{replyTo.sender_name}</strong>: {replyTo.content}
                </span>
                <button type="button" onClick={() => setReplyTo(null)} className="cursor-pointer text-muted hover:text-ink">
                  Batal
                </button>
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setDraft((d) => d.replace(/@([\w.]*)$/, `@${u.name} `))}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] hover:border-primary"
                  >
                    <Avatar name={u.name} size="sm" /> {u.name}
                  </button>
                ))}
                <button type="button" onClick={() => setDraft((d) => d.replace(/@([\w.]*)$/, "@semua "))} className="cursor-pointer rounded-full border border-line px-2 py-0.5 text-[11px] hover:border-primary">
                  @semua
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-card border border-line text-muted hover:border-primary hover:text-primary" title="Kirim file / gambar">
                <PlusIcon className="h-4 w-4" />
                <input type="file" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
              </label>
              <textarea
                ref={textRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Tulis pesan... (@ untuk tag, Shift+Enter baris baru)"
                className="max-h-32 min-h-9 flex-1 resize-y rounded-card border border-line bg-floor px-3 py-2 text-xs focus:border-primary focus:bg-bg focus:outline-none"
              />
              <button type="button" onClick={send} disabled={!draft.trim() || sending} className={`${primaryBtn} h-9`}>
                <SendIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span>Rujuk card:</span>
              <select value={cardRef} onChange={(e) => setCardRef(e.target.value)} className="h-6 max-w-64 rounded border border-line bg-bg px-1 text-[11px]">
                <option value="">Tidak ada</option>
                {snapshot.cards
                  .filter((c) => !room.board_id || c.board_id === room.board_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <Modal open={membersOpen} onClose={() => setMembersOpen(false)} title={`Anggota ${title}`}>
        <RoomMembers room={room} canAdd={isRoomAdmin && (room.type === "group" || room.type === "card")} onLeft={() => setMembersOpen(false)} />
      </Modal>
      {toCard && <MessageToCardModal message={toCard} defaultBoardId={room.board_id} onClose={() => setToCard(null)} />}
    </div>
  );
}

function activeRoleCanWrite(snapshot: ReturnType<typeof useWorkspace>["snapshot"]) {
  const ws = snapshot.workspaces.find((w) => w.id === snapshot.active_workspace_id);
  return ws?.my_role !== "guest" && snapshot.boards.length > 0;
}

function RoomMembers({ room, canAdd, onLeft }: { room: RoomDto; canAdd: boolean; onLeft: () => void }) {
  const { snapshot, run, navigate } = useWorkspace();
  const [pick, setPick] = useState<string[]>([]);
  const members = snapshot.users.filter((u) => room.member_ids.includes(u.id));
  const others = snapshot.users.filter((u) => !room.member_ids.includes(u.id));
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        {members.map((u) => (
          <div key={u.id} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2">
              <Avatar name={u.name} online={u.online} size="sm" /> {u.name}
            </span>
            {room.admin_ids.includes(u.id) && <span className="text-[10px] font-semibold text-primary">Admin ruang</span>}
          </div>
        ))}
      </div>
      {canAdd && others.length > 0 && (
        <div className="space-y-2 border-t border-line pt-3">
          <div className="text-xs font-bold">Tambah anggota</div>
          {others.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" checked={pick.includes(u.id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))} />
              {u.name}
            </label>
          ))}
          <button type="button" disabled={!pick.length} className={primaryBtn} onClick={async () => (await run("room:add_members", { room_id: room.id, member_ids: pick }, "Anggota ditambahkan")) && setPick([])}>
            Tambahkan
          </button>
        </div>
      )}
      {(room.type === "group" || room.type === "card") && (
        <button
          type="button"
          className="w-full cursor-pointer rounded-card border border-danger/30 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10"
          onClick={async () => {
            if (!window.confirm("Keluar dari ruang chat ini?")) return;
            if (await run("room:leave", { room_id: room.id })) {
              onLeft();
              navigate({ roomId: "" });
            }
          }}
        >
          Keluar dari ruang
        </button>
      )}
    </div>
  );
}

function NewRoomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snapshot, run, navigate } = useWorkspace();
  const [name, setName] = useState("");
  const [pick, setPick] = useState<string[]>([]);
  const others = snapshot.users.filter((u) => u.id !== snapshot.me.id);
  return (
    <Modal open={open} onClose={onClose} title="Ruang grup baru">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await run<{ id: string }>("room:create", { workspace_id: snapshot.active_workspace_id, name, member_ids: pick }, "Ruang chat dibuat");
          if (res) {
            setName("");
            setPick([]);
            onClose();
            navigate({ tab: "chat", roomId: res.id });
          }
        }}
      >
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama ruang, mis. Tim Gudang" className={inputClass} />
        <div className="flex items-center justify-between text-xs font-bold">
          Anggota
          <label className="flex items-center gap-2 text-[11px] font-normal text-muted">
            Pilih semua <Toggle checked={pick.length === others.length && others.length > 0} onChange={(v) => setPick(v ? others.map((u) => u.id) : [])} />
          </label>
        </div>
        <div className="max-h-56 space-y-1.5 overflow-y-auto">
          {others.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" checked={pick.includes(u.id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))} />
              <Avatar name={u.name} size="sm" /> {u.name}
            </label>
          ))}
        </div>
        <button type="submit" disabled={!name.trim()} className={`${primaryBtn} w-full`}>
          Buat ruang
        </button>
      </form>
    </Modal>
  );
}

function MessageToCardModal({ message, defaultBoardId, onClose }: { message: MessageDto; defaultBoardId: string | null; onClose: () => void }) {
  const { snapshot, run, navigate } = useWorkspace();
  const [boardId, setBoardId] = useState(defaultBoardId || snapshot.boards[0]?.id || "");
  const lists = snapshot.lists.filter((l) => l.board_id === boardId);
  const [listId, setListId] = useState("");
  const [title, setTitle] = useState((message.content || "").slice(0, 120));
  const effectiveList = lists.find((l) => l.id === listId)?.id || lists[0]?.id || "";
  return (
    <Modal open onClose={onClose} title="Jadikan pesan sebagai card">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await run<{ id: string }>("card:from_message", { message_id: message.id, list_id: effectiveList, title }, "Card dibuat dari pesan");
          if (res) {
            onClose();
            navigate({ tab: "kanban", boardId, cardId: res.id });
          }
        }}
      >
        <blockquote className="rounded-lg border-l-2 border-primary bg-floor px-3 py-2 text-xs text-muted">{message.content}</blockquote>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul card" className={inputClass} />
        <div className="grid grid-cols-2 gap-2">
          <select value={boardId} onChange={(e) => setBoardId(e.target.value)} className={smallInputClass}>
            {snapshot.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select value={effectiveList} onChange={(e) => setListId(e.target.value)} className={smallInputClass}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-muted">Pengirim pesan otomatis ditugaskan pada card baru.</p>
        <button type="submit" disabled={!effectiveList} className={`${primaryBtn} w-full`}>
          Buat card
        </button>
      </form>
    </Modal>
  );
}

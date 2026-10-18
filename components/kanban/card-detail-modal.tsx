"use client";

import { useState } from "react";
import { ChatIcon, CheckIcon, ClockIcon, LinkIcon, PlusIcon, TrashIcon } from "@/components/icons";
import {
  Avatar,
  DUE_CLASS,
  Modal,
  dueStatus,
  formatDateTime,
  fromLocalInput,
  labelColor,
  outlineBtn,
  primaryBtn,
  readFileBase64,
  smallInputClass,
  timeAgo,
  toLocalInput,
  useWorkspace,
} from "@/components/ui/kit";
import type { CardDto } from "@/server/ws/protocol";

const LABEL_COLORS = ["#e5534b", "#f5b800", "#2fa36b", "#3b63d6", "#8b5cf6", "#6b7488"];

export function CardDetailModal({
  card,
  canWrite,
  onClose,
}: {
  card: CardDto;
  canWrite: boolean;
  onClose: () => void;
}) {
  const { snapshot, run, navigate } = useWorkspace();
  const board = snapshot.boards.find((b) => b.id === card.board_id);
  const lists = snapshot.lists.filter((l) => l.board_id === card.board_id);
  const labels = snapshot.labels.filter((l) => l.board_id === card.board_id);
  const candidates = snapshot.users.filter(
    (u) => board?.visibility !== "private" || board.member_ids.includes(u.id),
  );
  const activities = snapshot.activities.filter((a) => a.card_id === card.id).slice(0, 15);
  const sourceMessage = card.source_message_id
    ? snapshot.messages.find((m) => m.id === card.source_message_id)
    : null;

  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || "");
  const [newChecklist, setNewChecklist] = useState("");
  const [itemDraft, setItemDraft] = useState<Record<string, string>>({});
  const [labelName, setLabelName] = useState("");
  const [labelColorPick, setLabelColorPick] = useState(LABEL_COLORS[0]);
  const [uploading, setUploading] = useState(false);
  const status = dueStatus(card.due_at, card.completed_at);
  const ro = !canWrite;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const data = await readFileBase64(file);
      await run("attachment:upload", { card_id: card.id, file_name: file.name, mime_type: file.type, data_base64: data }, "Lampiran diunggah");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open wide onClose={onClose} title={<span className="truncate">{card.title}</span>}>
      <div className="grid gap-5 md:grid-cols-3">
        <div className="space-y-5 md:col-span-2">
          <div className="space-y-2">
            <input
              value={title}
              disabled={ro}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== card.title && run("card:update", { card_id: card.id, title })}
              className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-base font-bold text-ink hover:border-line focus:border-primary focus:outline-none"
            />
            <textarea
              value={description}
              disabled={ro}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => description !== (card.description || "") && run("card:update", { card_id: card.id, description })}
              rows={4}
              placeholder="Tambahkan deskripsi tugas..."
              className="w-full rounded-card border border-line bg-floor p-3 text-xs text-ink placeholder:text-muted focus:border-primary focus:bg-bg focus:outline-none"
            />
            {sourceMessage && (
              <div className="rounded-card border border-line bg-primary-soft/30 p-3 text-[11px] text-ink-soft">
                <div className="mb-1 flex items-center gap-1 font-semibold text-primary">
                  <LinkIcon className="h-3 w-3" /> Dibuat dari pesan {sourceMessage.sender_name}
                </div>
                <p className="line-clamp-3">{sourceMessage.content}</p>
                <button type="button" onClick={() => navigate({ tab: "chat", roomId: sourceMessage.room_id })} className="mt-1 cursor-pointer font-semibold text-primary hover:underline">
                  Lihat di chat
                </button>
              </div>
            )}
          </div>

          {/* Checklists */}
          <div className="space-y-3">
            {card.checklists.map((ch) => {
              const done = ch.items.filter((i) => i.is_done).length;
              const pct = ch.items.length ? Math.round((done / ch.items.length) * 100) : 0;
              return (
                <div key={ch.id} className="space-y-2 rounded-card border border-line p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <CheckIcon className="h-3.5 w-3.5 text-primary" />
                      {ch.title}
                      <span className="text-[10px] font-semibold text-muted">
                        {done}/{ch.items.length}
                      </span>
                    </div>
                    {!ro && (
                      <button type="button" onClick={() => run("checklist:delete", { checklist_id: ch.id })} className="cursor-pointer text-[11px] text-muted hover:text-danger">
                        Hapus
                      </button>
                    )}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-floor">
                    <div className="h-full bg-success transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  {ch.items.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={item.is_done}
                        disabled={ro}
                        onChange={() => run("checklist:toggle_item", { item_id: item.id })}
                        className="h-3.5 w-3.5 cursor-pointer accent-[#3b63d6]"
                      />
                      <span className={`flex-1 ${item.is_done ? "text-muted line-through" : ""}`}>{item.content}</span>
                      <select
                        value={item.assignee_id || ""}
                        disabled={ro}
                        onChange={(e) => run("checklist:update_item", { item_id: item.id, assignee_id: e.target.value || null })}
                        className="h-6 rounded border border-line bg-bg px-1 text-[10px]"
                      >
                        <option value="">Tanpa PIC</option>
                        {candidates.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="datetime-local"
                        value={toLocalInput(item.due_at)}
                        disabled={ro}
                        onChange={(e) => run("checklist:update_item", { item_id: item.id, due_at: fromLocalInput(e.target.value) })}
                        className="h-6 rounded border border-line bg-bg px-1 text-[10px]"
                      />
                      {!ro && (
                        <button type="button" onClick={() => run("checklist:delete_item", { item_id: item.id })} className="cursor-pointer text-muted hover:text-danger">
                          <TrashIcon className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  {!ro && (
                    <form
                      className="flex gap-1.5"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const content = itemDraft[ch.id]?.trim();
                        if (!content) return;
                        if (await run("checklist:add_item", { checklist_id: ch.id, content })) setItemDraft((p) => ({ ...p, [ch.id]: "" }));
                      }}
                    >
                      <input value={itemDraft[ch.id] || ""} onChange={(e) => setItemDraft((p) => ({ ...p, [ch.id]: e.target.value }))} placeholder="Tambah item..." className={smallInputClass} />
                      <button type="submit" className={outlineBtn}>
                        <PlusIcon className="h-3 w-3" />
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
            {!ro && (
              <form
                className="flex gap-1.5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await run("checklist:create", { card_id: card.id, title: newChecklist || "Checklist" })) setNewChecklist("");
                }}
              >
                <input value={newChecklist} onChange={(e) => setNewChecklist(e.target.value)} placeholder="Judul checklist baru" className={smallInputClass} />
                <button type="submit" className={outlineBtn}>
                  <PlusIcon className="h-3 w-3" /> Checklist
                </button>
              </form>
            )}
          </div>

          {/* Attachments */}
          <div className="space-y-2">
            <div className="text-xs font-bold">Lampiran</div>
            {card.attachments.length === 0 && <div className="text-[11px] text-muted">Belum ada lampiran.</div>}
            {card.attachments.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs">
                <a href={a.file_url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 font-semibold text-primary hover:underline">
                  {a.mime_type.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.file_url} alt="" className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <LinkIcon className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate">{a.file_name}</span>
                </a>
                <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted">
                  {(a.size_bytes / 1024).toFixed(0)} KB
                  {!ro && (
                    <button type="button" onClick={() => run("attachment:delete", { attachment_id: a.id })} className="cursor-pointer hover:text-danger">
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  )}
                </span>
              </div>
            ))}
            {!ro && (
              <label className={`${outlineBtn} w-fit`}>
                <PlusIcon className="h-3 w-3" />
                {uploading ? "Mengunggah..." : "Unggah file (maks 8 MB)"}
                <input type="file" className="hidden" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
              </label>
            )}
          </div>

          {/* Activity */}
          <div className="space-y-2">
            <div className="text-xs font-bold">Aktivitas</div>
            {activities.length === 0 && <div className="text-[11px] text-muted">Belum ada aktivitas.</div>}
            {activities.map((a) => (
              <div key={a.id} className="flex items-start gap-2 text-[11px]">
                <Avatar name={a.actor_name} size="sm" />
                <div>
                  <span className="font-semibold">{a.actor_name}</span>{" "}
                  <span className="text-muted">{a.action.replace(/_/g, " ")}</span>
                  <div className="text-[10px] text-subtle">{timeAgo(a.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold tracking-wider text-muted uppercase">Kolom</div>
            <select
              value={card.list_id}
              disabled={ro}
              onChange={(e) => run("card:move", { card_id: card.id, target_list_id: e.target.value })}
              className={smallInputClass}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] font-bold tracking-wider text-muted uppercase">Deadline</div>
            <input
              type="datetime-local"
              value={toLocalInput(card.due_at)}
              disabled={ro}
              onChange={(e) => run("card:update", { card_id: card.id, due_at: fromLocalInput(e.target.value) })}
              className={smallInputClass}
            />
            {card.due_at && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${DUE_CLASS[status]}`}>
                <ClockIcon className="h-3 w-3" /> {formatDateTime(card.due_at)}
              </span>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={Boolean(card.completed_at)}
                disabled={ro}
                onChange={(e) => run("card:update", { card_id: card.id, completed: e.target.checked })}
                className="accent-[#2fa36b]"
              />
              Tandai selesai
            </label>
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] font-bold tracking-wider text-muted uppercase">Ditugaskan ke</div>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((u) => {
                const on = card.assignee_ids.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    disabled={ro}
                    onClick={() => run("card:toggle_assignee", { card_id: card.id, user_id: u.id })}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] disabled:cursor-default ${
                      on ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line text-muted hover:border-primary"
                    }`}
                  >
                    <Avatar name={u.name} size="sm" />
                    {u.name.split(" ")[0]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] font-bold tracking-wider text-muted uppercase">Label</div>
            <div className="flex flex-wrap gap-1.5">
              {labels.map((l) => {
                const on = card.label_ids.includes(l.id);
                const c = labelColor(l.color);
                return (
                  <button
                    key={l.id}
                    type="button"
                    disabled={ro}
                    onClick={() => run("card:toggle_label", { card_id: card.id, label_id: l.id })}
                    style={on ? { backgroundColor: c, borderColor: c, color: "#fff" } : { borderColor: `${c}66`, color: c }}
                    className="cursor-pointer rounded-full border px-2 py-0.5 text-[10px] font-bold disabled:cursor-default"
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
            {!ro && (
              <form
                className="flex items-center gap-1"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!labelName.trim()) return;
                  if (await run("label:create", { board_id: card.board_id, name: labelName, color: labelColorPick })) setLabelName("");
                }}
              >
                <input value={labelName} onChange={(e) => setLabelName(e.target.value)} placeholder="Label baru" className={`${smallInputClass} h-7`} />
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setLabelColorPick(c)}
                    style={{ backgroundColor: c }}
                    className={`h-4 w-4 shrink-0 cursor-pointer rounded-full ${labelColorPick === c ? "ring-2 ring-ink ring-offset-1" : ""}`}
                  />
                ))}
              </form>
            )}
          </div>

          <div className="space-y-2 border-t border-line pt-3">
            <button
              type="button"
              className={`${primaryBtn} w-full`}
              onClick={async () => {
                const res = await run<{ room_id: string }>("card:open_room", { card_id: card.id });
                if (res) navigate({ tab: "chat", roomId: res.room_id, cardId: "" });
              }}
            >
              <ChatIcon className="h-3.5 w-3.5" /> {card.room_id ? "Buka thread diskusi" : "Mulai thread diskusi"}
            </button>
            {!ro && (
              <button
                type="button"
                className="w-full cursor-pointer rounded-card border border-danger/30 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10"
                onClick={async () => {
                  if (await run("card:delete", { card_id: card.id }, "Card diarsipkan")) onClose();
                }}
              >
                Arsipkan card
              </button>
            )}
            <div className="text-[10px] text-muted">Dibuat {formatDateTime(card.created_at)}</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

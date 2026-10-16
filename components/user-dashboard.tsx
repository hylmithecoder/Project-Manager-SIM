"use client";

import { useMemo, useState } from "react";
import {
  BoardIcon,
  ChatIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  LinkIcon,
  LockIcon,
  PlusIcon,
  SendIcon,
  UserIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import type {
  WorkspaceSnapshot,
  WsAction,
} from "@/server/ws/protocol";

interface UserDashboardProps {
  snapshot: WorkspaceSnapshot;
  currentUserId: string;
  sendWsAction: (action: WsAction, payload?: Record<string, unknown>) => void;
}

export function UserDashboard({
  snapshot,
  currentUserId,
  sendWsAction,
}: UserDashboardProps) {
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [chatMessage, setChatMessage] = useState("");
  const [referCardId, setReferCardId] = useState("");
  const [newChecklistText, setNewChecklistText] = useState<
    Record<string, string>
  >({});

  const currentUser = useMemo(
    () =>
      snapshot.users.find((u) => u.id === currentUserId) ||
      snapshot.users[0] || {
        id: currentUserId,
        name: "Pengguna",
        email: "",
      },
    [snapshot, currentUserId],
  );

  const myMemberInfo = useMemo(
    () =>
      snapshot.workspace_members?.find((m) => m.user_id === currentUserId) || {
        role: "member",
      },
    [snapshot, currentUserId],
  );

  const isUserAdmin =
    myMemberInfo.role === "admin" || myMemberInfo.role === "owner";

  // Filter cards assigned to current user
  const myAssignedCards = useMemo(
    () =>
      snapshot.cards.filter(
        (c) =>
          c.assignee_ids.includes(currentUserId) ||
          c.created_by === currentUserId,
      ),
    [snapshot, currentUserId],
  );

  const completedCardsCount = useMemo(
    () => myAssignedCards.filter((c) => Boolean(c.completed_at)).length,
    [myAssignedCards],
  );

  const totalChecklistItems = useMemo(
    () =>
      myAssignedCards.reduce((acc, c) => acc + c.checklist_items.length, 0),
    [myAssignedCards],
  );

  const completedChecklistItems = useMemo(
    () =>
      myAssignedCards.reduce(
        (acc, c) => acc + c.checklist_items.filter((i) => i.is_done).length,
        0,
      ),
    [myAssignedCards],
  );

  const myNotifications = useMemo(
    () =>
      snapshot.notifications.filter((n) => n.user_id === currentUserId),
    [snapshot, currentUserId],
  );

  const activeRoom = useMemo(
    () =>
      snapshot.rooms.find((r) => r.id === selectedRoomId) ||
      snapshot.rooms[0] ||
      null,
    [snapshot, selectedRoomId],
  );

  const activeRoomMessages = useMemo(
    () =>
      activeRoom
        ? snapshot.messages.filter((m) => m.room_id === activeRoom.id)
        : [],
    [snapshot, activeRoom],
  );

  const isRoomLockedForUser = Boolean(
    activeRoom?.only_admins_can_send && !isUserAdmin,
  );

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || !activeRoom || isRoomLockedForUser) return;

    sendWsAction("message:send", {
      room_id: activeRoom.id,
      content: chatMessage.trim(),
      card_id: referCardId || null,
    });

    setChatMessage("");
    setReferCardId("");
  };

  const listMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of snapshot.lists) {
      map.set(l.id, l.name);
    }
    return map;
  }, [snapshot]);

  return (
    <div className="space-y-6">
      {/* Sapaan & Profil Singkat User */}
      <section className="rounded-card border border-line bg-bg p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-btn bg-primary-soft text-primary">
              <UserIcon className="h-6 w-6" />
            </div>
            <div>
              <span className="text-[12px] font-bold uppercase tracking-widest text-accent-text">
                Dashboard Personal Anggota
              </span>
              <h2 className="text-2xl font-extrabold text-ink">
                Selamat Datang, {currentUser.name}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-btn bg-floor/60 px-3.5 py-2">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-xs font-semibold text-ink">
              Peran:{" "}
              {myMemberInfo.role === "admin"
                ? "Admin"
                : myMemberInfo.role === "owner"
                  ? "Owner"
                  : "User Biasa (Member)"}
            </span>
          </div>
        </div>

        {/* 3 Kartu Metrik Tugas Saya */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-card border border-line bg-floor/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-subtle">
                Tugas Ditugaskan
              </span>
              <BoardIcon className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-ink">
              {myAssignedCards.length} Card
            </p>
            <p className="mt-1 text-[11px] text-muted">
              {completedCardsCount} card telah diselesaikan
            </p>
          </div>

          <div className="rounded-card border border-line bg-floor/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-subtle">
                Progress Checklist
              </span>
              <CheckCircleIcon className="h-4 w-4 text-success" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-ink">
              {completedChecklistItems} / {totalChecklistItems}
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Item checklist selesai dikerjakan
            </p>
          </div>

          <div className="rounded-card border border-line bg-floor/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-subtle">
                Pemberitahuan Baru
              </span>
              <ClockIcon className="h-4 w-4 text-accent-text" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-ink">
              {myNotifications.length} Notifikasi
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Penugasan card &amp; mention chat
            </p>
          </div>
        </div>
      </section>

      {/* Grid: Kiri = Tugas Saya, Kanan = Ruang Diskusi Terintegrasi */}
      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        {/* Kolom Kiri: Tugas Saya */}
        <section className="space-y-4">
          <div className="rounded-card border border-line bg-bg p-5 shadow-soft">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <BoardIcon className="h-4 w-4 text-primary" />
                <h3 className="text-base font-extrabold text-ink">
                  Daftar Tugas Saya
                </h3>
              </div>
              <span className="text-xs font-semibold text-subtle">
                {myAssignedCards.length} Ditugaskan
              </span>
            </div>

            {myAssignedCards.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm font-semibold text-muted">
                  Belum ada card tugas yang ditugaskan kepada Anda.
                </p>
                <p className="mt-1 text-xs text-subtle">
                  Tugas yang ditugaskan oleh Admin akan muncul di sini.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {myAssignedCards.map((card) => {
                  const doneCount = card.checklist_items.filter(
                    (i) => i.is_done,
                  ).length;
                  const currentListName =
                    listMap.get(card.list_id) || "Kolom";

                  return (
                    <article
                      key={card.id}
                      className="rounded-card border border-line bg-floor/20 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent-text">
                          Kolom: {currentListName}
                        </span>

                        <div className="flex items-center gap-1.5">
                          {card.source_message_id && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-floor px-2 py-0.5 text-[10px] font-semibold text-ink-soft">
                              <LinkIcon className="h-3 w-3" /> Dari Pesan Chat
                            </span>
                          )}
                          {card.completed_at && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-success">
                              <CheckIcon className="h-3 w-3" /> Selesai
                            </span>
                          )}
                        </div>
                      </div>

                      <h4 className="mt-2 text-sm font-bold text-ink">
                        {card.title}
                      </h4>
                      {card.description && (
                        <p className="mt-1 text-xs leading-relaxed text-muted">
                          {card.description}
                        </p>
                      )}

                      {/* Checklist Item */}
                      <div className="mt-3 border-t border-line/60 pt-2.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-subtle">
                          <span>
                            Checklist ({doneCount}/
                            {card.checklist_items.length})
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              sendWsAction("card:update", {
                                card_id: card.id,
                                completed: !card.completed_at,
                              })
                            }
                            className="text-accent-text hover:underline"
                          >
                            {card.completed_at
                              ? "Tandai Belum Selesai"
                              : "Tandai Selesai"}
                          </button>
                        </div>

                        <ul className="mt-2 space-y-1">
                          {card.checklist_items.map((item) => (
                            <li
                              key={item.id}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <label className="flex cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={item.is_done}
                                  onChange={() =>
                                    sendWsAction("checklist:toggle_item", {
                                      item_id: item.id,
                                    })
                                  }
                                  className="h-3.5 w-3.5 accent-primary"
                                />
                                <span
                                  className={
                                    item.is_done
                                      ? "line-through text-subtle"
                                      : "text-ink"
                                  }
                                >
                                  {item.content}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>

                        {/* Tambah Item Checklist */}
                        <div className="mt-2 flex gap-1.5">
                          <input
                            type="text"
                            value={newChecklistText[card.id] || ""}
                            onChange={(e) =>
                              setNewChecklistText((prev) => ({
                                ...prev,
                                [card.id]: e.target.value,
                              }))
                            }
                            placeholder="+ Tambah checklist tugas..."
                            className="h-[36px] w-full rounded-btn border border-line bg-bg px-2.5 text-xs text-ink placeholder:text-subtle focus:border-primary focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const text = (
                                newChecklistText[card.id] || ""
                              ).trim();
                              if (!text) return;
                              sendWsAction("checklist:add_item", {
                                card_id: card.id,
                                content: text,
                              });
                              setNewChecklistText((prev) => ({
                                ...prev,
                                [card.id]: "",
                              }));
                            }}
                            className="rounded-btn bg-primary-soft px-3 text-xs font-semibold text-accent-text hover:bg-primary hover:text-on-primary"
                          >
                            <PlusIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Pindahkan Kolom */}
                      <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2 text-xs">
                        <span className="text-muted">Pindahkan status:</span>
                        <select
                          aria-label={`Ubah status ${card.title}`}
                          value={card.list_id}
                          onChange={(e) =>
                            sendWsAction("card:move", {
                              card_id: card.id,
                              target_list_id: e.target.value,
                            })
                          }
                          className="h-[32px] rounded-btn border border-line bg-floor px-2 text-xs font-semibold text-ink focus:border-primary focus:outline-none"
                        >
                          {snapshot.lists.map((target) => (
                            <option key={target.id} value={target.id}>
                              → {target.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Kolom Kanan: Chat & Pemberitahuan */}
        <section className="space-y-4">
          {/* Ruang Chat */}
          <div className="rounded-card border border-line bg-bg p-5 shadow-soft">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <ChatIcon className="h-4 w-4 text-primary" />
                <h3 className="text-base font-extrabold text-ink">
                  {activeRoom?.name || "Ruang Chat"}
                </h3>
              </div>
              {activeRoom?.only_admins_can_send && (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2.5 py-0.5 text-[11px] font-semibold text-danger">
                  <LockIcon className="h-3 w-3" /> Hanya Admin
                </span>
              )}
            </div>

            {/* Pilihan Room */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {snapshot.rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setSelectedRoomId(room.id)}
                  className={`rounded-btn px-2.5 py-1 text-xs font-semibold transition ${
                    activeRoom?.id === room.id
                      ? "bg-primary text-on-primary"
                      : "border border-line bg-floor/60 text-ink hover:bg-primary-soft"
                  }`}
                >
                  {room.name || "Chat"}
                </button>
              ))}
            </div>

            {/* Aliran Pesan */}
            <div className="mt-3 max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {activeRoomMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-btn p-2.5 text-xs ${
                    msg.type === "task_event"
                      ? "border border-primary bg-primary-soft/60"
                      : "border border-line bg-floor/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-ink">
                      {msg.sender_name || "Sistem"}
                    </strong>
                    <span className="text-[10px] text-subtle">
                      {new Date(msg.created_at).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {msg.card_id && msg.card_title && (
                    <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-accent-text">
                      <LinkIcon className="h-3 w-3" />
                      <span>{msg.card_title}</span>
                    </div>
                  )}
                  <p className="mt-1 leading-relaxed text-ink">
                    {msg.content}
                  </p>
                </div>
              ))}
            </div>

            {/* Form Input Chat / Peringatan Terkunci */}
            <div className="mt-3 border-t border-line pt-3">
              {isRoomLockedForUser ? (
                <div className="flex items-center gap-2 rounded-btn bg-floor/70 p-3 text-xs font-semibold text-subtle">
                  <LockIcon className="h-4 w-4 text-muted" />
                  <span>
                    Ruang diskusi ini diatur khusus untuk pengumuman Admin
                    (only_admins_can_send). Anda hanya dapat membaca pesan.
                  </span>
                </div>
              ) : (
                <form onSubmit={handleSendChat} className="space-y-2">
                  <select
                    aria-label="Rujuk card"
                    value={referCardId}
                    onChange={(e) => setReferCardId(e.target.value)}
                    className="h-[36px] w-full rounded-btn border border-line bg-floor/40 px-2.5 text-xs text-ink focus:border-primary focus:outline-none"
                  >
                    <option value="">Tanpa rujukan tugas...</option>
                    {myAssignedCards.map((c) => (
                      <option key={c.id} value={c.id}>
                        Rujuk Tugas: {c.title}
                      </option>
                    ))}
                  </select>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      placeholder="Ketik pesan..."
                      className="h-[44px] w-full rounded-btn border border-line bg-bg px-3 text-xs text-ink placeholder:text-subtle focus:border-primary focus:outline-none"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      className="!h-[44px] !w-auto !px-4 !text-xs"
                    >
                      <SendIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

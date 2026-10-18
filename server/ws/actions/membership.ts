import type { BunSqlClient } from "../../bun-env";
import type { WorkspaceRole } from "../protocol";

/**
 * Adds (or re-roles) a user in a workspace and subscribes them to the shared
 * rooms: the general group room and every board room of a workspace-visible
 * board. Must run inside the caller's transaction.
 */
export async function addWorkspaceMember(
  tx: BunSqlClient,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  await tx`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${workspaceId}, ${userId}, ${role})
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `;
  if (role === "owner") {
    await tx`
      UPDATE workspaces SET owner_id = ${userId}
      WHERE id = ${workspaceId} AND owner_id IS NULL
    `;
  }

  const rooms = await tx<{ id: string; board_id: string | null }>`
    SELECT r.id, r.board_id FROM rooms r
    LEFT JOIN boards b ON b.id = r.board_id
    WHERE r.workspace_id = ${workspaceId}
      AND (
        (r.type = 'board' AND b.visibility = 'workspace' AND b.archived_at IS NULL)
        OR r.id = (
          SELECT g.id FROM rooms g
          WHERE g.workspace_id = ${workspaceId} AND g.type = 'group'
          ORDER BY g.created_at ASC LIMIT 1
        )
      )
  `;
  const roomRole = role === "owner" || role === "admin" ? "admin" : "member";
  for (const r of rooms) {
    await tx`
      INSERT INTO room_members (room_id, user_id, role)
      VALUES (${r.id}, ${userId}, ${roomRole})
      ON CONFLICT (room_id, user_id) DO NOTHING
    `;
  }
}

/** Creates the default "Umum" group room for a brand new workspace. */
export async function createGeneralRoom(
  tx: BunSqlClient,
  workspaceId: string,
  createdBy: string,
): Promise<string> {
  const [room] = await tx<{ id: string }>`
    INSERT INTO rooms (workspace_id, type, name, only_admins_can_send, created_by)
    VALUES (${workspaceId}, 'group', 'Umum', false, ${createdBy})
    RETURNING id
  `;
  return room.id;
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "workspace"}-${crypto.randomUUID().slice(0, 6)}`;
}

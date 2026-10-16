# Roadmap Note: Role Dashboards, Clean Isometric UI (Blue Theme), and SMTP Invitations

## Completed in Current Milestone
- [x] Zero-dependency native SMTP client (`server/services/smtp.ts`) supporting STARTTLS on port 587 with Gmail integration.
- [x] Workspace member invitation flow: auto-provisions non-existent Google/Gmail accounts as regular members (`member`), registers workspace membership, and dispatches an invitation email with a join link.
- [x] Admin Dashboard (`components/admin-dashboard.tsx`): Workspace member list, role transitions (`admin:update_member_role`), room chat permission toggles (`admin:toggle_room_permission`), live SMTP health check, and audit logs.
- [x] User Dashboard (`components/user-dashboard.tsx`): Personal assigned task management (`card_assignees`), interactive checklist toggling, due date tracking, and permission-aware chat room views.
- [x] Zero-Emoji Clean Isometric UI (`components/icons/index.tsx`): Eliminated all Unicode emojis and replaced them with SVG icon components across Kanban board, chat message reactions, and dashboards.
- [x] Blue Theme (`default`) strictly enforced across all workspace views.
- [x] Full integration testing with 51 passing assertions (`server/__tests__/backend.test.ts`).
- [x] Recompiled self-contained binary `build/projectmanager` with embedded static production Next.js frontend and verified memory serving on HTTP/WebSocket.

## Next Milestones
1. **OAuth2 / Google Sign-In Callback Integration**:
   - Complement the email invitation link (`?join_email=...`) with Google OAuth 2.0 PKCE flow for automated identity federation.
2. **Direct Workspace Invitation Acceptance Tokens**:
   - Store secure, cryptographically hashed invitation tokens with expiry in an `invitations` table for 1-click token validation.
3. **Email Notifications on Task Assignment**:
   - Send automatic email notifications when an admin or project manager assigns a card to a member (`card_assignees`).
4. **Rich Text & Mentions in Group Chat**:
   - Support `@user` mentions in chat messages with email/in-app alert triggers.

# Real-Time Collaborative Board Hosting & Permission Control

Enable any user to host a live whiteboard session, share it via a room code or direct link, and control in real time who can draw or edit on the board—backed by server-authoritative WebSocket permissions and persistent SQLite storage.

## User Review & Critical Decisions

> [!IMPORTANT]
> All core collaboration behaviors below reflect your confirmed preferences and will be enforced both in the client interface and on the server.

- **Confirmed Decision 1 — Frictionless Joining**: Participants join via a shareable URL (`?room=CODE`) or 6-character room code by entering a display name, without requiring account sign-in.
- **Confirmed Decision 2 — View-Only Default**: Every guest joins in **View-Only** mode by default. Drawing, erasing, media upload, and element editing are locked until the host explicitly grants write access.
- **Confirmed Decision 3 — Host Moderation & Persistence**: Includes a global **Lock / Unlock All Guests** toggle, individual **Grant / Revoke Write** switches, **Kick Participant** action, **Live Multi-User Cursors**, and **SQLite Database Persistence** so boards survive reloads and server restarts.

---

## 1. Overview & Core Concept

- **What It Does**: Transforms the static-page whiteboard into a real-time multi-user studio where a host can open a live room in one click, share a link or room code, see everyone currently on the board with live named cursors, and dynamically grant or revoke write permissions per user or globally.
- **Target Audience / Persona**: Educators, tutors, design leads, and study groups who need to present on a structured whiteboard and selectively invite participants to contribute at the right moment without losing control of the canvas.
- **Key Value**: Eliminates unauthorized canvas vandalism and accidental edits by making guest access view-only by default and giving the host instant, real-time permission switches.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Start or Join a Session**: Clicking the compact **Share / Host** button in the top toolbar opens a clean session popover where the user can click **Host Live Board** (generating a 6-character room code and shareable link) or enter an existing code and display name to join.
  2. **Guest View-Only Experience**: When a guest joins via link or code, they enter their display name and immediately see the live board and moving cursors. A subtle compact status indicator shows **View Only** (drawing tools disabled, Pan/Scroll active). The instant the host grants them write access, their drawing toolbar unlocks in real time.
  3. **Host Permission & Participant Management**: The host sees an active participant count badge on the collaboration button. Opening the panel reveals the room code, one-click **Copy Link**, a master **Lock All Guests** switch, and the active participant list with per-user **Can Write / View Only** toggles and a **Kick** button.
  4. **Kicked or Revoked State**: If the host revokes a guest's write permission mid-stroke, their active drawing immediately stops and their toolbar switches back to View-Only. If kicked, the guest is disconnected from the room and returned to their own local board with a notification toast.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Utilitarian, high-craft workspace studio—keeping the top toolbar compact and icon-driven so the canvas remains the primary focal anchor.
  - *Color Palette & Mood*:
    - Dominant Canvas (`60%`): Crisp white page surface (`#FFFFFF`) bounded against a cool slate workspace (`#E2E8F0`).
    - Structural Surfaces (`30%`): Translucent white floating bars (`bg-white/95 backdrop-blur`) with `1px` neutral borders (`#E2E8F0`) and deep slate text (`#0F172A`).
    - Semantic Accents (`10%`): Royal Blue (`#2563EB`) for active tools and primary room actions; Emerald (`#16A34A`) paired with explicit text/icon for write-enabled status; Amber (`#D97706`) for locked states; Crimson (`#DC2626`) for kick/revoke actions.
  - *Typography & Hierarchy*: `Plus Jakarta Sans` for UI controls and participant names; `JetBrains Mono` (`font-mono tabular-nums`) for room codes, participant counts, and page dimension readouts.
  - *Component Styling & Layout*: Single-elevation floating popover (`w-80`) anchored to the top toolbar with compact `36px` participant rows and single-line controls (`whitespace-nowrap shrink-0`).

- **Interactive Feedback & Motion**:
  - Smooth `150ms` cursor interpolation for remote participant pointers with high-contrast name tags.
  - Non-intrusive toast notifications when participants join, leave, or when permissions change.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Server-Authoritative WebSocket Rooms over Peer-to-Peer**
  - *Chosen Approach*: Node/Express HTTP + WebSocket server on port 3000 maintaining authoritative room state and validating every mutation against the sender's permission state.
  - *Why*: Peer-to-peer cannot securely enforce permission revocation or kicks. With a server-authoritative model, once the host revokes write access or locks all guests, any mutation packet from that client is immediately dropped by the server.
  - *Alternatives Considered*: Client-only permission checks were rejected because a guest could bypass UI state if the server does not verify permissions.

- **Decision 2: SQLite (`better-sqlite3`) + In-Memory Active Room Cache**
  - *Chosen Approach*: Persist board state (lines, shapes, texts, media metadata, page dimensions, host secret token, and permission settings) in SQLite while keeping active WebSocket connections and ephemeral cursor coordinates in memory.
  - *Why*: Delivers sub-millisecond cursor and stroke broadcasting while ensuring that refreshing the page or restarting the server preserves the entire board and host ownership.
  - *Alternatives Considered*: External cloud databases require user authentication flows that conflict with frictionless room-code joining via display name.

- **Decision 3: Media Serialization for Shared PDFs & Images**
  - *Chosen Approach*: Convert uploaded images and rendered PDF pages into compressed data URLs when syncing to a hosted room so joining participants immediately see all PDF pages and images without broken blob URLs.
  - *Why*: Browser `blob:` URLs only exist in the uploader's tab memory; serializing to data URLs ensures every participant sees identical media elements.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        React + Konva Client (SPA)                        │
│                                                                          │
│  ┌─────────────────────────┐   ┌──────────────────────────────────────┐  │
│  │ Compact Top Toolbar     │   │ Collaboration Popover & Modal        │  │
│  │ • Drawing & Page Tools  │   │ • Host / Join Room (Code or URL)     │  │
│  │ • Lock / Expand Page    │   │ • Copy Share Link & Room Code        │  │
│  │ • Host / Users Button   │   │ • Global "Lock All Guests" Toggle    │  │
│  └───────────┬─────────────┘   │ • Participant List (Write / Kick)    │  │
│              │                 └──────────────────┬───────────────────┘  │
│              ▼                                    ▼                      │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Multi-Layer Konva Stage                                            │  │
│  │ • Layer 1: Bounded Static Page & Section Guides                    │  │
│  │ • Layer 2: Media Layer (PDFs, Images, Videos)                      │  │
│  │ • Layer 3: Ink, Shapes, Text & Remote Participant Cursors          │  │
│  └────────────────────────────────┬───────────────────────────────────┘  │
└───────────────────────────────────┼──────────────────────────────────────┘
                                    │ WebSocket (ws://.../ws)
                                    │ + REST Bootstrap
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                 Express + WebSocket Server (Port 3000)                   │
│                                                                          │
│  ┌────────────────────────────────┐   ┌───────────────────────────────┐  │
│  │ Authoritative Room Manager     │   │ Permission Gatekeeper         │  │
│  │ • Active Connections & Cursors │──▶│ • Verifies hostToken          │  │
│  │ • Broadcasts Delta Events      │   │ • Enforces canWrite &         │  │
│  │ • Handles Kick & Presence      │   │   allGuestsLocked on writes   │  │
│  └───────────────┬────────────────┘   └───────────────────────────────┘  │
│                  │                                                       │
│                  ▼                                                       │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ SQLite Database (better-sqlite3)                                   │  │
│  │ • Table `boards`: room_code, host_token, page_cols, page_rows,     │  │
│  │   all_guests_locked, board_state_json, updated_at                  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - **Room Record (SQLite & Server Memory)**:
    - `roomCode`: 6-character uppercase alphanumeric ID.
    - `hostToken`: Secret UUID issued to the host creator (stored in host's `localStorage` to restore host privileges on reconnect).
    - `allGuestsLocked`: Boolean master switch that overrides individual guest write flags when enabled.
    - `boardState`: `{ pageCols, pageRows, lines, shapes, texts, media }`.
  - **Participant Session (In-Memory per Room)**:
    - `userId`: Unique client session ID.
    - `name`: Display name chosen on join.
    - `color`: Assigned high-contrast cursor color.
    - `isHost`: Boolean verified via `hostToken`.
    - `canWrite`: Boolean (defaults to `true` for host, `false` for guests).
    - `cursor`: `{ x, y } | null` in page coordinates.

- **Interactive Component & State Mapping**:
  - **Host / Join Flow**:
    - Clicking **Host Board** sends `room:create` with current local board state → server persists room in SQLite, returns `{ roomCode, hostToken }`, updates URL query `?room=CODE`, and marks user as Host.
    - Opening `?room=CODE` prompts for a display name if not set → sends `room:join` → server responds with `room:init` containing full board state, participant list, and user's effective permission (`canWrite: false`).
  - **Permission Enforcement & Real-Time Controls**:
    - Host clicking **Grant / Revoke Write** next to a participant sends `permission:setUser { targetUserId, canWrite }` → server updates participant state and broadcasts `participants:updated` to all clients.
    - Host toggling **Lock All Guests** sends `permission:setGlobalLock { allGuestsLocked }` → server updates room state in memory and SQLite, broadcasting `room:settingsUpdated`.
    - Host clicking **Kick** sends `participant:kick { targetUserId }` → server sends `room:kicked` to that socket, closes their room membership, and broadcasts updated participant list.
    - When `effectiveCanWrite` (`isHost || (canWrite && !allGuestsLocked)`) becomes `false` on a client, the client immediately finishes/cancels any active stroke, switches `tool` to `PAN`, and disables drawing/editing buttons with a clear `View Only` indicator.
  - **Delta Canvas Synchronization**:
    - While drawing or moving elements, authorized clients emit throttled delta events (`board:op` with operations `upsert-line`, `upsert-shape`, `upsert-text`, `upsert-media`, `delete-item`, `clear-board`, `page-resize`).
    - Server validates sender's `effectiveCanWrite`, applies the delta idempotently to `boardState`, persists to SQLite, and broadcasts to all other room participants.
    - Remote updates use an `isRemoteUpdate` guard so incoming socket events never trigger echo loops or pollute local undo history improperly.

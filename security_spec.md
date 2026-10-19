# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Path ID Hardening**:
   - `roomCode` must match `^[A-Z0-9]{4,8}$` (4 to 8 uppercase alphanumeric characters).
   - `participantId` and `elementId` must match `^[a-zA-Z0-9_\-]+$` and be `<= 128` characters.
2. **Strict Schema & Key Validation**:
   - Every `Room` document must contain strictly `['roomCode', 'hostId', 'allGuestsLocked', 'pageCols', 'pageRows', 'pingId', 'pingX', 'pingY', 'pingColor', 'clearedAt', 'updatedAt']` with bounded string lengths and valid numeric ranges (`pageCols` and `pageRows` between 1 and 20).
   - Every `Participant` document must contain strictly `['userId', 'name', 'color', 'isHost', 'canWrite', 'kicked', 'cursorX', 'cursorY', 'cursorActive', 'lastSeen']` with `userId == participantId` and `name.size() <= 32`.
   - Every `BoardElement` document must contain strictly `['id', 'kind', 'payload', 'updatedBy', 'updatedAt']` with `id == elementId`, `kind in ['line', 'shape', 'text', 'media']`, and `payload.size() <= 900000`.
3. **Master Gate & Write Permission Invariant**:
   - A `BoardElement` in `/rooms/{roomCode}/elements/{elementId}` can only be created, updated, or deleted if the parent `/rooms/{roomCode}` exists AND the acting participant `/rooms/{roomCode}/participants/{updatedBy}` exists, is not kicked (`kicked == false`), and either:
     - `isHost == true`, OR
     - `canWrite == true` AND the parent room has `allGuestsLocked == false`.
4. **Immutability Invariant**:
   - Once a `Room` is created, `roomCode` and `hostId` are immutable (`incoming().roomCode == existing().roomCode && incoming().hostId == existing().hostId`).
   - Once a `Participant` is created, `userId` and `isHost` are immutable.

## 2. The "Dirty Dozen" Payloads
1. **Shadow Field Injection on Room**: `{ roomCode: "ABC123", ..., isAdmin: true }` -> Rejected by `hasOnly()`.
2. **ID Poisoning on Room Code**: `roomCode = "invalid_lowercase_or_1mb_string"` -> Rejected by `isValidRoomCode()`.
3. **Immutable Host Hijack**: Updating `hostId` on an existing `/rooms/{roomCode}` -> Rejected by `incoming().hostId == existing().hostId`.
4. **Out-of-Bounds Page Expansion**: Setting `pageCols: 9999` -> Rejected by `data.pageCols >= 1 && data.pageCols <= 20`.
5. **Participant ID Mismatch**: Creating `/rooms/ABC123/participants/user_1` with `userId: "user_2"` -> Rejected by `incoming().userId == participantId`.
6. **Oversized Display Name**: Creating a participant with `name` of 500 chars -> Rejected by `data.name.size() <= 32`.
7. **Orphaned Participant Creation**: Creating a participant in a non-existent room `/rooms/NONEXIST/participants/user_1` -> Rejected by `exists(/databases/$(database)/documents/rooms/$(roomCode))`.
8. **View-Only Guest Element Creation**: Creating a `BoardElement` where `participants/{updatedBy}.canWrite == false` -> Rejected by `canParticipantWrite(roomCode, incoming().updatedBy)`.
9. **Globally Locked Guest Element Update**: Updating a `BoardElement` when `rooms/{roomCode}.allGuestsLocked == true` and participant is not host -> Rejected by `canParticipantWrite(roomCode, incoming().updatedBy)`.
10. **Kicked Participant Element Write**: Creating or updating a `BoardElement` when `participants/{updatedBy}.kicked == true` -> Rejected by `canParticipantWrite()`.
11. **Invalid Element Kind**: Creating a `BoardElement` with `kind: "script"` -> Rejected by `data.kind in ['line', 'shape', 'text', 'media']`.
12. **Value Poisoning on Update**: Updating `Participant.name` with a number or 10KB string -> Rejected by `isValidParticipant(incoming())` wrapping the `allow update` block.

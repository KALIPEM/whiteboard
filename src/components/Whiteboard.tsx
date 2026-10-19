import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Stage,
  Layer,
  Line,
  Text as KonvaText,
  Rect,
  Circle as KonvaCircle,
  Ellipse as KonvaEllipse,
  Image as KonvaImage,
  Transformer,
  Arrow,
  Group,
} from 'react-konva';
import { v4 as uuidv4 } from 'uuid';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';
import { db, OperationType, handleFirestoreError } from '../firebase';
import { TOOLS, ToolType, COLORS } from '../constants';
import {
  Hand,
  Eraser,
  Pen,
  Highlighter,
  Type,
  Trash2,
  Download,
  Circle,
  Minus,
  Image as ImageIcon,
  MousePointer2,
  X,
  Scissors,
  Square,
  Undo,
  Redo,
  Info,
  Lock,
  Unlock,
  ArrowDownToLine,
  ArrowRightToLine,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Layers,
  Users,
  Copy,
  Check,
  UserX,
  LogOut,
  Shield,
  Edit3,
  Eye,
} from 'lucide-react';

interface LineData {
  id: string;
  tool: ToolType;
  x?: number;
  y?: number;
  points: number[];
  color: string;
  strokeWidth: number;
  timestamp: number;
  isLocked?: boolean;
}

interface TextData {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
  timestamp: number;
  isLocked?: boolean;
}

interface ShapeData {
  id: string;
  type: 'line' | 'circle' | 'rectangle' | 'ellipse' | 'area_eraser';
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: number[];
  sides?: number;
  isRegular?: boolean;
  color: string;
  strokeWidth: number;
  timestamp: number;
  isLocked?: boolean;
}

interface MediaData {
  id: string;
  mediaType: 'image' | 'pdf' | 'video';
  element: HTMLImageElement | HTMLVideoElement;
  src?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  timestamp: number;
  isPermanent?: boolean;
  isLocked?: boolean;
  isPlaying?: boolean;
  isMuted?: boolean;
}

interface SerializedMediaData {
  id: string;
  mediaType: 'image' | 'pdf' | 'video';
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  timestamp: number;
  isPermanent?: boolean;
  isLocked?: boolean;
}

interface ParticipantInfo {
  userId: string;
  name: string;
  color: string;
  isHost: boolean;
  canWrite: boolean;
  effectiveCanWrite: boolean;
  cursor: { x: number; y: number } | null;
}

interface HistoryState {
  lines: LineData[];
  shapes: ShapeData[];
  texts: TextData[];
  images: MediaData[];
}

const PARTICIPANT_COLORS = [
  '#2563EB',
  '#D97706',
  '#059669',
  '#7C3AED',
  '#DC2626',
  '#0891B2',
  '#4F46E5',
  '#EA580C',
];

function getPersistentUserId(): string {
  try {
    let uid = localStorage.getItem('wb_user_id');
    if (!uid || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) {
      uid = uuidv4();
      localStorage.setItem('wb_user_id', uid);
    }
    return uid;
  } catch {
    return uuidv4();
  }
}

function getParticipantColor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  }
  return PARTICIPANT_COLORS[hash % PARTICIPANT_COLORS.length];
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function imageToDataUrl(img: HTMLImageElement): string {
  try {
    if (img.src.startsWith('data:') && img.src.length < 800000) return img.src;
    const canvas = document.createElement('canvas');
    const maxDim = 1000;
    const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.78);
  } catch {
    return '';
  }
}

export default function Whiteboard() {
  const [tool, setTool] = useState<ToolType>(TOOLS.PEN);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [penThickness, setPenThickness] = useState(2);

  const [lines, setLines] = useState<LineData[]>([]);
  const [texts, setTexts] = useState<TextData[]>([]);
  const [shapes, setShapes] = useState<ShapeData[]>([]);
  const [images, setImages] = useState<MediaData[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentLasso, setCurrentLasso] = useState<number[]>([]);
  const [pointers, setPointers] = useState<{ x: number; y: number; color: string; id: string; name?: string }[]>([]);
  const [polygonSides, setPolygonSides] = useState<number>(4);
  const [showInfo, setShowInfo] = useState<boolean>(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  // Page lock & static page expansion state
  const [isPageLocked, setIsPageLocked] = useState<boolean>(true);
  const [pageCols, setPageCols] = useState<number>(1);
  const [pageRows, setPageRows] = useState<number>(1);

  // Real-time Collaboration & Permissions state (Firebase Firestore)
  const [userId] = useState<string>(() => getPersistentUserId());
  const [myColor] = useState<string>(() => getParticipantColor(getPersistentUserId()));
  const [displayName, setDisplayName] = useState<string>(() => {
    try {
      return localStorage.getItem('wb_display_name') || '';
    } catch {
      return '';
    }
  });
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isConnectingRoom, setIsConnectingRoom] = useState<boolean>(false);
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [pendingUrlRoom, setPendingUrlRoom] = useState<string | null>(null);
  const [isHost, setIsHost] = useState<boolean>(false);
  const [canWrite, setCanWrite] = useState<boolean>(true);
  const [allGuestsLocked, setAllGuestsLocked] = useState<boolean>(false);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<
    Record<string, { name: string; color: string; x: number; y: number }>
  >({});
  const [showCollabPanel, setShowCollabPanel] = useState<boolean>(false);
  const [copiedType, setCopiedType] = useState<'link' | 'code' | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const unsubscribesRef = useRef<Array<() => void>>([]);
  const roomCodeRef = useRef<string | null>(null);
  const lastEmitTimeRef = useRef<number>(0);
  const lastCursorEmitRef = useRef<number>(0);
  const lastClearedAtRef = useRef<number>(0);
  const lastPingIdRef = useRef<string>('');
  const prevCanWriteRef = useRef<boolean | null>(null);
  const prevGlobalLockRef = useRef<boolean | null>(null);
  const activeDrawingIdRef = useRef<string | null>(null);
  const toastTimerRef = useRef<any>(null);

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  // Effective write permission: true when offline/local, or when Host, or when Guest has canWrite and global guest lock is off
  const effectiveCanWrite = !roomCode || isHost || (canWrite && !allGuestsLocked);

  const isDrawing = useRef(false);

  const stageRef = useRef<any>(null);
  const mediaLayerRef = useRef<any>(null);
  const mediaTransformerRef = useRef<any>(null);
  const annotationTransformerRef = useRef<any>(null);

  // History state
  const [history, setHistory] = useState<HistoryState[]>([{ lines: [], shapes: [], texts: [], images: [] }]);
  const [historyStep, setHistoryStep] = useState(0);
  const [shouldSaveHistory, setShouldSaveHistory] = useState(false);

  // Text input state
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Canvas & static page sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [baseViewport, setBaseViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(1);

  const pageWidth = baseViewport.width * pageCols;
  const pageHeight = baseViewport.height * pageRows;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  }, []);

  // Clamp stage position so the page is strictly bounded and never infinite
  const clampStagePos = useCallback(
    (
      pos: { x: number; y: number },
      scale = stageScale,
      pWidth = pageWidth,
      pHeight = pageHeight,
      vWidth = stageSize.width,
      vHeight = stageSize.height
    ) => {
      const scaledWidth = pWidth * scale;
      const scaledHeight = pHeight * scale;

      let x = pos.x;
      let y = pos.y;

      if (scaledWidth <= vWidth) {
        x = (vWidth - scaledWidth) / 2;
      } else {
        const minX = vWidth - scaledWidth;
        x = Math.max(minX, Math.min(0, x));
      }

      if (scaledHeight <= vHeight) {
        y = (vHeight - scaledHeight) / 2;
      } else {
        const minY = vHeight - scaledHeight;
        y = Math.max(minY, Math.min(0, y));
      }

      return { x, y };
    },
    [stageScale, pageWidth, pageHeight, stageSize.width, stageSize.height]
  );

  // When effectiveCanWrite becomes false, immediately stop any active drawing and switch to Pan/View mode
  useEffect(() => {
    if (!effectiveCanWrite) {
      isDrawing.current = false;
      activeDrawingIdRef.current = null;
      setSelectedId(null);
      setTextInput(null);
      setCurrentLasso([]);
      setContextMenu(null);
      setTool(TOOLS.PAN);
    } else if (tool === TOOLS.PAN && isPageLocked) {
      setTool(TOOLS.PEN);
    }
  }, [effectiveCanWrite]);

  // Serialize media item for network sync
  const serializeMediaItem = useCallback((m: MediaData): SerializedMediaData | null => {
    if (m.mediaType === 'video') return null; // Videos stay local
    const src = m.src || (m.element instanceof HTMLImageElement ? imageToDataUrl(m.element) : '');
    if (!src || src.length > 850000) return null;
    return {
      id: m.id,
      mediaType: m.mediaType,
      src,
      x: m.x,
      y: m.y,
      width: m.width,
      height: m.height,
      timestamp: m.timestamp,
      isPermanent: m.isPermanent,
      isLocked: m.isLocked,
    };
  }, []);

  // Hydrate incoming serialized media item into HTMLImageElement
  const hydrateMediaItem = useCallback((item: SerializedMediaData) => {
    if (!item || !item.src) return;
    const img = new window.Image();
    img.src = item.src;
    img.onload = () => {
      setImages((prev) => {
        const idx = prev.findIndex((x) => x.id === item.id);
        const mediaObj: MediaData = {
          id: item.id,
          mediaType: item.mediaType || 'image',
          element: img,
          src: item.src,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          timestamp: item.timestamp,
          isPermanent: item.isPermanent,
          isLocked: item.isLocked,
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = mediaObj;
          return next;
        }
        return [...prev, mediaObj];
      });
    };
  }, []);

  // Write or delete board operations directly in Firestore
  const writeElementToFirestore = useCallback(
    async (activeRoom: string, kind: 'line' | 'shape' | 'text' | 'media', item: any) => {
      if (!item?.id || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.id)) return;
      const payload = JSON.stringify(item);
      if (payload.length < 2 || payload.length > 900000) return;
      const path = `rooms/${activeRoom}/elements/${item.id}`;
      try {
        await setDoc(doc(db, 'rooms', activeRoom, 'elements', item.id), {
          id: item.id,
          kind,
          payload,
          updatedBy: userId,
          updatedAt: Date.now(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [userId]
  );

  // Send a board delta operation to Firestore if in a live room and permitted
  const sendBoardOp = useCallback(
    (op: any, throttle = false) => {
      const activeRoom = roomCodeRef.current;
      if (!activeRoom || !effectiveCanWrite || !op) return;

      if (throttle) {
        const now = Date.now();
        if (now - lastEmitTimeRef.current < 85) return;
        lastEmitTimeRef.current = now;
      }

      if (op.type === 'upsert-line' && op.item) {
        void writeElementToFirestore(activeRoom, 'line', op.item);
      } else if (op.type === 'upsert-shape' && op.item) {
        void writeElementToFirestore(activeRoom, 'shape', op.item);
      } else if (op.type === 'upsert-text' && op.item) {
        void writeElementToFirestore(activeRoom, 'text', op.item);
      } else if (op.type === 'upsert-media' && op.item) {
        void writeElementToFirestore(activeRoom, 'media', op.item);
      } else if (op.type === 'delete-item' && op.id) {
        const path = `rooms/${activeRoom}/elements/${op.id}`;
        deleteDoc(doc(db, 'rooms', activeRoom, 'elements', op.id)).catch((err) =>
          handleFirestoreError(err, OperationType.DELETE, path)
        );
      } else if (op.type === 'clear-board') {
        const roomPath = `rooms/${activeRoom}`;
        const clearedTs = Date.now();
        lastClearedAtRef.current = clearedTs;
        updateDoc(doc(db, 'rooms', activeRoom), {
          clearedAt: clearedTs,
          updatedAt: clearedTs,
        }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, roomPath));

        getDocs(collection(db, 'rooms', activeRoom, 'elements'))
          .then((snap) => {
            snap.docs.forEach((d) => {
              deleteDoc(d.ref).catch(() => {});
            });
          })
          .catch(() => {});
      } else if (op.type === 'page-resize') {
        const roomPath = `rooms/${activeRoom}`;
        const safeCols = Math.min(20, Math.max(1, Number(op.pageCols) || 1));
        const safeRows = Math.min(20, Math.max(1, Number(op.pageRows) || 1));
        updateDoc(doc(db, 'rooms', activeRoom), {
          pageCols: safeCols,
          pageRows: safeRows,
          updatedAt: Date.now(),
        }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, roomPath));
      }
    },
    [effectiveCanWrite, writeElementToFirestore]
  );

  const cleanupListeners = useCallback(() => {
    unsubscribesRef.current.forEach((unsub) => {
      try {
        unsub();
      } catch {
        // ignore
      }
    });
    unsubscribesRef.current = [];
  }, []);

  const leaveSession = useCallback(
    (showNotice = true) => {
      const activeRoom = roomCodeRef.current;
      cleanupListeners();

      if (activeRoom) {
        updateDoc(doc(db, 'rooms', activeRoom, 'participants', userId), {
          cursorActive: false,
          lastSeen: Date.now(),
        }).catch(() => {});
      }

      roomCodeRef.current = null;
      setRoomCode(null);
      setIsHost(false);
      setCanWrite(true);
      setAllGuestsLocked(false);
      setParticipants([]);
      setRemoteCursors({});
      setShowCollabPanel(false);
      prevCanWriteRef.current = null;
      prevGlobalLockRef.current = null;

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete('room');
      window.history.replaceState({}, '', nextUrl.toString());

      if (showNotice) {
        showToast('Left the live session');
      }
    },
    [cleanupListeners, showToast, userId]
  );

  // Attach Firestore real-time listeners for Room, Participants, and Board Elements
  const subscribeToRoom = useCallback(
    (targetCode: string, initialIsHost: boolean) => {
      cleanupListeners();

      // 1. Listen to Room document metadata (global guest lock, page size, clear timestamp, pings)
      const roomDocRef = doc(db, 'rooms', targetCode);
      const unsubRoom = onSnapshot(
        roomDocRef,
        (snap) => {
          if (!snap.exists()) return;
          const data = snap.data();

          const locked = Boolean(data.allGuestsLocked);
          if (
            prevGlobalLockRef.current !== null &&
            prevGlobalLockRef.current !== locked &&
            !initialIsHost
          ) {
            showToast(
              locked
                ? 'Host locked the board for all guests (View-Only)'
                : 'Host unlocked the board for guests'
            );
          }
          prevGlobalLockRef.current = locked;
          setAllGuestsLocked(locked);

          if (typeof data.pageCols === 'number') setPageCols(Math.max(1, data.pageCols));
          if (typeof data.pageRows === 'number') setPageRows(Math.max(1, data.pageRows));

          if (typeof data.clearedAt === 'number' && data.clearedAt > lastClearedAtRef.current) {
            lastClearedAtRef.current = data.clearedAt;
            setLines([]);
            setShapes([]);
            setTexts([]);
            setImages([]);
            setSelectedId(null);
          }

          if (data.pingId && data.pingId !== lastPingIdRef.current) {
            lastPingIdRef.current = data.pingId;
            setPointers((prev) => [
              ...prev.filter((p) => p.id !== data.pingId),
              {
                id: data.pingId,
                x: Number(data.pingX) || 0,
                y: Number(data.pingY) || 0,
                color: data.pingColor || '#000000',
              },
            ]);
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, `rooms/${targetCode}`)
      );

      // 2. Listen to Participants subcollection (permissions, kicks, active user list, live cursors)
      const partsColRef = collection(db, 'rooms', targetCode, 'participants');
      const unsubParts = onSnapshot(
        partsColRef,
        (snap) => {
          const allDocs = snap.docs.map((d) => d.data());
          const myDoc = allDocs.find((p) => p.userId === userId);

          if (myDoc?.kicked) {
            showToast('You were removed from the session by the host.');
            leaveSession(false);
            return;
          }

          if (myDoc) {
            const myCanWrite = Boolean(myDoc.isHost || myDoc.canWrite);
            if (
              prevCanWriteRef.current !== null &&
              prevCanWriteRef.current !== myCanWrite &&
              !myDoc.isHost
            ) {
              showToast(
                myCanWrite
                  ? 'Host granted you permission to write on the board'
                  : 'Host switched your access to View-Only'
              );
            }
            prevCanWriteRef.current = myCanWrite;
            setCanWrite(myCanWrite);
            setIsHost(Boolean(myDoc.isHost));
          }

          // Filter out kicked participants
          const activeList = allDocs.filter((p) => !p.kicked);

          setAllGuestsLocked((currentGlobalLock) => {
            const formatted: ParticipantInfo[] = activeList
              .map((p) => ({
                userId: p.userId,
                name: p.name || 'Guest',
                color: p.color || '#2563EB',
                isHost: Boolean(p.isHost),
                canWrite: Boolean(p.canWrite),
                effectiveCanWrite: Boolean(p.isHost || (p.canWrite && !currentGlobalLock)),
                cursor: p.cursorActive ? { x: Number(p.cursorX) || 0, y: Number(p.cursorY) || 0 } : null,
              }))
              .sort((a, b) => (a.isHost === b.isHost ? a.name.localeCompare(b.name) : a.isHost ? -1 : 1));

            setParticipants(formatted);

            const nextCursors: Record<string, { name: string; color: string; x: number; y: number }> = {};
            for (const p of formatted) {
              if (p.userId !== userId && p.cursor) {
                nextCursors[p.userId] = {
                  name: p.name,
                  color: p.color,
                  x: p.cursor.x,
                  y: p.cursor.y,
                };
              }
            }
            setRemoteCursors(nextCursors);

            return currentGlobalLock;
          });
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `rooms/${targetCode}/participants`)
      );

      // 3. Listen to Board Elements subcollection (strokes, shapes, text, media)
      const elementsColRef = collection(db, 'rooms', targetCode, 'elements');
      const unsubElements = onSnapshot(
        elementsColRef,
        (snap) => {
          snap.docChanges().forEach((change) => {
            const data = change.doc.data();
            const elId = data.id || change.doc.id;

            if (change.type === 'removed') {
              setLines((prev) => prev.filter((l) => l.id !== elId));
              setShapes((prev) => prev.filter((s) => s.id !== elId));
              setTexts((prev) => prev.filter((t) => t.id !== elId));
              setImages((prev) => prev.filter((i) => i.id !== elId));
              setSelectedId((prev) => (prev === elId ? null : prev));
              return;
            }

            // Avoid overwriting the local user's actively drawn stroke mid-drag
            if (isDrawing.current && activeDrawingIdRef.current === elId && data.updatedBy === userId) {
              return;
            }

            let parsed: any;
            try {
              parsed = JSON.parse(data.payload);
            } catch {
              return;
            }
            if (!parsed || !parsed.id) return;

            if (data.kind === 'line') {
              setLines((prev) => {
                const idx = prev.findIndex((l) => l.id === parsed.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = parsed;
                  return next;
                }
                return [...prev, parsed];
              });
            } else if (data.kind === 'shape') {
              setShapes((prev) => {
                const idx = prev.findIndex((s) => s.id === parsed.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = parsed;
                  return next;
                }
                return [...prev, parsed];
              });
            } else if (data.kind === 'text') {
              setTexts((prev) => {
                const idx = prev.findIndex((t) => t.id === parsed.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = parsed;
                  return next;
                }
                return [...prev, parsed];
              });
            } else if (data.kind === 'media') {
              hydrateMediaItem(parsed as SerializedMediaData);
            }
          });
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `rooms/${targetCode}/elements`)
      );

      unsubscribesRef.current = [unsubRoom, unsubParts, unsubElements];
    },
    [cleanupListeners, hydrateMediaItem, leaveSession, showToast, userId]
  );

  // Create or Join a live hosted board session using Firebase Firestore
  const connectToSession = useCallback(
    async (mode: 'create' | 'join', targetRoomCode?: string, customName?: string) => {
      if (isConnectingRoom) return;
      setIsConnectingRoom(true);

      const rawName = (customName ?? displayName).trim() || (mode === 'create' ? 'Host' : 'Guest');
      const safeName = rawName.slice(0, 32);
      try {
        localStorage.setItem('wb_display_name', safeName);
      } catch {
        // ignore
      }
      setDisplayName(safeName);

      try {
        if (mode === 'create') {
          let newCode = generateRoomCode();
          const existingCheck = await getDoc(doc(db, 'rooms', newCode));
          if (existingCheck.exists()) {
            newCode = generateRoomCode();
          }

          const now = Date.now();
          const safeCols = Math.min(20, Math.max(1, pageCols));
          const safeRows = Math.min(20, Math.max(1, pageRows));

          try {
            await setDoc(doc(db, 'rooms', newCode), {
              roomCode: newCode,
              hostId: userId,
              allGuestsLocked: false,
              pageCols: safeCols,
              pageRows: safeRows,
              pingId: '',
              pingX: 0,
              pingY: 0,
              pingColor: '#000000',
              clearedAt: 0,
              updatedAt: now,
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `rooms/${newCode}`);
          }

          try {
            await setDoc(doc(db, 'rooms', newCode, 'participants', userId), {
              userId,
              name: safeName,
              color: myColor,
              isHost: true,
              canWrite: true,
              kicked: false,
              cursorX: 0,
              cursorY: 0,
              cursorActive: false,
              lastSeen: now,
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `rooms/${newCode}/participants/${userId}`);
          }

          // Upload current local board elements into the hosted room
          const uploadPromises: Promise<any>[] = [];
          for (const l of lines) {
            uploadPromises.push(writeElementToFirestore(newCode, 'line', l));
          }
          for (const s of shapes) {
            uploadPromises.push(writeElementToFirestore(newCode, 'shape', s));
          }
          for (const t of texts) {
            uploadPromises.push(writeElementToFirestore(newCode, 'text', t));
          }
          for (const m of images) {
            const serialized = serializeMediaItem(m);
            if (serialized) {
              uploadPromises.push(writeElementToFirestore(newCode, 'media', serialized));
            }
          }
          await Promise.all(uploadPromises);

          roomCodeRef.current = newCode;
          setRoomCode(newCode);
          setIsHost(true);
          setCanWrite(true);
          setAllGuestsLocked(false);
          setPendingUrlRoom(null);

          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set('room', newCode);
          window.history.replaceState({}, '', nextUrl.toString());

          subscribeToRoom(newCode, true);
          showToast(`Hosting live room ${newCode}`);
        } else if (mode === 'join' && targetRoomCode) {
          const cleanCode = targetRoomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (cleanCode.length < 4 || cleanCode.length > 8) {
            showToast('Invalid room code.');
            setIsConnectingRoom(false);
            return;
          }

          let roomSnap;
          try {
            roomSnap = await getDoc(doc(db, 'rooms', cleanCode));
          } catch (err) {
            handleFirestoreError(err, OperationType.GET, `rooms/${cleanCode}`);
          }

          if (!roomSnap || !roomSnap.exists()) {
            showToast(`Room ${cleanCode} not found.`);
            setPendingUrlRoom(null);
            setIsConnectingRoom(false);
            return;
          }

          const roomData = roomSnap.data();
          const amIHost = roomData.hostId === userId;
          const partRef = doc(db, 'rooms', cleanCode, 'participants', userId);
          let partSnap;
          try {
            partSnap = await getDoc(partRef);
          } catch (err) {
            handleFirestoreError(err, OperationType.GET, `rooms/${cleanCode}/participants/${userId}`);
          }

          let initialCanWrite = amIHost;

          if (partSnap && partSnap.exists()) {
            const existingPart = partSnap.data();
            if (existingPart.kicked && !amIHost) {
              showToast('You were removed from this session by the host.');
              setPendingUrlRoom(null);
              setIsConnectingRoom(false);
              return;
            }
            initialCanWrite = Boolean(amIHost || existingPart.canWrite);
            try {
              await updateDoc(partRef, {
                name: safeName,
                color: myColor,
                cursorX: 0,
                cursorY: 0,
                cursorActive: false,
                lastSeen: Date.now(),
              });
            } catch (err) {
              handleFirestoreError(err, OperationType.UPDATE, `rooms/${cleanCode}/participants/${userId}`);
            }
          } else {
            try {
              await setDoc(partRef, {
                userId,
                name: safeName,
                color: myColor,
                isHost: amIHost,
                canWrite: amIHost, // Guests start in View-Only mode by default
                kicked: false,
                cursorX: 0,
                cursorY: 0,
                cursorActive: false,
                lastSeen: Date.now(),
              });
            } catch (err) {
              handleFirestoreError(err, OperationType.CREATE, `rooms/${cleanCode}/participants/${userId}`);
            }
          }

          // Clear local board before loading shared room state
          setLines([]);
          setShapes([]);
          setTexts([]);
          setImages([]);
          setSelectedId(null);

          lastClearedAtRef.current = Number(roomData.clearedAt) || 0;
          lastPingIdRef.current = roomData.pingId || '';
          prevCanWriteRef.current = initialCanWrite;
          prevGlobalLockRef.current = Boolean(roomData.allGuestsLocked);

          roomCodeRef.current = cleanCode;
          setRoomCode(cleanCode);
          setIsHost(amIHost);
          setCanWrite(initialCanWrite);
          setAllGuestsLocked(Boolean(roomData.allGuestsLocked));
          setPendingUrlRoom(null);

          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set('room', cleanCode);
          window.history.replaceState({}, '', nextUrl.toString());

          subscribeToRoom(cleanCode, amIHost);
          showToast(
            amIHost
              ? `Rejoined your hosted room ${cleanCode}`
              : initialCanWrite && !roomData.allGuestsLocked
              ? `Joined room ${cleanCode} (Write enabled)`
              : `Joined room ${cleanCode} (View-Only until host grants access)`
          );
        }
      } finally {
        setIsConnectingRoom(false);
      }
    },
    [
      displayName,
      images,
      isConnectingRoom,
      lines,
      myColor,
      pageCols,
      pageRows,
      serializeMediaItem,
      shapes,
      showToast,
      subscribeToRoom,
      texts,
      userId,
      writeElementToFirestore,
    ]
  );

  // Re-evaluate participant effectiveCanWrite whenever allGuestsLocked changes
  useEffect(() => {
    setParticipants((prev) =>
      prev.map((p) => ({
        ...p,
        effectiveCanWrite: Boolean(p.isHost || (p.canWrite && !allGuestsLocked)),
      }))
    );
  }, [allGuestsLocked]);

  // Host moderation helpers (backed by Firestore)
  const handleToggleUserWrite = async (targetUserId: string, nextCanWrite: boolean) => {
    if (!roomCode || !isHost) return;
    const path = `rooms/${roomCode}/participants/${targetUserId}`;
    try {
      await updateDoc(doc(db, 'rooms', roomCode, 'participants', targetUserId), {
        canWrite: nextCanWrite,
        lastSeen: Date.now(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleToggleGlobalLock = async (nextLocked: boolean) => {
    if (!roomCode || !isHost) return;
    const path = `rooms/${roomCode}`;
    try {
      await updateDoc(doc(db, 'rooms', roomCode), {
        allGuestsLocked: nextLocked,
        updatedAt: Date.now(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleKickParticipant = async (targetUserId: string) => {
    if (!roomCode || !isHost) return;
    const path = `rooms/${roomCode}/participants/${targetUserId}`;
    try {
      await updateDoc(doc(db, 'rooms', roomCode, 'participants', targetUserId), {
        kicked: true,
        canWrite: false,
        lastSeen: Date.now(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  // Check URL for `?room=CODE` on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room')?.trim().toUpperCase();
    if (urlRoom && /^[A-Z0-9]{4,8}$/.test(urlRoom)) {
      setJoinCodeInput(urlRoom);
      setPendingUrlRoom(urlRoom);
    }
    return () => {
      cleanupListeners();
    };
  }, [cleanupListeners]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const newW = containerRef.current.offsetWidth;
        const newH = containerRef.current.offsetHeight;
        setStageSize({ width: newW, height: newH });
        setBaseViewport((prev) => ({
          width: prev.width || newW,
          height: prev.height || newH,
        }));
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setStagePos((prev) => clampStagePos(prev));
  }, [pageWidth, pageHeight, stageScale, stageSize.width, stageSize.height, clampStagePos]);

  useEffect(() => {
    if (tool !== TOOLS.SELECT) {
      setSelectedId(null);
      setContextMenu(null);
    }
  }, [tool]);

  // Video animation loop for smooth rendering on the Media Layer
  useEffect(() => {
    let animId: number;
    const hasVideos = images.some((m) => m.mediaType === 'video');
    if (hasVideos) {
      const tick = () => {
        if (mediaLayerRef.current) {
          mediaLayerRef.current.batchDraw();
        }
        animId = requestAnimationFrame(tick);
      };
      animId = requestAnimationFrame(tick);
    }
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [images]);

  useEffect(() => {
    if (textInput && textInputRef.current) {
      if (document.activeElement !== textInputRef.current) {
        setTimeout(() => {
          textInputRef.current?.focus();
        }, 50);
      }
    }
  }, [textInput]);

  // Attach Transformer to the correct layer only when in SELECT mode, unlocked, and user has write access
  useEffect(() => {
    if (!mediaTransformerRef.current || !annotationTransformerRef.current || !stageRef.current) return;

    if (!effectiveCanWrite || tool !== TOOLS.SELECT || !selectedId) {
      mediaTransformerRef.current.nodes([]);
      annotationTransformerRef.current.nodes([]);
      mediaTransformerRef.current.getLayer()?.batchDraw();
      annotationTransformerRef.current.getLayer()?.batchDraw();
      return;
    }

    const selectedMedia = images.find((i) => i.id === selectedId);
    const selectedLine = lines.find((l) => l.id === selectedId);
    const selectedShape = shapes.find((s) => s.id === selectedId);
    const selectedText = texts.find((t) => t.id === selectedId);

    const isLocked =
      selectedMedia?.isLocked ||
      selectedLine?.isLocked ||
      selectedShape?.isLocked ||
      selectedText?.isLocked;

    if (isLocked) {
      mediaTransformerRef.current.nodes([]);
      annotationTransformerRef.current.nodes([]);
      mediaTransformerRef.current.getLayer()?.batchDraw();
      annotationTransformerRef.current.getLayer()?.batchDraw();
      return;
    }

    const node = stageRef.current.findOne('#' + selectedId);
    if (node) {
      if (selectedMedia) {
        annotationTransformerRef.current.nodes([]);
        mediaTransformerRef.current.nodes([node]);
      } else {
        mediaTransformerRef.current.nodes([]);
        annotationTransformerRef.current.nodes([node]);
      }
    } else {
      mediaTransformerRef.current.nodes([]);
      annotationTransformerRef.current.nodes([]);
    }
    mediaTransformerRef.current.getLayer()?.batchDraw();
    annotationTransformerRef.current.getLayer()?.batchDraw();
  }, [selectedId, tool, texts, shapes, lines, images, effectiveCanWrite]);

  useEffect(() => {
    if (shouldSaveHistory) {
      const nextHistory = history.slice(0, historyStep + 1);
      nextHistory.push({
        lines: lines.map((l) => ({ ...l, points: [...l.points] })),
        shapes: shapes.map((s) => ({ ...s, points: s.points ? [...s.points] : undefined })),
        texts: texts.map((t) => ({ ...t })),
        images: images.map((i) => ({ ...i })),
      });
      setHistory(nextHistory);
      setHistoryStep(nextHistory.length - 1);
      setShouldSaveHistory(false);
    }
  }, [shouldSaveHistory, lines, shapes, texts, images, history, historyStep]);

  const syncFullBoardState = useCallback(
    async (
      nextLines: LineData[],
      nextShapes: ShapeData[],
      nextTexts: TextData[],
      nextImages: MediaData[]
    ) => {
      const activeRoom = roomCodeRef.current;
      if (!activeRoom || !effectiveCanWrite) return;

      const targetIds = new Set<string>([
        ...nextLines.map((l) => l.id),
        ...nextShapes.map((s) => s.id),
        ...nextTexts.map((t) => t.id),
        ...nextImages.map((i) => i.id),
      ]);

      try {
        const existingSnap = await getDocs(collection(db, 'rooms', activeRoom, 'elements'));
        existingSnap.docs.forEach((d) => {
          if (!targetIds.has(d.id)) {
            deleteDoc(d.ref).catch(() => {});
          }
        });
      } catch {
        // ignore
      }

      nextLines.forEach((l) => void writeElementToFirestore(activeRoom, 'line', l));
      nextShapes.forEach((s) => void writeElementToFirestore(activeRoom, 'shape', s));
      nextTexts.forEach((t) => void writeElementToFirestore(activeRoom, 'text', t));
      nextImages.forEach((m) => {
        const serialized = serializeMediaItem(m);
        if (serialized) void writeElementToFirestore(activeRoom, 'media', serialized);
      });
    },
    [effectiveCanWrite, serializeMediaItem, writeElementToFirestore]
  );

  const undo = () => {
    if (!effectiveCanWrite) return;
    if (historyStep > 0) {
      const prevStep = historyStep - 1;
      const state = history[prevStep];
      const nextLines = state.lines.map((l) => ({ ...l, points: [...l.points] }));
      const nextShapes = state.shapes.map((s) => ({ ...s, points: s.points ? [...s.points] : undefined }));
      const nextTexts = state.texts.map((t) => ({ ...t }));
      const nextImages = state.images.map((i) => ({ ...i }));
      setLines(nextLines);
      setShapes(nextShapes);
      setTexts(nextTexts);
      setImages(nextImages);
      setHistoryStep(prevStep);
      setSelectedId(null);
      void syncFullBoardState(nextLines, nextShapes, nextTexts, nextImages);
    }
  };

  const redo = () => {
    if (!effectiveCanWrite) return;
    if (historyStep < history.length - 1) {
      const nextStep = historyStep + 1;
      const state = history[nextStep];
      const nextLines = state.lines.map((l) => ({ ...l, points: [...l.points] }));
      const nextShapes = state.shapes.map((s) => ({ ...s, points: s.points ? [...s.points] : undefined }));
      const nextTexts = state.texts.map((t) => ({ ...t }));
      const nextImages = state.images.map((i) => ({ ...i }));
      setLines(nextLines);
      setShapes(nextShapes);
      setTexts(nextTexts);
      setImages(nextImages);
      setHistoryStep(nextStep);
      setSelectedId(null);
      void syncFullBoardState(nextLines, nextShapes, nextTexts, nextImages);
    }
  };

  const deleteSelected = () => {
    if (!selectedId || !effectiveCanWrite) return;
    const idToDelete = selectedId;
    const media = images.find((i) => i.id === idToDelete);
    if (media && media.mediaType === 'video' && media.element instanceof HTMLVideoElement) {
      media.element.pause();
    }
    setLines((prev) => prev.filter((l) => l.id !== idToDelete));
    setShapes((prev) => prev.filter((s) => s.id !== idToDelete));
    setTexts((prev) => prev.filter((t) => t.id !== idToDelete));
    setImages((prev) => prev.filter((i) => i.id !== idToDelete));
    setSelectedId(null);
    setShouldSaveHistory(true);
    sendBoardOp({ type: 'delete-item', id: idToDelete });
  };

  const toggleLockItem = (id: string) => {
    if (!effectiveCanWrite) return;
    setLines((prev) =>
      prev.map((l) => {
        if (l.id === id) {
          const updated = { ...l, isLocked: !l.isLocked };
          sendBoardOp({ type: 'upsert-line', item: updated });
          return updated;
        }
        return l;
      })
    );
    setShapes((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          const updated = { ...s, isLocked: !s.isLocked };
          sendBoardOp({ type: 'upsert-shape', item: updated });
          return updated;
        }
        return s;
      })
    );
    setTexts((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const updated = { ...t, isLocked: !t.isLocked };
          sendBoardOp({ type: 'upsert-text', item: updated });
          return updated;
        }
        return t;
      })
    );
    setImages((prev) =>
      prev.map((i) => {
        if (i.id === id) {
          const updated = { ...i, isLocked: !i.isLocked };
          const serialized = serializeMediaItem(updated);
          if (serialized) sendBoardOp({ type: 'upsert-media', item: serialized });
          return updated;
        }
        return i;
      })
    );
    setShouldSaveHistory(true);
  };

  const toggleVideoPlay = (id: string) => {
    setImages((prev) =>
      prev.map((item) => {
        if (item.id === id && item.mediaType === 'video' && item.element instanceof HTMLVideoElement) {
          if (item.element.paused) {
            item.element.play();
            return { ...item, isPlaying: true };
          } else {
            item.element.pause();
            return { ...item, isPlaying: false };
          }
        }
        return item;
      })
    );
  };

  const toggleVideoMute = (id: string) => {
    setImages((prev) =>
      prev.map((item) => {
        if (item.id === id && item.mediaType === 'video' && item.element instanceof HTMLVideoElement) {
          item.element.muted = !item.element.muted;
          return { ...item, isMuted: item.element.muted };
        }
        return item;
      })
    );
  };

  const expandVertically = () => {
    if (!effectiveCanWrite) return;
    const nextRows = Math.min(20, pageRows + 1);
    setPageRows(nextRows);
    sendBoardOp({ type: 'page-resize', pageCols, pageRows: nextRows });
    if (!isPageLocked) {
      const nextHeight = baseViewport.height * nextRows;
      setStagePos((prev) =>
        clampStagePos(
          { x: prev.x, y: prev.y - baseViewport.height * 0.5 * stageScale },
          stageScale,
          pageWidth,
          nextHeight
        )
      );
    }
  };

  const expandHorizontally = () => {
    if (!effectiveCanWrite) return;
    const nextCols = Math.min(20, pageCols + 1);
    setPageCols(nextCols);
    sendBoardOp({ type: 'page-resize', pageCols: nextCols, pageRows });
    if (!isPageLocked) {
      const nextWidth = baseViewport.width * nextCols;
      setStagePos((prev) =>
        clampStagePos(
          { x: prev.x - baseViewport.width * 0.5 * stageScale, y: prev.y },
          stageScale,
          nextWidth,
          pageHeight
        )
      );
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore keyboard shortcuts if typing in an input or textarea
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (textInput || activeTag === 'input' || activeTag === 'textarea') return;

      if (!effectiveCanWrite) return;

      if (e.key >= '3' && e.key <= '9') {
        setPolygonSides(parseInt(e.key));
      }

      const key = e.key.toLowerCase();
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (key === 'v') setTool(TOOLS.SELECT);
        else if (key === 'p') setTool(TOOLS.PEN);
        else if (key === 'm') setTool(TOOLS.MARKER);
        else if (key === 'e') setTool(TOOLS.ERASER);
        else if (key === 'r') setTool(TOOLS.AREA_ERASER);
        else if (key === 't') setTool(TOOLS.TEXT);
        else if (key === 'l') setTool(TOOLS.LINE);
        else if (key === 'a') setTool(TOOLS.RECTANGLE);
        else if (key === 'c' || key === 's') setTool(TOOLS.CIRCLE);
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        deleteSelected();
      }

      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        undo();
      }

      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        redo();
      }
      if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, textInput, history, historyStep, effectiveCanWrite]);

  const getViewportCenterOnPage = useCallback(
    (itemW: number, itemH: number) => {
      const centerX = (-stagePos.x + stageSize.width / 2) / stageScale - itemW / 2;
      const centerY = (-stagePos.y + stageSize.height / 2) / stageScale - itemH / 2;
      return {
        x: Math.max(20, Math.min(pageWidth - itemW - 20, centerX)),
        y: Math.max(20, Math.min(pageHeight - itemH - 20, centerY)),
      };
    },
    [stagePos, stageSize, stageScale, pageWidth, pageHeight]
  );

  // Paste handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!effectiveCanWrite) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          if (!blob) continue;

          const img = new window.Image();
          img.src = URL.createObjectURL(blob);
          img.onload = () => {
            const maxSize = 320;
            const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
            const width = img.width * scale;
            const height = img.height * scale;
            const pos = getViewportCenterOnPage(width, height);
            const id = uuidv4();
            const dataUrl = imageToDataUrl(img);

            const mediaItem: MediaData = {
              id,
              mediaType: 'image',
              element: img,
              src: dataUrl,
              x: pos.x,
              y: pos.y,
              width,
              height,
              timestamp: Date.now(),
              isLocked: false,
            };

            setImages((prev) => [...prev, mediaItem]);
            setTool(TOOLS.SELECT);
            setSelectedId(id);
            setShouldSaveHistory(true);

            const serialized = serializeMediaItem(mediaItem);
            if (serialized) sendBoardOp({ type: 'upsert-media', item: serialized });
          };
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [getViewportCenterOnPage, effectiveCanWrite, serializeMediaItem, sendBoardOp]);

  const getStagePointerPos = (stage: any) => {
    const ptr = stage.getPointerPosition();
    if (!ptr) return null;
    return {
      x: Math.max(0, Math.min(pageWidth, (ptr.x - stage.x()) / stage.scaleX())),
      y: Math.max(0, Math.min(pageHeight, (ptr.y - stage.y()) / stage.scaleY())),
    };
  };

  const broadcastPointerPing = (pointer: { id: string; x: number; y: number; color: string }) => {
    const activeRoom = roomCodeRef.current;
    if (!activeRoom) return;
    lastPingIdRef.current = pointer.id;
    updateDoc(doc(db, 'rooms', activeRoom), {
      pingId: pointer.id.slice(0, 128),
      pingX: pointer.x,
      pingY: pointer.y,
      pingColor: (pointer.color || '#000000').slice(0, 32),
      updatedAt: Date.now(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `rooms/${activeRoom}`));
  };

  const handleContextMenu = (e: any) => {
    e.evt.preventDefault();
    if (!effectiveCanWrite) return;
    const stage = e.target.getStage();
    if (!stage) return;

    if (e.evt.shiftKey) {
      const pos = getStagePointerPos(stage);
      if (pos) {
        const pointer = { x: pos.x, y: pos.y, color: 'black', id: uuidv4() };
        setPointers([pointer]);
        broadcastPointerPing(pointer);
      }
      return;
    }

    const clickedOnEmpty =
      e.target === stage || e.target.name() === 'background' || e.target.name() === 'page-grid';
    if (!clickedOnEmpty) {
      const id = e.target.id();
      if (id) {
        setTool(TOOLS.SELECT);
        setSelectedId(id);
        setContextMenu({ x: e.evt.clientX, y: e.evt.clientY, id });
      }
    } else {
      setContextMenu(null);
    }
  };

  const handleMouseDown = (e: any) => {
    setContextMenu(null);
    if (e.evt.button === 2 || e.evt.button === 3) {
      return;
    }

    const stage = e.target.getStage();
    if (!stage) return;

    if (!effectiveCanWrite) return;

    // Shift + Click for ping arrow
    if (e.evt.shiftKey && tool !== TOOLS.ERASER) {
      const pos = getStagePointerPos(stage);
      if (pos) {
        const pointer = { x: pos.x, y: pos.y, color: 'black', id: uuidv4() };
        setPointers([pointer]);
        broadcastPointerPing(pointer);
      }
      return;
    }

    const clickedOnEmpty =
      e.target === stage || e.target.name() === 'background' || e.target.name() === 'page-grid';
    if (clickedOnEmpty) {
      setSelectedId(null);
    }

    const pos = getStagePointerPos(stage);
    if (!pos) return;

    if (textInput) {
      handleTextSubmit();
      return;
    }

    if (tool === TOOLS.SELECT || tool === TOOLS.PAN) return;

    if (tool === TOOLS.TEXT) {
      setTextInput({ x: pos.x, y: pos.y, value: '', _createdAt: Date.now() } as any);
      return;
    }

    isDrawing.current = true;

    if (tool === TOOLS.ERASER && e.evt.shiftKey) {
      const ptr = stage.getPointerPosition();
      if (ptr) {
        const shape = stage.getIntersection(ptr);
        if (shape && shape.name() !== 'background' && shape.name() !== 'page-grid') {
          const id = shape.id();
          if (id) {
            setLines((prev) => prev.filter((l) => l.id !== id));
            setShapes((prev) => prev.filter((s) => s.id !== id));
            setTexts((prev) => prev.filter((t) => t.id !== id));
            setImages((prev) => prev.filter((i) => i.id !== id || i.isLocked));
            setShouldSaveHistory(true);
            sendBoardOp({ type: 'delete-item', id });
          }
        }
      }
      return;
    }

    if (tool === TOOLS.AREA_ERASER) {
      setCurrentLasso([pos.x, pos.y]);
      return;
    }

    const id = uuidv4();
    activeDrawingIdRef.current = id;
    let strokeWidth = tool === TOOLS.PEN ? penThickness : 2;
    if (tool === TOOLS.MARKER) strokeWidth = 12;
    if (tool === TOOLS.ERASER) strokeWidth = 24;

    if (tool === TOOLS.LINE) {
      const newShape: ShapeData = {
        id,
        type: 'line',
        x: 0,
        y: 0,
        points: [pos.x, pos.y, pos.x, pos.y],
        color,
        strokeWidth,
        timestamp: Date.now(),
      };
      setShapes((prev) => [...prev, newShape]);
    } else if (tool === TOOLS.RECTANGLE) {
      const newShape: ShapeData = {
        id,
        type: 'rectangle',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        color,
        strokeWidth,
        timestamp: Date.now(),
        sides: polygonSides,
        isRegular: e.evt.ctrlKey || e.evt.metaKey,
      };
      setShapes((prev) => [...prev, newShape]);
    } else if (tool === TOOLS.CIRCLE) {
      const newShape: ShapeData = {
        id,
        type: 'ellipse',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        color,
        strokeWidth,
        timestamp: Date.now(),
        isRegular: e.evt.ctrlKey || e.evt.metaKey,
      };
      setShapes((prev) => [...prev, newShape]);
    } else {
      const newLine: LineData = {
        id,
        tool,
        x: 0,
        y: 0,
        points: [pos.x, pos.y],
        color: tool === TOOLS.ERASER ? '#ffffff' : color,
        strokeWidth,
        timestamp: Date.now(),
      };
      setLines((prev) => [...prev, newLine]);
    }
  };

  const handleMouseMove = (e: any) => {
    const stage = e.target.getStage();
    if (!stage) return;

    const pos = getStagePointerPos(stage);
    if (!pos) return;

    // Broadcast live cursor position to room participants via Firestore
    const activeRoom = roomCodeRef.current;
    if (activeRoom) {
      const now = Date.now();
      if (now - lastCursorEmitRef.current > 110) {
        lastCursorEmitRef.current = now;
        updateDoc(doc(db, 'rooms', activeRoom, 'participants', userId), {
          cursorX: Math.round(pos.x),
          cursorY: Math.round(pos.y),
          cursorActive: true,
          lastSeen: now,
        }).catch(() => {});
      }
    }

    if (!isDrawing.current || !effectiveCanWrite) return;

    if (tool === TOOLS.ERASER && e.evt.shiftKey) {
      const ptr = stage.getPointerPosition();
      if (ptr) {
        const shape = stage.getIntersection(ptr);
        if (shape && shape.name() !== 'background' && shape.name() !== 'page-grid') {
          const id = shape.id();
          if (id) {
            setLines((prev) => prev.filter((l) => l.id !== id));
            setShapes((prev) => prev.filter((s) => s.id !== id));
            setTexts((prev) => prev.filter((t) => t.id !== id));
            setImages((prev) => prev.filter((i) => i.id !== id || i.isLocked));
            setShouldSaveHistory(true);
            sendBoardOp({ type: 'delete-item', id });
          }
        }
      }
      return;
    }

    if (tool === TOOLS.AREA_ERASER) {
      setCurrentLasso((prev) => [...prev, pos.x, pos.y]);
      return;
    }

    if (tool === TOOLS.LINE) {
      setShapes((prev) => {
        const lastShape = prev[prev.length - 1];
        if (!lastShape || lastShape.type !== 'line') return prev;
        const updated = {
          ...lastShape,
          points: [lastShape.points![0], lastShape.points![1], pos.x, pos.y],
        };
        sendBoardOp({ type: 'upsert-shape', item: updated }, true);
        const next = [...prev];
        next[next.length - 1] = updated;
        return next;
      });
    } else if (tool === TOOLS.CIRCLE) {
      setShapes((prev) => {
        const lastShape = prev[prev.length - 1];
        if (!lastShape || lastShape.type !== 'ellipse') return prev;
        let width = Math.abs(pos.x - lastShape.x) * 2;
        let height = Math.abs(pos.y - lastShape.y) * 2;

        if (e.evt.ctrlKey || e.evt.metaKey) {
          const dx = pos.x - lastShape.x;
          const dy = pos.y - lastShape.y;
          const radius = Math.sqrt(dx * dx + dy * dy);
          width = radius * 2;
          height = radius * 2;
        }
        const updated = { ...lastShape, width, height };
        sendBoardOp({ type: 'upsert-shape', item: updated }, true);
        const next = [...prev];
        next[next.length - 1] = updated;
        return next;
      });
    } else if (tool === TOOLS.RECTANGLE) {
      setShapes((prev) => {
        const lastShape = prev[prev.length - 1];
        if (!lastShape || lastShape.type !== 'rectangle') return prev;
        let width = pos.x - lastShape.x;
        let height = pos.y - lastShape.y;

        if (e.evt.ctrlKey || e.evt.metaKey) {
          const size = Math.max(Math.abs(width), Math.abs(height));
          width = width < 0 ? -size : size;
          height = height < 0 ? -size : size;
        }
        const updated = { ...lastShape, width, height };
        sendBoardOp({ type: 'upsert-shape', item: updated }, true);
        const next = [...prev];
        next[next.length - 1] = updated;
        return next;
      });
    } else {
      setLines((prev) => {
        const lastLine = prev[prev.length - 1];
        if (!lastLine) return prev;
        const updated = {
          ...lastLine,
          points: [...lastLine.points, pos.x, pos.y],
        };
        sendBoardOp({ type: 'upsert-line', item: updated }, true);
        const next = [...prev];
        next[next.length - 1] = updated;
        return next;
      });
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    activeDrawingIdRef.current = null;

    if (tool === TOOLS.AREA_ERASER && currentLasso.length > 4) {
      const lassoShape: ShapeData = {
        id: uuidv4(),
        type: 'area_eraser',
        x: 0,
        y: 0,
        points: currentLasso,
        color: '#ffffff',
        strokeWidth: 0,
        timestamp: Date.now(),
      };
      setShapes((prev) => [...prev, lassoShape]);
      sendBoardOp({ type: 'upsert-shape', item: lassoShape });
      setSelectedId(null);
    }

    if (tool === TOOLS.AREA_ERASER) {
      setCurrentLasso([]);
    }

    if (tool === TOOLS.CIRCLE) {
      setShapes((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.type === 'ellipse') {
          sendBoardOp({ type: 'upsert-shape', item: last });
        }
        return prev;
      });
    }

    if (tool === TOOLS.RECTANGLE) {
      setShapes((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.type !== 'rectangle') return prev;
        const w = last.width || 0;
        const h = last.height || 0;
        const normX = w < 0 ? last.x + w : last.x;
        const normY = h < 0 ? last.y + h : last.y;
        const updated: ShapeData = {
          ...last,
          x: normX,
          y: normY,
          width: Math.abs(w),
          height: Math.abs(h),
        };
        sendBoardOp({ type: 'upsert-shape', item: updated });
        const next = [...prev];
        next[next.length - 1] = updated;
        return next;
      });
    }

    if (tool === TOOLS.LINE) {
      setShapes((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.type !== 'line' || !last.points) return prev;
        const xs = last.points.filter((_, i) => i % 2 === 0);
        const ys = last.points.filter((_, i) => i % 2 === 1);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const updated: ShapeData = {
          ...last,
          x: minX,
          y: minY,
          points: last.points.map((p, i) => (i % 2 === 0 ? p - minX : p - minY)),
        };
        sendBoardOp({ type: 'upsert-shape', item: updated });
        const next = [...prev];
        next[next.length - 1] = updated;
        return next;
      });
    }

    if (tool === TOOLS.PEN || tool === TOOLS.MARKER || tool === TOOLS.ERASER) {
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return prev;
        if (last.tool === TOOLS.ERASER) {
          sendBoardOp({ type: 'upsert-line', item: last });
          return prev;
        }
        if ((last.x && last.x !== 0) || (last.y && last.y !== 0)) {
          sendBoardOp({ type: 'upsert-line', item: last });
          return prev;
        }
        const xs = last.points.filter((_, i) => i % 2 === 0);
        const ys = last.points.filter((_, i) => i % 2 === 1);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const updated: LineData = {
          ...last,
          x: minX,
          y: minY,
          points: last.points.map((p, i) => (i % 2 === 0 ? p - minX : p - minY)),
        };
        sendBoardOp({ type: 'upsert-line', item: updated });
        const next = [...prev];
        next[next.length - 1] = updated;
        return next;
      });
    }

    setShouldSaveHistory(true);
  };

  const handleTextSubmit = (e?: React.FocusEvent) => {
    if (e && e.type === 'blur') {
      if (Date.now() - (textInput as any)._createdAt < 120) return;
    }
    if (!textInput) return;
    if (textInput.value.trim() && effectiveCanWrite) {
      const newText: TextData = {
        id: uuidv4(),
        x: textInput.x,
        y: textInput.y,
        text: textInput.value,
        color: color,
        fontSize: 20,
        timestamp: Date.now(),
      };
      setTexts((prev) => [...prev, newText]);
      sendBoardOp({ type: 'upsert-text', item: newText });
      setShouldSaveHistory(true);
    }
    setTextInput(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  };

  const clearBoard = () => {
    if (!effectiveCanWrite) return;
    images.forEach((m) => {
      if (m.mediaType === 'video' && m.element instanceof HTMLVideoElement) {
        m.element.pause();
      }
    });
    setLines([]);
    setTexts([]);
    setShapes([]);
    setImages([]);
    setSelectedId(null);
    setShouldSaveHistory(true);
    sendBoardOp({ type: 'clear-board' });
  };

  const downloadImage = () => {
    if (stageRef.current) {
      if (mediaTransformerRef.current) mediaTransformerRef.current.hide();
      if (annotationTransformerRef.current) annotationTransformerRef.current.hide();

      const uri = stageRef.current.toDataURL({
        x: stagePos.x,
        y: stagePos.y,
        width: pageWidth * stageScale,
        height: pageHeight * stageScale,
        pixelRatio: 2,
      });

      if (mediaTransformerRef.current) mediaTransformerRef.current.show();
      if (annotationTransformerRef.current) annotationTransformerRef.current.show();

      const link = document.createElement('a');
      link.download = 'whiteboard.png';
      link.href = uri;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!effectiveCanWrite) return;
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.type === 'application/pdf') {
      const url = URL.createObjectURL(file);
      const loadingTask = pdfjsLib.getDocument({ url } as any);
      const pdf = await loadingTask.promise;
      let yOffset = Math.max(40, -stagePos.y / stageScale + 40);
      const addedPages: MediaData[] = [];

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.4 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({
          canvasContext: context,
          viewport: viewport,
        } as any).promise;

        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const img = new window.Image();
        img.src = dataUrl;

        await new Promise((resolve) => {
          img.onload = () => {
            const maxW = Math.min(820, baseViewport.width * 0.75);
            const scale = Math.min(maxW / img.width, 1);
            const width = img.width * scale;
            const height = img.height * scale;
            const xPos = Math.max(20, (-stagePos.x + stageSize.width / 2) / stageScale - width / 2);

            const pageItem: MediaData = {
              id: uuidv4(),
              mediaType: 'pdf',
              element: img,
              src: dataUrl,
              x: xPos,
              y: yOffset,
              width,
              height,
              timestamp: Date.now() + pageNum,
              isLocked: true,
            };
            addedPages.push(pageItem);
            const serialized = serializeMediaItem(pageItem);
            if (serialized) sendBoardOp({ type: 'upsert-media', item: serialized });

            yOffset += height + 32;
            resolve(null);
          };
        });
      }

      if (yOffset + 40 > pageHeight) {
        const neededRows = Math.ceil((yOffset + 40) / baseViewport.height);
        const nextRows = Math.min(20, Math.max(pageRows, neededRows));
        setPageRows(nextRows);
        sendBoardOp({ type: 'page-resize', pageCols, pageRows: nextRows });
      }

      setImages((prev) => [...prev, ...addedPages]);
      setShouldSaveHistory(true);
    } else if (file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.src = url;
      video.loop = true;
      video.muted = false;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';

      video.onloadedmetadata = () => {
        video.currentTime = 0.01;
      };

      video.onloadeddata = () => {
        const maxW = 460;
        const vidW = video.videoWidth || 400;
        const vidH = video.videoHeight || 240;
        const scale = Math.min(maxW / vidW, maxW / vidH, 1);
        const width = vidW * scale;
        const height = vidH * scale;
        const pos = getViewportCenterOnPage(width, height);
        const id = uuidv4();

        setImages((prev) => [
          ...prev,
          {
            id,
            mediaType: 'video',
            element: video,
            x: pos.x,
            y: pos.y,
            width,
            height,
            timestamp: Date.now(),
            isLocked: false,
            isPlaying: false,
            isMuted: false,
          },
        ]);
        setTool(TOOLS.SELECT);
        setSelectedId(id);
        setShouldSaveHistory(true);
      };
    } else {
      const img = new window.Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const maxSize = 360;
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const width = img.width * scale;
        const height = img.height * scale;
        const pos = getViewportCenterOnPage(width, height);
        const id = uuidv4();
        const dataUrl = imageToDataUrl(img);

        const mediaItem: MediaData = {
          id,
          mediaType: 'image',
          element: img,
          src: dataUrl,
          x: pos.x,
          y: pos.y,
          width,
          height,
          timestamp: Date.now(),
          isLocked: false,
        };

        setImages((prev) => [...prev, mediaItem]);
        setTool(TOOLS.SELECT);
        setSelectedId(id);
        setShouldSaveHistory(true);

        const serialized = serializeMediaItem(mediaItem);
        if (serialized) sendBoardOp({ type: 'upsert-media', item: serialized });
      };
    }
  };

  const handleDragEnd = (e: any, id: string, type: 'line' | 'shape' | 'text' | 'image') => {
    e.cancelBubble = true;
    if (!effectiveCanWrite) return;
    const node = e.target;
    const newX = node.x();
    const newY = node.y();

    if (type === 'shape') {
      setShapes((prev) =>
        prev.map((s) => {
          if (s.id === id) {
            const updated = { ...s, x: newX, y: newY };
            sendBoardOp({ type: 'upsert-shape', item: updated });
            return updated;
          }
          return s;
        })
      );
    } else if (type === 'text') {
      setTexts((prev) =>
        prev.map((t) => {
          if (t.id === id) {
            const updated = { ...t, x: newX, y: newY };
            sendBoardOp({ type: 'upsert-text', item: updated });
            return updated;
          }
          return t;
        })
      );
    } else if (type === 'image') {
      setImages((prev) =>
        prev.map((i) => {
          if (i.id === id) {
            const updated = { ...i, x: newX, y: newY };
            const serialized = serializeMediaItem(updated);
            if (serialized) sendBoardOp({ type: 'upsert-media', item: serialized });
            return updated;
          }
          return i;
        })
      );
    } else if (type === 'line') {
      setLines((prev) =>
        prev.map((l) => {
          if (l.id === id) {
            const updated = { ...l, x: newX, y: newY };
            sendBoardOp({ type: 'upsert-line', item: updated });
            return updated;
          }
          return l;
        })
      );
    }
    setShouldSaveHistory(true);
  };

  const handleTransformEnd = (e: any, id: string, type: 'shape' | 'text' | 'image' | 'line') => {
    e.cancelBubble = true;
    if (!effectiveCanWrite) return;
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    if (type === 'shape') {
      setShapes((prev) =>
        prev.map((s) => {
          if (s.id === id) {
            let updated = { ...s, x: node.x(), y: node.y() };
            if (s.type === 'rectangle' || s.type === 'circle' || s.type === 'ellipse') {
              updated = {
                ...s,
                x: node.x(),
                y: node.y(),
                width: Math.max(5, (s.width || 0) * scaleX),
                height: Math.max(5, (s.height || 0) * scaleY),
              };
            } else if (s.type === 'line' && s.points) {
              updated = {
                ...s,
                x: node.x(),
                y: node.y(),
                points: s.points.map((p, idx) => (idx % 2 === 0 ? p * scaleX : p * scaleY)),
              };
            }
            sendBoardOp({ type: 'upsert-shape', item: updated });
            return updated;
          }
          return s;
        })
      );
    } else if (type === 'text') {
      setTexts((prev) =>
        prev.map((t) => {
          if (t.id === id) {
            const updated = {
              ...t,
              x: node.x(),
              y: node.y(),
              fontSize: Math.max(8, t.fontSize * scaleX),
            };
            sendBoardOp({ type: 'upsert-text', item: updated });
            return updated;
          }
          return t;
        })
      );
    } else if (type === 'image') {
      setImages((prev) =>
        prev.map((i) => {
          if (i.id === id) {
            const updated = {
              ...i,
              x: node.x(),
              y: node.y(),
              width: Math.max(24, i.width * scaleX),
              height: Math.max(24, i.height * scaleY),
            };
            const serialized = serializeMediaItem(updated);
            if (serialized) sendBoardOp({ type: 'upsert-media', item: serialized });
            return updated;
          }
          return i;
        })
      );
    } else if (type === 'line') {
      setLines((prev) =>
        prev.map((l) => {
          if (l.id === id) {
            const newPoints = l.points.map((p, i) => (i % 2 === 0 ? p * scaleX : p * scaleY));
            const updated = { ...l, x: node.x(), y: node.y(), points: newPoints };
            sendBoardOp({ type: 'upsert-line', item: updated });
            return updated;
          }
          return l;
        })
      );
    }

    setShouldSaveHistory(true);
  };

  const bringToFront = (id: string) => {
    if (!effectiveCanWrite) return;
    const maxTimestamp = Math.max(
      ...lines.map((l) => l.timestamp),
      ...shapes.map((s) => s.timestamp),
      ...texts.map((t) => t.timestamp),
      ...images.map((i) => i.timestamp),
      0
    );
    const nextTs = maxTimestamp + 1;
    setLines((prev) =>
      prev.map((l) => {
        if (l.id === id) {
          const updated = { ...l, timestamp: nextTs };
          sendBoardOp({ type: 'upsert-line', item: updated });
          return updated;
        }
        return l;
      })
    );
    setShapes((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          const updated = { ...s, timestamp: nextTs };
          sendBoardOp({ type: 'upsert-shape', item: updated });
          return updated;
        }
        return s;
      })
    );
    setTexts((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const updated = { ...t, timestamp: nextTs };
          sendBoardOp({ type: 'upsert-text', item: updated });
          return updated;
        }
        return t;
      })
    );
    setImages((prev) =>
      prev.map((i) => {
        if (i.id === id) {
          const updated = { ...i, timestamp: nextTs };
          const serialized = serializeMediaItem(updated);
          if (serialized) sendBoardOp({ type: 'upsert-media', item: serialized });
          return updated;
        }
        return i;
      })
    );
    setShouldSaveHistory(true);
  };

  const sendToBack = (id: string) => {
    if (!effectiveCanWrite) return;
    const minTimestamp = Math.min(
      ...lines.map((l) => l.timestamp),
      ...shapes.map((s) => s.timestamp),
      ...texts.map((t) => t.timestamp),
      ...images.map((i) => i.timestamp),
      Date.now()
    );
    const nextTs = minTimestamp - 1;
    setLines((prev) =>
      prev.map((l) => {
        if (l.id === id) {
          const updated = { ...l, timestamp: nextTs };
          sendBoardOp({ type: 'upsert-line', item: updated });
          return updated;
        }
        return l;
      })
    );
    setShapes((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          const updated = { ...s, timestamp: nextTs };
          sendBoardOp({ type: 'upsert-shape', item: updated });
          return updated;
        }
        return s;
      })
    );
    setTexts((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const updated = { ...t, timestamp: nextTs };
          sendBoardOp({ type: 'upsert-text', item: updated });
          return updated;
        }
        return t;
      })
    );
    setImages((prev) =>
      prev.map((i) => {
        if (i.id === id) {
          const updated = { ...i, timestamp: nextTs };
          const serialized = serializeMediaItem(updated);
          if (serialized) sendBoardOp({ type: 'upsert-media', item: serialized });
          return updated;
        }
        return i;
      })
    );
    setShouldSaveHistory(true);
  };

  const copyShareInfo = (type: 'link' | 'code') => {
    if (!roomCode) return;
    const text =
      type === 'link'
        ? `${window.location.origin}${window.location.pathname}?room=${roomCode}`
        : roomCode;
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const selectedMedia = images.find((i) => i.id === selectedId);
  const selectedShape = shapes.find((s) => s.id === selectedId);
  const selectedText = texts.find((t) => t.id === selectedId);
  const selectedLine = lines.find((l) => l.id === selectedId);
  const selectedEntity: any = selectedMedia || selectedShape || selectedText || selectedLine;

  return (
    <div className="relative w-full h-screen bg-slate-200 overflow-hidden flex flex-col select-none">
      {/* Top Toolbar */}
      <div className="absolute top-3 left-1/2 transform -translate-x-1/2 bg-white/95 backdrop-blur shadow-md rounded-xl p-1.5 flex items-center gap-1 z-20 border border-gray-200">
        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5 pr-1 border-r border-gray-200">
          <button
            onClick={undo}
            disabled={historyStep === 0 || !effectiveCanWrite}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors disabled:opacity-30"
            title="Undo (Ctrl+Z)"
          >
            <Undo size={18} />
          </button>
          <button
            onClick={redo}
            disabled={historyStep === history.length - 1 || !effectiveCanWrite}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors disabled:opacity-30"
            title="Redo (Ctrl+Y)"
          >
            <Redo size={18} />
          </button>
        </div>

        {/* Drawing & Selection Tools */}
        <div className="flex items-center gap-0.5 pr-1 border-r border-gray-200">
          <button
            onClick={() => {
              const nextLocked = !isPageLocked;
              setIsPageLocked(nextLocked);
              if (nextLocked && tool === TOOLS.PAN && effectiveCanWrite) {
                setTool(TOOLS.PEN);
              }
            }}
            className={`p-1.5 rounded-lg transition-colors ${
              isPageLocked ? 'bg-amber-100 text-amber-700' : 'hover:bg-gray-100 text-gray-600'
            }`}
            title={isPageLocked ? 'Page Locked (Click to unlock)' : 'Page Unlocked (Click to lock)'}
          >
            {isPageLocked ? <Lock size={18} /> : <Unlock size={18} />}
          </button>
          <button
            onClick={() => {
              setIsPageLocked(false);
              setTool(TOOLS.PAN);
            }}
            className={`p-1.5 rounded-lg transition-colors ${
              tool === TOOLS.PAN ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="Pan"
          >
            <Hand size={18} />
          </button>
          <button
            onClick={() => effectiveCanWrite && setTool(TOOLS.SELECT)}
            disabled={!effectiveCanWrite}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${
              tool === TOOLS.SELECT ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="Select (V)"
          >
            <MousePointer2 size={18} />
          </button>
          <button
            onClick={() => effectiveCanWrite && setTool(TOOLS.PEN)}
            disabled={!effectiveCanWrite}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${
              tool === TOOLS.PEN ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="Pen (P)"
          >
            <Pen size={18} />
          </button>
          <button
            onClick={() => effectiveCanWrite && setTool(TOOLS.MARKER)}
            disabled={!effectiveCanWrite}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${
              tool === TOOLS.MARKER ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="Marker (M)"
          >
            <Highlighter size={18} />
          </button>
          <button
            onClick={() => effectiveCanWrite && setTool(TOOLS.ERASER)}
            disabled={!effectiveCanWrite}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${
              tool === TOOLS.ERASER ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="Eraser (E)"
          >
            <Eraser size={18} />
          </button>
          <button
            onClick={() => effectiveCanWrite && setTool(TOOLS.AREA_ERASER)}
            disabled={!effectiveCanWrite}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${
              tool === TOOLS.AREA_ERASER ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="Area Eraser (R)"
          >
            <Scissors size={18} />
          </button>
          <button
            onClick={() => effectiveCanWrite && setTool(TOOLS.TEXT)}
            disabled={!effectiveCanWrite}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${
              tool === TOOLS.TEXT ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="Text (T)"
          >
            <Type size={18} />
          </button>
          <button
            onClick={() => effectiveCanWrite && setTool(TOOLS.LINE)}
            disabled={!effectiveCanWrite}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${
              tool === TOOLS.LINE ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="Line (L)"
          >
            <Minus size={18} />
          </button>
          <button
            onClick={() => effectiveCanWrite && setTool(TOOLS.RECTANGLE)}
            disabled={!effectiveCanWrite}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${
              tool === TOOLS.RECTANGLE ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="Rectangle / Polygon (A)"
          >
            <Square size={18} />
          </button>
          <button
            onClick={() => effectiveCanWrite && setTool(TOOLS.CIRCLE)}
            disabled={!effectiveCanWrite}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${
              tool === TOOLS.CIRCLE ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="Circle / Ellipse (C)"
          >
            <Circle size={18} />
          </button>
          <label
            className={`p-1.5 rounded-lg transition-colors ${
              effectiveCanWrite
                ? 'hover:bg-gray-100 text-gray-600 cursor-pointer'
                : 'opacity-30 pointer-events-none text-gray-400'
            }`}
            title="Upload PDF, Image, or Video"
          >
            <ImageIcon size={18} />
            <input
              type="file"
              accept="image/*,video/*,application/pdf"
              className="hidden"
              disabled={!effectiveCanWrite}
              onChange={handleMediaUpload}
            />
          </label>
        </div>

        {/* Color Palette */}
        <div className="flex items-center gap-1.5 px-1.5 border-r border-gray-200">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => effectiveCanWrite && setColor(c)}
              disabled={!effectiveCanWrite}
              className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-40 ${
                color === c ? 'border-gray-400 scale-110' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>

        {/* Compact Page Expansion Buttons (+100% VH & +100% VW) */}
        <div className="flex items-center gap-0.5 pr-1 border-r border-gray-200">
          <button
            onClick={expandVertically}
            disabled={!effectiveCanWrite}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors disabled:opacity-30"
            title={`Expand Vertically +100% VH (${pageRows * 100}% VH)`}
          >
            <ArrowDownToLine size={18} />
          </button>
          <button
            onClick={expandHorizontally}
            disabled={!effectiveCanWrite}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors disabled:opacity-30"
            title={`Expand Horizontally +100% VW (${pageCols * 100}% VW)`}
          >
            <ArrowRightToLine size={18} />
          </button>
        </div>

        {/* Board Actions & Live Collaboration Button */}
        <div className="flex items-center gap-0.5">
          {selectedId && effectiveCanWrite && (
            <button
              onClick={deleteSelected}
              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors"
              title="Delete Selected"
            >
              <X size={18} />
            </button>
          )}
          <button
            onClick={clearBoard}
            disabled={!effectiveCanWrite}
            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors disabled:opacity-30"
            title="Clear Board"
          >
            <Trash2 size={18} />
          </button>
          <button
            onClick={downloadImage}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
            title="Download"
          >
            <Download size={18} />
          </button>

          {/* Compact Live Host / Share / Permissions Button */}
          <button
            onClick={() => setShowCollabPanel((prev) => !prev)}
            className={`p-1.5 rounded-lg flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
              roomCode
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : showCollabPanel
                ? 'bg-blue-100 text-blue-600'
                : 'hover:bg-gray-100 text-gray-600'
            }`}
            title={roomCode ? `Live Session (${roomCode}) — Manage Permissions` : 'Host or Join Live Board'}
          >
            <Users size={18} />
            {roomCode && (
              <span className="text-xs font-mono tabular-nums font-semibold pr-0.5">
                {participants.length}
              </span>
            )}
          </button>
        </div>

        {/* Guest View-Only Status Indicator */}
        {roomCode && !effectiveCanWrite && (
          <div
            className="flex items-center gap-1 pl-1.5 border-l border-gray-200 text-xs font-medium text-amber-700 whitespace-nowrap shrink-0"
            title="Wait for the host to grant you write permission"
          >
            <Eye size={14} />
            <span>View Only</span>
          </div>
        )}

        {tool === TOOLS.PEN && effectiveCanWrite && (
          <div className="flex items-center gap-1.5 pl-1.5 border-l border-gray-200">
            <input
              type="range"
              min="1"
              max="20"
              value={penThickness}
              onChange={(e) => setPenThickness(Number(e.target.value))}
              className="w-20 accent-blue-500"
              title={`Pen Size: ${penThickness}`}
            />
          </div>
        )}
      </div>

      {/* Collaboration & Permissions Popover */}
      {showCollabPanel && (
        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 w-80 bg-white/95 backdrop-blur shadow-xl rounded-xl border border-slate-200 p-4 z-30 text-slate-900">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              {roomCode ? 'Live Session & Permissions' : 'Host or Join Board'}
            </h3>
            <button
              onClick={() => setShowCollabPanel(false)}
              className="p-1 rounded-md hover:bg-slate-100 text-slate-500"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>

          {!roomCode ? (
            <div className="pt-3 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Your Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your name..."
                  maxLength={32}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:border-blue-600"
                />
              </div>

              <button
                onClick={() => connectToSession('create')}
                disabled={isConnectingRoom}
                className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                {isConnectingRoom ? 'Starting Session...' : 'Host Live Board'}
              </button>

              <div className="pt-3 border-t border-slate-200">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Join Existing Room Code
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    placeholder="6-digit code"
                    maxLength={8}
                    className="flex-1 px-3 py-1.5 text-sm font-mono uppercase rounded-lg border border-slate-300 focus:outline-none focus:border-blue-600"
                  />
                  <button
                    onClick={() => {
                      if (joinCodeInput.trim()) {
                        connectToSession('join', joinCodeInput.trim());
                      }
                    }}
                    disabled={!joinCodeInput.trim() || isConnectingRoom}
                    className="py-2 px-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    Join
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="pt-3 space-y-3">
              {/* Room Code & Share Actions */}
              <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                <div>
                  <div className="text-[11px] text-slate-500">Room Code</div>
                  <div className="text-sm font-mono tabular-nums font-semibold tracking-wider text-slate-900">
                    {roomCode}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => copyShareInfo('code')}
                    className="px-2.5 py-1.5 text-xs font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-md flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                    title="Copy Room Code"
                  >
                    {copiedType === 'code' ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                    <span>{copiedType === 'code' ? 'Copied' : 'Code'}</span>
                  </button>
                  <button
                    onClick={() => copyShareInfo('link')}
                    className="px-2.5 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                    title="Copy Shareable Invite Link"
                  >
                    {copiedType === 'link' ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedType === 'link' ? 'Copied' : 'Share Link'}</span>
                  </button>
                </div>
              </div>

              {/* Host Global Lock Control */}
              {isHost && (
                <div className="flex items-center justify-between py-2 px-1 border-b border-slate-200">
                  <div className="text-xs">
                    <div className="font-semibold text-slate-800">Lock All Guests</div>
                    <div className="text-[11px] text-slate-500">Force View-Only for everyone</div>
                  </div>
                  <button
                    onClick={() => handleToggleGlobalLock(!allGuestsLocked)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                      allGuestsLocked
                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {allGuestsLocked ? <Lock size={13} /> : <Unlock size={13} />}
                    <span>{allGuestsLocked ? 'All Locked' : 'Unlocked'}</span>
                  </button>
                </div>
              )}

              {/* Active Participants & Individual Write Permissions */}
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                  <span>Participants ({participants.length})</span>
                  <span>Permission</span>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {participants.map((p) => {
                    const isMe = p.userId === userId;
                    return (
                      <div
                        key={p.userId}
                        className="h-9 px-2.5 flex items-center justify-between gap-2 text-xs hover:bg-slate-50"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: p.color }}
                          />
                          <span className="font-medium text-slate-800 truncate">
                            {p.name}
                            {isMe ? ' (You)' : ''}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {p.isHost ? (
                            <span className="text-[11px] text-slate-500 flex items-center gap-1 px-1.5">
                              <Shield size={12} className="text-blue-600" />
                              <span>Host</span>
                            </span>
                          ) : isHost ? (
                            <>
                              <button
                                onClick={() => handleToggleUserWrite(p.userId, !p.canWrite)}
                                className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                                  p.effectiveCanWrite
                                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                                title={
                                  p.canWrite
                                    ? 'Click to revoke write permission (switch to View-Only)'
                                    : 'Click to grant write permission'
                                }
                              >
                                {p.effectiveCanWrite ? <Edit3 size={11} /> : <Eye size={11} />}
                                <span>{p.effectiveCanWrite ? 'Can Write' : 'View Only'}</span>
                              </button>
                              <button
                                onClick={() => handleKickParticipant(p.userId)}
                                className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                                title={`Remove ${p.name} from board`}
                              >
                                <UserX size={13} />
                              </button>
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-500 flex items-center gap-1 px-1.5">
                              {p.effectiveCanWrite ? (
                                <>
                                  <Edit3 size={11} className="text-emerald-600" />
                                  <span>Can Write</span>
                                </>
                              ) : (
                                <>
                                  <Eye size={11} className="text-amber-600" />
                                  <span>View Only</span>
                                </>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => leaveSession(true)}
                className="w-full py-1.5 px-3 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
              >
                <LogOut size={14} />
                <span>Leave Session</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Join Shared Room Prompt Modal (when opening ?room=CODE link) */}
      {pendingUrlRoom && !roomCode && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-5 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Join Shared Whiteboard</h2>
              <button
                onClick={() => setPendingUrlRoom(null)}
                className="p-1 rounded-md hover:bg-slate-100 text-slate-500"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              You are joining room <span className="font-mono font-semibold text-slate-900">{pendingUrlRoom}</span>.
              Guests join in View-Only mode until the host grants write permission.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Your Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    connectToSession('join', pendingUrlRoom, displayName || 'Guest');
                  }
                }}
                placeholder="Enter your name..."
                autoFocus
                maxLength={32}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setPendingUrlRoom(null)}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => connectToSession('join', pendingUrlRoom, displayName || 'Guest')}
                disabled={isConnectingRoom}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
              >
                {isConnectingRoom ? 'Joining...' : 'Join Board'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute bottom-5 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white text-xs font-medium px-3.5 py-2 rounded-lg shadow-lg z-40 pointer-events-none">
          {toastMessage}
        </div>
      )}

      {/* Compact Icon-Only Floating Bar for Selected Element */}
      {effectiveCanWrite && tool === TOOLS.SELECT && selectedEntity && (
        <div
          className="absolute z-30 bg-white shadow-md rounded-lg p-1 border border-gray-200 flex items-center gap-0.5"
          style={{
            left: Math.max(
              12,
              Math.min(
                stageSize.width - 160,
                (selectedEntity.x || 0) * stageScale + stagePos.x
              )
            ),
            top: Math.max(
              60,
              Math.min(
                stageSize.height - 48,
                (selectedEntity.y || 0) * stageScale + stagePos.y - 38
              )
            ),
          }}
        >
          {selectedMedia?.mediaType === 'video' && (
            <>
              <button
                onClick={() => toggleVideoPlay(selectedMedia.id)}
                className="p-1.5 rounded hover:bg-gray-100 text-gray-700"
                title={selectedMedia.isPlaying ? 'Pause' : 'Play'}
              >
                {selectedMedia.isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                onClick={() => toggleVideoMute(selectedMedia.id)}
                className="p-1.5 rounded hover:bg-gray-100 text-gray-700"
                title={selectedMedia.isMuted ? 'Unmute' : 'Mute'}
              >
                {selectedMedia.isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
            </>
          )}

          <button
            onClick={() => toggleLockItem(selectedEntity.id)}
            className={`p-1.5 rounded transition-colors ${
              selectedEntity.isLocked
                ? 'bg-amber-100 text-amber-700'
                : 'hover:bg-gray-100 text-gray-700'
            }`}
            title={selectedEntity.isLocked ? 'Unlock Element' : 'Lock Element'}
          >
            {selectedEntity.isLocked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>

          <button
            onClick={() => bringToFront(selectedEntity.id)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-700"
            title="Bring to Front"
          >
            <Layers size={14} />
          </button>

          <button
            onClick={deleteSelected}
            className="p-1.5 rounded hover:bg-red-50 text-red-600"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {/* Canvas Container */}
      <div
        className={`flex-1 w-full h-full relative touch-none ${
          tool === TOOLS.PAN && !isPageLocked
            ? 'cursor-grab active:cursor-grabbing'
            : !effectiveCanWrite
            ? 'cursor-default'
            : 'cursor-crosshair'
        }`}
        ref={containerRef}
      >
        <Stage
          width={stageSize.width}
          height={stageSize.height}
          x={stagePos.x}
          y={stagePos.y}
          scaleX={stageScale}
          scaleY={stageScale}
          draggable={tool === TOOLS.PAN && !isPageLocked}
          dragBoundFunc={(pos) => clampStagePos(pos)}
          onDragMove={(e) => {
            if (e.target === e.target.getStage()) {
              const clamped = clampStagePos({ x: e.target.x(), y: e.target.y() });
              e.target.position(clamped);
            }
          }}
          onDragEnd={(e) => {
            if (e.target === e.target.getStage()) {
              setStagePos(clampStagePos({ x: e.target.x(), y: e.target.y() }));
            }
          }}
          onWheel={(e) => {
            e.evt.preventDefault();
            if (isPageLocked) return;

            const stage = e.target.getStage();
            if (!stage) return;

            if (e.evt.ctrlKey || e.evt.metaKey) {
              const scaleBy = 1.05;
              const oldScale = stage.scaleX();
              const pointer = stage.getPointerPosition();
              if (!pointer) return;
              const mousePointTo = {
                x: (pointer.x - stage.x()) / oldScale,
                y: (pointer.y - stage.y()) / oldScale,
              };
              const unclampedScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
              const newScale = Math.max(0.5, Math.min(3, unclampedScale));
              const nextPos = {
                x: pointer.x - mousePointTo.x * newScale,
                y: pointer.y - mousePointTo.y * newScale,
              };
              setStageScale(newScale);
              setStagePos(clampStagePos(nextPos, newScale));
            } else {
              setStagePos((prev) =>
                clampStagePos({
                  x: prev.x - e.evt.deltaX,
                  y: prev.y - e.evt.deltaY,
                })
              );
            }
          }}
          onContextMenu={handleContextMenu}
          onPointerDown={handleMouseDown}
          onPointerMove={handleMouseMove}
          onPointerUp={handleMouseUp}
          ref={stageRef}
        >
          {/* Layer 1: Static Bounded Page Background & Section Dividers */}
          <Layer>
            <Rect
              name="background"
              x={0}
              y={0}
              width={pageWidth}
              height={pageHeight}
              fill="#ffffff"
              shadowColor="rgba(15, 23, 42, 0.18)"
              shadowBlur={16}
              shadowOffset={{ x: 0, y: 4 }}
            />
            {Array.from({ length: pageCols - 1 }).map((_, idx) => {
              const x = (idx + 1) * baseViewport.width;
              return (
                <Line
                  key={`col-guide-${idx}`}
                  name="page-grid"
                  points={[x, 0, x, pageHeight]}
                  stroke="#cbd5e1"
                  strokeWidth={1.5}
                  dash={[8, 8]}
                  listening={false}
                />
              );
            })}
            {Array.from({ length: pageRows - 1 }).map((_, idx) => {
              const y = (idx + 1) * baseViewport.height;
              return (
                <Line
                  key={`row-guide-${idx}`}
                  name="page-grid"
                  points={[0, y, pageWidth, y]}
                  stroke="#cbd5e1"
                  strokeWidth={1.5}
                  dash={[8, 8]}
                  listening={false}
                />
              );
            })}
          </Layer>

          {/* Layer 2: Dedicated Media Layer (PDFs, Images, Videos) */}
          <Layer
            ref={mediaLayerRef}
            clipX={0}
            clipY={0}
            clipWidth={pageWidth}
            clipHeight={pageHeight}
          >
            {[...images]
              .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
              .map((media) => {
                const isSelected = selectedId === media.id;
                const canInteract = effectiveCanWrite && tool === TOOLS.SELECT && !media.isPermanent;
                const canDrag = canInteract && !media.isLocked && isSelected;

                return (
                  <KonvaImage
                    key={media.id}
                    id={media.id}
                    image={media.element}
                    x={media.x}
                    y={media.y}
                    width={media.width}
                    height={media.height}
                    listening={canInteract}
                    draggable={canDrag}
                    dragDistance={6}
                    dragBoundFunc={(pos) => {
                      const localX = Math.max(
                        0,
                        Math.min(pageWidth - media.width, (pos.x - stagePos.x) / stageScale)
                      );
                      const localY = Math.max(
                        0,
                        Math.min(pageHeight - media.height, (pos.y - stagePos.y) / stageScale)
                      );
                      return {
                        x: localX * stageScale + stagePos.x,
                        y: localY * stageScale + stagePos.y,
                      };
                    }}
                    onClick={(e) => {
                      if (canInteract) {
                        e.cancelBubble = true;
                        setSelectedId(media.id);
                      }
                    }}
                    onTap={(e) => {
                      if (canInteract) {
                        e.cancelBubble = true;
                        setSelectedId(media.id);
                      }
                    }}
                    onDblClick={(e) => {
                      if (!canInteract) return;
                      e.cancelBubble = true;
                      if (media.mediaType === 'video') {
                        toggleVideoPlay(media.id);
                      } else {
                        toggleLockItem(media.id);
                      }
                    }}
                    onDragStart={(e) => {
                      e.cancelBubble = true;
                    }}
                    onDragEnd={(e) => handleDragEnd(e, media.id, 'image')}
                    onTransformEnd={(e) => handleTransformEnd(e, media.id, 'image')}
                  />
                );
              })}
            <Transformer
              ref={mediaTransformerRef}
              rotateEnabled={false}
              keepRatio={true}
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 30 || newBox.height < 30) return oldBox;
                return newBox;
              }}
            />
          </Layer>

          {/* Layer 3: Ink, Shapes, Text, and Remote Participant Cursors */}
          <Layer
            clipX={0}
            clipY={0}
            clipWidth={pageWidth}
            clipHeight={pageHeight}
          >
            {[
              ...lines.map((l) => ({ type: 'lineItem', item: l as any })),
              ...shapes.map((s) => ({ type: 'shapeItem', item: s as any })),
              ...texts.map((t) => ({ type: 'textItem', item: t as any })),
            ]
              .sort((a, b) => (a.item.timestamp || 0) - (b.item.timestamp || 0))
              .map((el) => {
                const canSelect = effectiveCanWrite && tool === TOOLS.SELECT;
                const canListen =
                  effectiveCanWrite && (tool === TOOLS.SELECT || tool === TOOLS.ERASER);
                const canDrag = canSelect && !el.item.isLocked && selectedId === el.item.id;

                if (el.type === 'lineItem') {
                  return (
                    <Line
                      key={el.item.id}
                      id={el.item.id}
                      x={el.item.x || 0}
                      y={el.item.y || 0}
                      points={el.item.points}
                      stroke={el.item.color}
                      strokeWidth={el.item.strokeWidth}
                      hitStrokeWidth={Math.max(16, el.item.strokeWidth)}
                      tension={0.5}
                      lineCap="round"
                      lineJoin="round"
                      opacity={el.item.tool === 'marker' ? 0.5 : 1}
                      globalCompositeOperation={
                        el.item.tool === 'eraser' ? 'destination-out' : 'source-over'
                      }
                      listening={el.item.tool === 'eraser' ? false : canListen}
                      draggable={canDrag}
                      dragDistance={5}
                      onClick={(e) => {
                        if (canSelect) {
                          e.cancelBubble = true;
                          setSelectedId(el.item.id);
                        }
                      }}
                      onTap={(e) => {
                        if (canSelect) {
                          e.cancelBubble = true;
                          setSelectedId(el.item.id);
                        }
                      }}
                      onDragStart={(e) => {
                        e.cancelBubble = true;
                      }}
                      onDragEnd={(e) => handleDragEnd(e, el.item.id, 'line')}
                      onTransformEnd={(e) => handleTransformEnd(e, el.item.id, 'line')}
                    />
                  );
                }
                if (el.type === 'shapeItem') {
                  if (el.item.type === 'line') {
                    return (
                      <Line
                        key={el.item.id}
                        id={el.item.id}
                        x={el.item.x || 0}
                        y={el.item.y || 0}
                        points={el.item.points || []}
                        stroke={el.item.color}
                        strokeWidth={el.item.strokeWidth}
                        hitStrokeWidth={Math.max(16, el.item.strokeWidth)}
                        lineCap="round"
                        lineJoin="round"
                        listening={canListen}
                        draggable={canDrag}
                        dragDistance={5}
                        onClick={(e) => {
                          if (canSelect) {
                            e.cancelBubble = true;
                            setSelectedId(el.item.id);
                          }
                        }}
                        onTap={(e) => {
                          if (canSelect) {
                            e.cancelBubble = true;
                            setSelectedId(el.item.id);
                          }
                        }}
                        onDragStart={(e) => {
                          e.cancelBubble = true;
                        }}
                        onDragEnd={(e) => handleDragEnd(e, el.item.id, 'shape')}
                        onTransformEnd={(e) => handleTransformEnd(e, el.item.id, 'shape')}
                      />
                    );
                  } else if (el.item.type === 'circle') {
                    return (
                      <KonvaCircle
                        key={el.item.id}
                        id={el.item.id}
                        x={el.item.x}
                        y={el.item.y}
                        radius={(el.item.width || 0) / 2}
                        stroke={el.item.color}
                        strokeWidth={el.item.strokeWidth}
                        hitStrokeWidth={16}
                        listening={canListen}
                        draggable={canDrag}
                        dragDistance={5}
                        onClick={(e) => {
                          if (canSelect) {
                            e.cancelBubble = true;
                            setSelectedId(el.item.id);
                          }
                        }}
                        onTap={(e) => {
                          if (canSelect) {
                            e.cancelBubble = true;
                            setSelectedId(el.item.id);
                          }
                        }}
                        onDragStart={(e) => {
                          e.cancelBubble = true;
                        }}
                        onDragEnd={(e) => handleDragEnd(e, el.item.id, 'shape')}
                        onTransformEnd={(e) => handleTransformEnd(e, el.item.id, 'shape')}
                      />
                    );
                  } else if (el.item.type === 'ellipse') {
                    return (
                      <KonvaEllipse
                        key={el.item.id}
                        id={el.item.id}
                        x={el.item.x}
                        y={el.item.y}
                        radiusX={(el.item.width || 0) / 2}
                        radiusY={(el.item.height || 0) / 2}
                        stroke={el.item.color}
                        strokeWidth={el.item.strokeWidth}
                        hitStrokeWidth={16}
                        listening={canListen}
                        draggable={canDrag}
                        dragDistance={5}
                        onClick={(e) => {
                          if (canSelect) {
                            e.cancelBubble = true;
                            setSelectedId(el.item.id);
                          }
                        }}
                        onTap={(e) => {
                          if (canSelect) {
                            e.cancelBubble = true;
                            setSelectedId(el.item.id);
                          }
                        }}
                        onDragStart={(e) => {
                          e.cancelBubble = true;
                        }}
                        onDragEnd={(e) => handleDragEnd(e, el.item.id, 'shape')}
                        onTransformEnd={(e) => handleTransformEnd(e, el.item.id, 'shape')}
                      />
                    );
                  } else if (el.item.type === 'rectangle') {
                    const sides = el.item.sides || 4;
                    if (sides !== 4) {
                      const getPolygonPoints = (sidesCount: number, w: number, h: number) => {
                        const pts = [];
                        const rx = Math.abs(w) / 2;
                        const ry = Math.abs(h) / 2;
                        const cx = w / 2;
                        const cy = h / 2;
                        for (let i = 0; i < sidesCount; i++) {
                          const angle = (i * 2 * Math.PI) / sidesCount - Math.PI / 2;
                          pts.push(cx + rx * Math.cos(angle));
                          pts.push(cy + ry * Math.sin(angle));
                        }
                        return pts;
                      };
                      return (
                        <Line
                          key={el.item.id}
                          id={el.item.id}
                          x={el.item.x}
                          y={el.item.y}
                          points={getPolygonPoints(sides, el.item.width || 0, el.item.height || 0)}
                          closed={true}
                          stroke={el.item.color}
                          strokeWidth={el.item.strokeWidth}
                          hitStrokeWidth={16}
                          listening={canListen}
                          draggable={canDrag}
                          dragDistance={5}
                          onClick={(e) => {
                            if (canSelect) {
                              e.cancelBubble = true;
                              setSelectedId(el.item.id);
                            }
                          }}
                          onTap={(e) => {
                            if (canSelect) {
                              e.cancelBubble = true;
                              setSelectedId(el.item.id);
                            }
                          }}
                          onDragStart={(e) => {
                            e.cancelBubble = true;
                          }}
                          onDragEnd={(e) => handleDragEnd(e, el.item.id, 'shape')}
                          onTransformEnd={(e) => handleTransformEnd(e, el.item.id, 'shape')}
                        />
                      );
                    }

                    return (
                      <Rect
                        key={el.item.id}
                        id={el.item.id}
                        x={el.item.x}
                        y={el.item.y}
                        width={el.item.width || 0}
                        height={el.item.height || 0}
                        stroke={el.item.color}
                        strokeWidth={el.item.strokeWidth}
                        hitStrokeWidth={16}
                        listening={canListen}
                        draggable={canDrag}
                        dragDistance={5}
                        onClick={(e) => {
                          if (canSelect) {
                            e.cancelBubble = true;
                            setSelectedId(el.item.id);
                          }
                        }}
                        onTap={(e) => {
                          if (canSelect) {
                            e.cancelBubble = true;
                            setSelectedId(el.item.id);
                          }
                        }}
                        onDragStart={(e) => {
                          e.cancelBubble = true;
                        }}
                        onDragEnd={(e) => handleDragEnd(e, el.item.id, 'shape')}
                        onTransformEnd={(e) => handleTransformEnd(e, el.item.id, 'shape')}
                      />
                    );
                  } else if (el.item.type === 'area_eraser') {
                    return (
                      <Line
                        key={el.item.id}
                        id={el.item.id}
                        points={el.item.points || []}
                        fill="#ffffff"
                        closed
                        listening={false}
                        globalCompositeOperation="destination-out"
                      />
                    );
                  }
                }
                if (el.type === 'textItem') {
                  return (
                    <KonvaText
                      key={el.item.id}
                      id={el.item.id}
                      x={el.item.x}
                      y={el.item.y}
                      text={el.item.text}
                      fontSize={el.item.fontSize}
                      fill={el.item.color}
                      fontFamily="Plus Jakarta Sans, sans-serif"
                      listening={canListen}
                      draggable={canDrag}
                      dragDistance={5}
                      onClick={(e) => {
                        if (canSelect) {
                          e.cancelBubble = true;
                          setSelectedId(el.item.id);
                        }
                      }}
                      onTap={(e) => {
                        if (canSelect) {
                          e.cancelBubble = true;
                          setSelectedId(el.item.id);
                        }
                      }}
                      onDragStart={(e) => {
                        e.cancelBubble = true;
                      }}
                      onDragEnd={(e) => handleDragEnd(e, el.item.id, 'text')}
                      onTransformEnd={(e) => handleTransformEnd(e, el.item.id, 'text')}
                    />
                  );
                }
                return null;
              })}

            {pointers.map((p) => (
              <Arrow
                key={p.id}
                points={[p.x + 20, p.y + 20, p.x, p.y]}
                pointerLength={10}
                pointerWidth={10}
                fill={p.color || '#000000'}
                stroke={p.color || '#000000'}
                strokeWidth={3}
                shadowColor="black"
                shadowBlur={2}
                shadowOffset={{ x: 1, y: 1 }}
                shadowOpacity={0.3}
                onContextMenu={(e) => {
                  e.cancelBubble = true;
                  e.evt.preventDefault();
                  setPointers((prev) => prev.filter((ptr) => ptr.id !== p.id));
                }}
              />
            ))}

            {/* Remote Participant Live Cursors */}
            {Object.entries(remoteCursors).map(([uid, cur]) => (
              <Group key={`cursor-${uid}`} x={cur.x} y={cur.y} listening={false}>
                <Arrow
                  points={[14, 14, 0, 0]}
                  pointerLength={8}
                  pointerWidth={8}
                  fill={cur.color}
                  stroke={cur.color}
                  strokeWidth={2}
                />
                <Rect
                  x={12}
                  y={14}
                  width={Math.max(44, cur.name.length * 7 + 12)}
                  height={20}
                  fill={cur.color}
                  cornerRadius={4}
                />
                <KonvaText
                  x={18}
                  y={18}
                  text={cur.name}
                  fontSize={11}
                  fontStyle="bold"
                  fill="#ffffff"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                />
              </Group>
            ))}

            {currentLasso.length > 0 && (
              <Line
                points={currentLasso}
                fill="rgba(239, 68, 68, 0.2)"
                stroke="#ef4444"
                strokeWidth={2}
                dash={[5, 5]}
                closed
                listening={false}
              />
            )}

            <Transformer ref={annotationTransformerRef} rotateEnabled={false} />
          </Layer>
        </Stage>

        {textInput && effectiveCanWrite && (
          <textarea
            ref={textInputRef}
            value={textInput.value}
            onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
            onBlur={handleTextSubmit}
            onKeyDown={handleKeyDown}
            style={{
              position: 'absolute',
              left: `${textInput.x * stageScale + stagePos.x}px`,
              top: `${textInput.y * stageScale + stagePos.y}px`,
              color: color,
              fontSize: `${20 * stageScale}px`,
              lineHeight: 1.2,
              fontFamily: 'Plus Jakarta Sans, sans-serif',
            }}
            className="bg-white/95 backdrop-blur-sm border-2 border-blue-500 rounded px-2 py-1 shadow-lg outline-none resize min-w-[150px] min-h-[40px] z-30"
            placeholder="Type here..."
          />
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && effectiveCanWrite && (
        <div
          className="fixed bg-white shadow-xl rounded-lg py-1 z-50 border border-gray-200 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            onClick={() => {
              toggleLockItem(contextMenu.id);
              setContextMenu(null);
            }}
          >
            {images.find((i) => i.id === contextMenu.id)?.isLocked ||
            shapes.find((s) => s.id === contextMenu.id)?.isLocked ||
            texts.find((t) => t.id === contextMenu.id)?.isLocked ||
            lines.find((l) => l.id === contextMenu.id)?.isLocked ? (
              <>
                <Unlock size={15} /> Unlock Element
              </>
            ) : (
              <>
                <Lock size={15} /> Lock Element
              </>
            )}
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            onClick={() => {
              bringToFront(contextMenu.id);
              setContextMenu(null);
            }}
          >
            Bring to Front
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            onClick={() => {
              sendToBack(contextMenu.id);
              setContextMenu(null);
            }}
          >
            Send to Back
          </button>
          <div className="h-px bg-gray-200 my-1" />
          <button
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            onClick={() => {
              deleteSelected();
              setContextMenu(null);
            }}
          >
            <Trash2 size={15} /> Delete
          </button>
        </div>
      )}

      {/* Info Button and Panel */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end">
        {showInfo && (
          <div className="bg-white/95 backdrop-blur shadow-xl rounded-xl p-4 mb-3 w-72 border border-gray-200 text-xs text-gray-600 space-y-2">
            <h3 className="font-bold text-gray-800 text-sm border-b pb-1 mb-2">
              Shortcuts & Controls
            </h3>
            <p>
              <strong>Live Collaboration:</strong> Click the <strong>Users</strong> icon in the toolbar to host a room or join with a 6-digit code. New guests join in View-Only mode until the host enables write access.
            </p>
            <p>
              <strong>Page Lock:</strong> Toggle the lock icon in the toolbar to freeze the page position while writing.
            </p>
            <p>
              <strong>Expand Page:</strong> Click the down/right arrow icons in the toolbar to add +100% VH or +100% VW.
            </p>
            <p>
              <strong>Media (PDF/Image/Video):</strong> Click once with Select (V) to show resize/lock controls, then drag. Double-click a video to play/pause.
            </p>
            <p>
              <strong>Polygons:</strong> Select Rectangle tool, press <strong>3–9</strong> to set sides. Hold <strong>Ctrl</strong> for regular shapes.
            </p>
          </div>
        )}
        <button
          onClick={() => setShowInfo(!showInfo)}
          className={`p-2.5 rounded-full shadow-lg border transition-colors ${
            showInfo
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white/90 backdrop-blur text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
          title="Shortcuts & Instructions"
        >
          <Info size={20} />
        </button>
      </div>
    </div>
  );
}

import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Line, Text as KonvaText, Rect, Circle as KonvaCircle, Ellipse as KonvaEllipse, Image as KonvaImage, Transformer, Arrow, Path, Group } from 'react-konva';
import { v4 as uuidv4 } from 'uuid';
import { TOOLS, ToolType, COLORS } from '../constants';
import { Eraser, Pen, Highlighter, Type, Trash2, Download, Circle, Minus, Image as ImageIcon, MousePointer2, X, Scissors, Square, Undo, Redo } from 'lucide-react';

interface LineData {
  id: string;
  tool: ToolType;
  x?: number;
  y?: number;
  points: number[];
  color: string;
  strokeWidth: number;
  timestamp: number;
}

interface TextData {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
  timestamp: number;
}

interface ShapeData {
  id: string;
  type: 'line' | 'circle' | 'rectangle' | 'ellipse' | 'area_eraser';
  x: number;
  y: number;
  width?: number; 
  height?: number;
  points?: number[]; 
  color: string;
  strokeWidth: number;
  timestamp: number;
}

interface ImageData {
  id: string;
  image: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
  timestamp: number;
}

interface HistoryState {
  lines: LineData[];
  shapes: ShapeData[];
  texts: TextData[];
  images: ImageData[];
}

export default function Whiteboard() {
  const [tool, setTool] = useState<ToolType>(TOOLS.PEN);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [penThickness, setPenThickness] = useState(2);
  
  const [lines, setLines] = useState<LineData[]>([]);
  const [texts, setTexts] = useState<TextData[]>([]);
  const [shapes, setShapes] = useState<ShapeData[]>([]);
  const [images, setImages] = useState<ImageData[]>([]);
  
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentLasso, setCurrentLasso] = useState<number[]>([]);
  const [pointers, setPointers] = useState<{x: number, y: number, color: string, id: string}[]>([]);
  
  const isDrawing = useRef(false);
  
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);

  // History state
  const [history, setHistory] = useState<HistoryState[]>([{ lines: [], shapes: [], texts: [], images: [] }]);
  const [historyStep, setHistoryStep] = useState(0);
  const [shouldSaveHistory, setShouldSaveHistory] = useState(false);

  // Text input state
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Canvas sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (textInput && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [textInput]);

  useEffect(() => {
    if (selectedId && transformerRef.current && stageRef.current) {
      const node = stageRef.current.findOne('#' + selectedId);
      if (node) {
        transformerRef.current.nodes([node]);
        transformerRef.current.getLayer().batchDraw();
      }
    } else if (transformerRef.current) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer().batchDraw();
    }
  }, [selectedId, texts, shapes, lines, images]); 

  useEffect(() => {
    if (shouldSaveHistory) {
      const nextHistory = history.slice(0, historyStep + 1);
      nextHistory.push({
        lines: lines.map(l => ({ ...l, points: [...l.points] })),
        shapes: shapes.map(s => ({ ...s, points: s.points ? [...s.points] : undefined })),
        texts: texts.map(t => ({ ...t })),
        images: images.map(i => ({ ...i })),
      });
      setHistory(nextHistory);
      setHistoryStep(nextHistory.length - 1);
      setShouldSaveHistory(false);
    }
  }, [shouldSaveHistory, lines, shapes, texts, images, history, historyStep]);

  const undo = () => {
    if (historyStep > 0) {
      const prevStep = historyStep - 1;
      const state = history[prevStep];
      setLines(state.lines.map(l => ({...l, points: [...l.points]})));
      setShapes(state.shapes.map(s => ({...s, points: s.points ? [...s.points] : undefined})));
      setTexts(state.texts.map(t => ({...t})));
      setImages(state.images.map(i => ({...i})));
      setHistoryStep(prevStep);
      setSelectedId(null);
    }
  };

  const redo = () => {
    if (historyStep < history.length - 1) {
      const nextStep = historyStep + 1;
      const state = history[nextStep];
      setLines(state.lines.map(l => ({...l, points: [...l.points]})));
      setShapes(state.shapes.map(s => ({...s, points: s.points ? [...s.points] : undefined})));
      setTexts(state.texts.map(t => ({...t})));
      setImages(state.images.map(i => ({...i})));
      setHistoryStep(nextStep);
      setSelectedId(null);
    }
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setLines((prev) => prev.filter((l) => l.id !== selectedId));
    setShapes((prev) => prev.filter((s) => s.id !== selectedId));
    setTexts((prev) => prev.filter((t) => t.id !== selectedId));
    setImages((prev) => prev.filter((i) => i.id !== selectedId));
    setSelectedId(null);
    setShouldSaveHistory(true);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (textInput) return; // Don't delete or undo if typing
      
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
  }, [selectedId, textInput, history, historyStep]);

  // Paste handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          if (!blob) continue;

          const img = new window.Image();
          img.src = URL.createObjectURL(blob);
          img.onload = () => {
            const maxSize = 200;
            const scale = Math.min(maxSize / img.width, maxSize / img.height);
            const width = img.width * scale;
            const height = img.height * scale;

            setImages((prev) => [
              ...prev,
              {
                id: uuidv4(),
                image: img,
                x: stageSize.width / 2 - width / 2,
                y: stageSize.height / 2 - height / 2,
                width: width,
                height: height,
                timestamp: Date.now(),
              },
            ]);
            setTool(TOOLS.SELECT);
            setShouldSaveHistory(true);
          };
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [stageSize]);

  const handleContextMenu = (e: any) => {
    e.evt.preventDefault();
    if (e.evt.shiftKey) {
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (pos) {
        const id = uuidv4();
        setPointers([{ x: pos.x, y: pos.y, color: 'black', id }]);
      }
    }
  };

  const handleMouseDown = (e: any) => {
    // Check right click
    if (e.evt.button === 2 || e.evt.button === 3) {
      return;
    }
    
    // Check if shift is held for ping (left click)
    if (e.evt.shiftKey) {
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (pos) {
        const id = uuidv4();
        setPointers([{ x: pos.x, y: pos.y, color: 'black', id }]);
      }
      return;
    }
    
    // Deselect if clicking on empty area
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'background';
    if (clickedOnEmpty) {
      setSelectedId(null);
    }

    const stage = e.target.getStage();
    if (!stage) return;
    
    const pos = stage.getPointerPosition();
    if (!pos) return;

    // If clicking outside text input while it's active, submit it
    if (textInput) {
      handleTextSubmit();
      return;
    }

    if (tool === TOOLS.SELECT) return;

    if (tool === TOOLS.AREA_ERASER) {
      setCurrentLasso([pos.x, pos.y]);
      isDrawing.current = true;
      return;
    }

    if (tool === TOOLS.TEXT) {
      setTextInput({ x: pos.x, y: pos.y, value: '' });
      return;
    }

    isDrawing.current = true;
    const id = uuidv4();
    
    let strokeWidth = tool === TOOLS.PEN ? penThickness : 2;
    if (tool === TOOLS.MARKER) strokeWidth = 8;
    if (tool === TOOLS.ERASER) strokeWidth = 20;

    if (tool === TOOLS.LINE) {
      setShapes([...shapes, {
        id,
        type: 'line',
        x: 0,
        y: 0,
        points: [pos.x, pos.y, pos.x, pos.y],
        color,
        strokeWidth,
        timestamp: Date.now(),
      }]);
    } else if (tool === TOOLS.CIRCLE || tool === TOOLS.ELLIPSE) {
      setShapes([...shapes, {
        id,
        type: tool === TOOLS.CIRCLE ? 'circle' : 'ellipse',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        color,
        strokeWidth,
        timestamp: Date.now(),
      }]);
    } else if (tool === TOOLS.RECTANGLE) {
      setShapes([...shapes, {
        id,
        type: 'rectangle',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        color,
        strokeWidth,
        timestamp: Date.now(),
      }]);
    } else {
      setLines([...lines, {
        id,
        tool,
        points: [pos.x, pos.y],
        color: tool === TOOLS.ERASER ? '#ffffff' : color,
        strokeWidth,
        timestamp: Date.now(),
      }]);
    }
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing.current) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pos = stage.getPointerPosition();
    if (!pos) return;

    if (tool === TOOLS.AREA_ERASER) {
      setCurrentLasso(prev => [...prev, pos.x, pos.y]);
      return;
    }

    if (tool === TOOLS.LINE) {
      const lastShape = shapes[shapes.length - 1];
      if (!lastShape || lastShape.type !== 'line') return;
      
      const newPoints = [lastShape.points![0], lastShape.points![1], pos.x, pos.y];
      const newShapes = [...shapes];
      newShapes[shapes.length - 1] = { ...lastShape, points: newPoints };
      setShapes(newShapes);
    } else if (tool === TOOLS.CIRCLE) {
      const lastShape = shapes[shapes.length - 1];
      if (!lastShape || lastShape.type !== 'circle') return;

      const dx = pos.x - lastShape.x;
      const dy = pos.y - lastShape.y;
      const radius = Math.sqrt(dx * dx + dy * dy);

      const newShapes = [...shapes];
      newShapes[shapes.length - 1] = { ...lastShape, width: radius * 2, height: radius * 2 };
      setShapes(newShapes);
    } else if (tool === TOOLS.ELLIPSE) {
      const lastShape = shapes[shapes.length - 1];
      if (!lastShape || lastShape.type !== 'ellipse') return;

      const newShapes = [...shapes];
      newShapes[shapes.length - 1] = { ...lastShape, width: Math.abs(pos.x - lastShape.x) * 2, height: Math.abs(pos.y - lastShape.y) * 2 };
      setShapes(newShapes);
    } else if (tool === TOOLS.RECTANGLE) {
      const lastShape = shapes[shapes.length - 1];
      if (!lastShape || lastShape.type !== 'rectangle') return;

      const newShapes = [...shapes];
      newShapes[shapes.length - 1] = { ...lastShape, width: pos.x - lastShape.x, height: pos.y - lastShape.y };
      setShapes(newShapes);
    } else {
      const lastLine = lines[lines.length - 1];
      if (!lastLine) return;

      lastLine.points = lastLine.points.concat([pos.x, pos.y]);
      lines.splice(lines.length - 1, 1, lastLine);
      setLines(lines.concat());
    }
  };

  const handleMouseUp = () => {
    if (isDrawing.current) {
        isDrawing.current = false;
        
        if (tool === TOOLS.AREA_ERASER && currentLasso.length > 4) {
          setShapes(prev => [...prev, {
            id: uuidv4(),
            type: 'area_eraser',
            x: 0,
            y: 0,
            points: currentLasso,
            color: '#ffffff',
            strokeWidth: 0,
            timestamp: Date.now(),
          }]);
          setSelectedId(null); 
        }
        
        if (tool === TOOLS.AREA_ERASER) {
          setCurrentLasso([]);
        }
        
        setShouldSaveHistory(true);
    }
  };

  const handleTextSubmit = () => {
    if (!textInput) return;
    if (textInput.value.trim()) {
      setTexts([
        ...texts,
        {
          id: uuidv4(),
          x: textInput.x,
          y: textInput.y,
          text: textInput.value,
          color: color,
          fontSize: 20,
          timestamp: Date.now(),
        },
      ]);
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
    setLines([]);
    setTexts([]);
    setShapes([]);
    setImages([]);
    setSelectedId(null);
    setShouldSaveHistory(true);
  };

  const downloadImage = () => {
    if (stageRef.current) {
      const tr = transformerRef.current;
      if (tr) tr.hide();
      
      const uri = stageRef.current.toDataURL();
      
      if (tr) tr.show();

      const link = document.createElement('a');
      link.download = 'whiteboard.png';
      link.href = uri;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const img = new window.Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const maxSize = 200;
        const scale = Math.min(maxSize / img.width, maxSize / img.height);
        const width = img.width * scale;
        const height = img.height * scale;

        setImages((prev) => [
          ...prev,
          {
            id: uuidv4(),
            image: img,
            x: stageSize.width / 2 - width / 2,
            y: stageSize.height / 2 - height / 2,
            width: width,
            height: height,
            timestamp: Date.now(),
          },
        ]);
        setTool(TOOLS.SELECT);
        setShouldSaveHistory(true);
      };
    }
  };

  const handleDragEnd = (e: any, id: string, type: 'line' | 'shape' | 'text' | 'image') => {
      const node = e.target;
      const newX = node.x();
      const newY = node.y();
      
      if (type === 'shape') {
          setShapes(prev => prev.map(s => s.id === id ? { ...s, x: newX, y: newY } : s));
      } else if (type === 'text') {
          setTexts(prev => prev.map(t => t.id === id ? { ...t, x: newX, y: newY } : t));
      } else if (type === 'image') {
          setImages(prev => prev.map(i => i.id === id ? { ...i, x: newX, y: newY } : i));
      } else if (type === 'line') {
          setLines(prev => prev.map(l => l.id === id ? { ...l, x: newX, y: newY } : l));
      }
      setShouldSaveHistory(true);
  };
  
  const handleTransformEnd = (e: any, id: string, type: 'shape' | 'text' | 'image' | 'line') => {
      const node = e.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      
      node.scaleX(1);
      node.scaleY(1);
      
      if (type === 'shape') {
          setShapes(prev => prev.map(s => {
              if (s.id === id) {
                 if (s.type === 'rectangle') {
                     return { ...s, x: node.x(), y: node.y(), width: (s.width || 0) * scaleX, height: (s.height || 0) * scaleY };
                 } else if (s.type === 'circle' || s.type === 'ellipse') {
                     return { ...s, x: node.x(), y: node.y(), width: (s.width || 0) * scaleX, height: (s.height || 0) * scaleY };
                 }
                 return { ...s, x: node.x(), y: node.y() };
              }
              return s;
          }));
      } else if (type === 'text') {
          setTexts(prev => prev.map(t => t.id === id ? { ...t, x: node.x(), y: node.y(), fontSize: t.fontSize * scaleX } : t));
      } else if (type === 'image') {
          setImages(prev => prev.map(i => i.id === id ? { ...i, x: node.x(), y: node.y(), width: i.width * scaleX, height: i.height * scaleY } : i));
      } else if (type === 'line') {
          setLines(prev => prev.map(l => {
              if (l.id === id) {
                 const newPoints = l.points.map((p, i) => i % 2 === 0 ? p * scaleX : p * scaleY);
                 return { ...l, x: node.x(), y: node.y(), points: newPoints };
              }
              return l;
          }));
      }
      
      setShouldSaveHistory(true);
  };

  return (
    <div className="relative w-full h-screen bg-gray-50 overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-white shadow-lg rounded-xl p-2 flex flex-col gap-2 z-10 border border-gray-200">
        <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-1">
          <div className="flex items-center gap-1">
              <button onClick={undo} disabled={historyStep === 0} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30" title="Undo"><Undo size={16}/></button>
              <button onClick={redo} disabled={historyStep === history.length - 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30" title="Redo"><Redo size={16}/></button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Shift+RightClick to Ping</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 pr-2 border-r border-gray-200">
            <button
              onClick={() => setTool(TOOLS.SELECT)}
              className={`p-2 rounded-lg transition-colors ${tool === TOOLS.SELECT ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Select"
            >
              <MousePointer2 size={20} />
            </button>
            <button
              onClick={() => setTool(TOOLS.PEN)}
              className={`p-2 rounded-lg transition-colors ${tool === TOOLS.PEN ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Pen"
            >
              <Pen size={20} />
            </button>
            <button
              onClick={() => setTool(TOOLS.MARKER)}
              className={`p-2 rounded-lg transition-colors ${tool === TOOLS.MARKER ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Marker"
            >
              <Highlighter size={20} />
            </button>
            <button
              onClick={() => setTool(TOOLS.ERASER)}
              className={`p-2 rounded-lg transition-colors ${tool === TOOLS.ERASER ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Eraser"
            >
              <Eraser size={20} />
            </button>
            <button
              onClick={() => setTool(TOOLS.AREA_ERASER)}
              className={`p-2 rounded-lg transition-colors ${tool === TOOLS.AREA_ERASER ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Area Eraser"
            >
              <Scissors size={20} />
            </button>
            <button
              onClick={() => setTool(TOOLS.TEXT)}
              className={`p-2 rounded-lg transition-colors ${tool === TOOLS.TEXT ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Text"
            >
              <Type size={20} />
            </button>
            <button
              onClick={() => setTool(TOOLS.LINE)}
              className={`p-2 rounded-lg transition-colors ${tool === TOOLS.LINE ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Line"
            >
              <Minus size={20} />
            </button>
            <button
              onClick={() => setTool(TOOLS.RECTANGLE)}
              className={`p-2 rounded-lg transition-colors ${tool === TOOLS.RECTANGLE ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Rectangle"
            >
              <Square size={20} />
            </button>
            <button
              onClick={() => setTool(TOOLS.CIRCLE)}
              className={`p-2 rounded-lg transition-colors ${tool === TOOLS.CIRCLE ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Circle"
            >
              <Circle size={20} />
            </button>
            <button
              onClick={() => setTool(TOOLS.ELLIPSE)}
              className={`p-2 rounded-lg transition-colors ${tool === TOOLS.ELLIPSE ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Ellipse"
            >
              <div className="w-4 h-3 border-[1.5px] border-current rounded-[50%]"></div>
            </button>
            <label className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 cursor-pointer transition-colors" title="Upload Image">
              <ImageIcon size={20} />
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
          </div>
          <div className="flex items-center gap-2 px-2 border-r border-gray-200">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${color === c ? 'border-gray-400 scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <div className="flex items-center gap-1 pl-2">
             {selectedId && (
              <button
                onClick={deleteSelected}
                className="p-2 rounded-lg hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors"
                title="Delete Selected"
              >
                <X size={20} />
              </button>
             )}
             <button
              onClick={clearBoard}
              className="p-2 rounded-lg hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors"
              title="Clear Board"
            >
              <Trash2 size={20} />
            </button>
            <button
              onClick={downloadImage}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
              title="Download"
            >
              <Download size={20} />
            </button>
          </div>
        </div>
        {tool === TOOLS.PEN && (
          <div className="flex items-center gap-3 px-2 pt-1 pb-1">
             <span className="text-xs text-gray-500 font-medium">Thickness</span>
             <input type="range" min="1" max="20" value={penThickness} onChange={e => setPenThickness(Number(e.target.value))} className="w-32 accent-blue-500" />
          </div>
        )}
      </div>

      {/* Canvas Container */}
      <div className="flex-1 w-full h-full bg-white cursor-crosshair" ref={containerRef}>
        <Stage
          width={stageSize.width}
          height={stageSize.height}
          onContextMenu={handleContextMenu}
          onMouseDown={handleMouseDown}
          onMousemove={handleMouseMove}
          onMouseup={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
          ref={stageRef}
        >
          <Layer>
             <Rect
                name="background"
                x={0}
                y={0}
                width={stageSize.width}
                height={stageSize.height}
                fill="white"
             />
             
            {[
              ...lines.map(l => ({ type: 'lineItem', item: l as any })),
              ...shapes.map(s => ({ type: 'shapeItem', item: s as any })),
              ...texts.map(t => ({ type: 'textItem', item: t as any })),
              ...images.map(i => ({ type: 'imageItem', item: i as any }))
            ]
            .sort((a, b) => (a.item.timestamp || 0) - (b.item.timestamp || 0))
            .map((el) => {
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
                    tension={0.5}
                    lineCap="round"
                    lineJoin="round"
                    opacity={el.item.tool === 'marker' ? 0.5 : 1}
                    draggable={tool === TOOLS.SELECT}
                    onClick={() => {
                      if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
                    }}
                    onTap={() => {
                      if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
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
                      lineCap="round"
                      lineJoin="round"
                      draggable={tool === TOOLS.SELECT}
                      onClick={() => {
                        if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
                      }}
                      onTap={() => {
                        if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
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
                      draggable={tool === TOOLS.SELECT}
                      onClick={() => {
                        if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
                      }}
                      onTap={() => {
                        if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
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
                      draggable={tool === TOOLS.SELECT}
                      onClick={() => {
                        if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
                      }}
                      onTap={() => {
                        if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
                      }}
                      onDragEnd={(e) => handleDragEnd(e, el.item.id, 'shape')}
                      onTransformEnd={(e) => handleTransformEnd(e, el.item.id, 'shape')}
                    />
                  );
                } else if (el.item.type === 'rectangle') {
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
                      draggable={tool === TOOLS.SELECT}
                      onClick={() => {
                        if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
                      }}
                      onTap={() => {
                        if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
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
                    fontFamily="sans-serif"
                    draggable={tool === TOOLS.SELECT}
                    onClick={() => {
                      if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
                    }}
                    onTap={() => {
                      if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
                    }}
                    onDragEnd={(e) => handleDragEnd(e, el.item.id, 'text')}
                    onTransformEnd={(e) => handleTransformEnd(e, el.item.id, 'text')}
                  />
                );
              }
              if (el.type === 'imageItem') {
                return (
                  <KonvaImage
                    key={el.item.id}
                    id={el.item.id}
                    image={el.item.image}
                    x={el.item.x}
                    y={el.item.y}
                    width={el.item.width}
                    height={el.item.height}
                    draggable={tool === TOOLS.SELECT}
                    onClick={() => {
                      if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
                    }}
                    onTap={() => {
                      if (tool === TOOLS.SELECT) setSelectedId(el.item.id);
                    }}
                    onDragEnd={(e) => handleDragEnd(e, el.item.id, 'image')}
                    onTransformEnd={(e) => handleTransformEnd(e, el.item.id, 'image')}
                  />
                );
              }
              return null;
            })}
            
            {pointers.map(p => (
                 <Path
                    key={p.id}
                    x={p.x}
                    y={p.y}
                    data="M 0 0 L 0 16 L 4 12 L 9 20 L 12 18 L 7 10 L 12 10 Z"
                    fill="#000000"
                    stroke="#ffffff"
                    strokeWidth={2}
                    opacity={1}
                    shadowColor="black"
                    shadowBlur={3}
                    shadowOffset={{ x: 1, y: 1 }}
                    shadowOpacity={0.3}
                    scaleX={1.2}
                    scaleY={1.2}
                    onContextMenu={(e) => {
                      e.cancelBubble = true;
                      e.evt.preventDefault();
                      setPointers(prev => prev.filter(ptr => ptr.id !== p.id));
                    }}
                 />
            ))}
            
            {currentLasso.length > 0 && (
              <Line
                points={currentLasso}
                fill="rgba(239, 68, 68, 0.2)"
                stroke="#ef4444"
                strokeWidth={2}
                dash={[5, 5]}
                closed
              />
            )}
            
            <Transformer ref={transformerRef} />
          </Layer>
        </Stage>
        {textInput && (
          <textarea
            ref={textInputRef}
            value={textInput.value}
            onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
            onBlur={handleTextSubmit}
            onKeyDown={handleKeyDown}
            style={{
              position: 'absolute',
              top: textInput.y,
              left: textInput.x,
              fontSize: '20px',
              fontFamily: 'sans-serif',
              color: color,
              border: '1px dashed #ccc',
              background: 'transparent',
              outline: 'none',
              resize: 'none',
              overflow: 'hidden',
              minWidth: '100px',
              minHeight: '30px',
              zIndex: 10,
              lineHeight: 1.2,
            }}
            placeholder="Type here..."
            autoFocus
          />
        )}
      </div>
    </div>
  );
}

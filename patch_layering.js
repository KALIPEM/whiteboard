const fs = require('fs');
let code = fs.readFileSync('src/components/Whiteboard.tsx', 'utf-8');

// 1. Update ImageData interface
code = code.replace(
  /interface ImageData \{\n  id: string;\n  image: HTMLImageElement;\n  x: number;\n  y: number;\n  width: number;\n  height: number;\n  timestamp: number;\n\}/,
  `interface ImageData {
  id: string;
  image: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
  timestamp: number;
  isPermanent?: boolean;
}`
);

fs.writeFileSync('src/components/Whiteboard.tsx', code);

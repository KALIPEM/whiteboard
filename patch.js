const fs = require('fs');
let code = fs.readFileSync('src/components/Whiteboard.tsx', 'utf-8');

// Remove the first useEffect
code = code.replace(/  useEffect\(\(\) => \{\n    const handleKeyDown = \(e: KeyboardEvent\) => \{\n      if \(e\.key >= '3' && e\.key <= '9'\) \{\n        setPolygonSides\(parseInt\(e\.key\)\);\n      \}\n    \};\n    window\.addEventListener\('keydown', handleKeyDown\);\n    return \(\) => \{\n      window\.removeEventListener\('keydown', handleKeyDown\);\n    \};\n  \}, \[\]\);\n/, '');

// Modify the second useEffect
code = code.replace(
  /  useEffect\(\(\) => \{\n    const handleKeyDown = \(e: KeyboardEvent\) => \{\n      if \(textInput\) return; \/\/ Don't delete or undo if typing/g,
  `  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '3' && e.key <= '9') {
        setPolygonSides(parseInt(e.key));
      }
      
      if (textInput) return; // Don't delete or undo if typing
      
      const key = e.key.toLowerCase();
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (key === 'v') setTool(TOOLS.SELECT);
        else if (key === 'p') setTool(TOOLS.PEN);
        else if (key === 'm') setTool(TOOLS.MARKER);
        else if (key === 'e') setTool(TOOLS.ERASER);
        else if (key === 'x') setTool(TOOLS.AREA_ERASER);
        else if (key === 't') setTool(TOOLS.TEXT);
        else if (key === 'l') setTool(TOOLS.LINE);
        else if (key === 'r') setTool(TOOLS.RECTANGLE);
        else if (key === 'c') setTool(TOOLS.CIRCLE);
      }`
);

fs.writeFileSync('src/components/Whiteboard.tsx', code);

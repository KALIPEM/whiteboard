const fs = require('fs');
let code = fs.readFileSync('src/components/Whiteboard.tsx', 'utf-8');

code = code.replace(
  /  const handleTextSubmit = \(\) => \{/g,
  `  const handleTextSubmit = () => {
    console.log("handleTextSubmit called, textInput.value: ", textInput?.value);`
);

fs.writeFileSync('src/components/Whiteboard.tsx', code);

const fs = require('fs');
const src = fs.readFileSync('src/App.jsx', 'utf8');
let inTemplate = false;
let line = 1;
let templateStartLine = 0;
for (let i = 0; i < src.length; i++) {
  const c = src[i];
  const prev = src[i-1];
  if (c === '\n') line++;
  if (c === '`' && prev !== '\\') {
    if (!inTemplate) { inTemplate = true; templateStartLine = line; }
    else { inTemplate = false; }
  }
}
if (inTemplate) {
  console.log('UNTERMINATED TEMPLATE LITERAL starting at line', templateStartLine);
} else {
  console.log('Backticks balanced.');
}

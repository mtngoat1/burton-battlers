const fs = require('fs');
const src = fs.readFileSync('src/App.jsx', 'utf8');
const stack = [];
let line = 1;
for (let i = 0; i < src.length; i++) {
  const c = src[i];
  if (c === '\n') line++;
  if (c === '(' || c === '[') stack.push({c, line});
  if (c === ')' || c === ']') {
    const open = stack.pop();
    if (!open) { console.log('STRAY CLOSING', c, 'at line', line); process.exit(0); }
    const want = c === ')' ? '(' : '[';
    if (open.c !== want) { console.log('MISMATCHED:', open.c, 'opened at line', open.line, 'but closed with', c, 'at line', line); process.exit(0); }
  }
}
if (stack.length) {
  const top = stack[stack.length-1];
  console.log('UNCLOSED:', top.c, 'opened at line', top.line, '-- and', stack.length - 1, 'more still open');
} else {
  console.log('All parens/brackets balanced.');
}

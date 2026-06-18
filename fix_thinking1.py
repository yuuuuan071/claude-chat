with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

old = "const [devMode, setDevMode] = useState(false)"
new = "const [devMode, setDevMode] = useState(false)\n  const [thinkingEnabled, setThinkingEnabled] = useState(false)\n  const [thinkingMode, setThinkingMode] = useState<'short' | 'long'>('short')"
print('state声明：成功' if old in c else 'state声明：未找到')
if old in c: c = c.replace(old, new)

old2 = "setDevMode(localStorage.getItem('dev-mode') === 'true')"
new2 = "setDevMode(localStorage.getItem('dev-mode') === 'true')\n      setThinkingEnabled(localStorage.getItem('thinking-enabled') === 'true')\n      const savedThinkingMode = localStorage.getItem('thinking-mode')\n      if (savedThinkingMode === 'long') setThinkingMode('long')"
print('mount读取：成功' if old2 in c else 'mount读取：未找到')
if old2 in c: c = c.replace(old2, new2)

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

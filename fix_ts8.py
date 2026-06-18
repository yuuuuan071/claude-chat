with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

results = []

old1 = "      const typeChars = (target: string, current: string, base: typeof newMessages) => {\n        if (typewriterRef.current.timer) clearTimeout(typewriterRef.current.timer)\n        let i = current.length\n        const tick = () => {\n          if (i < target.length) {\n            const next = target.slice(0, i + 1)\n            updateCurrentMessages([...base, { role: 'assistant', content: next }])"
new1 = "      const typeChars = (target: string, current: string, base: typeof newMessages, ts?: number) => {\n        if (typewriterRef.current.timer) clearTimeout(typewriterRef.current.timer)\n        let i = current.length\n        const tick = () => {\n          if (i < target.length) {\n            const next = target.slice(0, i + 1)\n            updateCurrentMessages([...base, { role: 'assistant', content: next, timestamp: ts }])"

results.append('typeChars签名：成功' if old1 in c else 'typeChars签名：未找到')
if old1 in c: c = c.replace(old1, new1)

old2 = "              typeChars(assistantContent, displayedContent, newMessages)"
new2 = "              typeChars(assistantContent, displayedContent, newMessages, assistantTimestamp)"
results.append('typeChars调用：成功' if old2 in c else 'typeChars调用：未找到')
if old2 in c: c = c.replace(old2, new2)

old3 = "              if (!assistantAdded) {\n                updateCurrentMessages([...newMessages, { role: 'assistant', content: '', timestamp: Date.now() }])"
new3 = "              if (!assistantAdded) {\n                assistantTimestamp = Date.now()\n                updateCurrentMessages([...newMessages, { role: 'assistant', content: '', timestamp: assistantTimestamp }])"
results.append('assistantTimestamp赋值：成功' if old3 in c else 'assistantTimestamp赋值：未找到')
if old3 in c: c = c.replace(old3, new3)

old4 = "      let assistantAdded = false"
new4 = "      let assistantAdded = false\n      let assistantTimestamp: number | undefined"
results.append('变量声明：成功' if old4 in c else '变量声明：未找到')
if old4 in c: c = c.replace(old4, new4)

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

for r in results: print(r)

with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

results = []

old1 = "const userMessage = { role: 'user' as const, content: input }"
new1 = "const userMessage = { role: 'user' as const, content: input, timestamp: Date.now() }"
results.append('user timestamp：成功' if old1 in c else 'user timestamp：未找到')
if old1 in c: c = c.replace(old1, new1)

old2 = "updateCurrentMessages([...newMessages, { role: 'assistant', content: '' }])"
new2 = "updateCurrentMessages([...newMessages, { role: 'assistant', content: '', timestamp: Date.now() }])"
results.append('assistant timestamp：成功' if old2 in c else 'assistant timestamp：未找到')
if old2 in c: c = c.replace(old2, new2)

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

for r in results: print(r)

with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

results = []

old1 = "{ role: 'user', content: input.trim() }"
new1 = "{ role: 'user', content: input.trim(), timestamp: Date.now() }"
results.append('user timestamp：成功' if old1 in c else 'user timestamp：未找到')
if old1 in c: c = c.replace(old1, new1)

old2 = "{ role: 'assistant' as const, content: fullText }"
new2 = "{ role: 'assistant' as const, content: fullText, timestamp: Date.now() }"
results.append('assistant timestamp：成功' if old2 in c else 'assistant timestamp：未找到')
if old2 in c: c = c.replace(old2, new2)

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

for r in results: print(r)

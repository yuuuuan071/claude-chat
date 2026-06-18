with open('app/conversations.ts', 'r', encoding='utf-8') as f:
    c = f.read()
old = "    content: string\n  }"
new = "    content: string\n    timestamp?: number\n  }"
print('conversations.ts：成功' if old in c else '未找到')
if old in c:
    with open('app/conversations.ts', 'w', encoding='utf-8') as f:
        f.write(c.replace(old, new))

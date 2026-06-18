with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
old = 'const systemPromptWithMemory = summary\n      ? `${fullSystemPrompt}\\n\\n【我的记忆】\\n${summary}`\n      : fullSystemPrompt'
new = 'const systemPromptWithMemory = summary\n      ? `${finalSystemPrompt}\\n\\n【我的记忆】\\n${summary}`\n      : finalSystemPrompt'
print('成功' if old in c else '未找到')
if old in c: c = c.replace(old, new)
with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

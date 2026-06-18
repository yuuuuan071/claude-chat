with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
old = 'const thinkMatch = msg.content.match(/^<think>([\\s\\S]*?)<\\/think>\n?/)'
new = 'const thinkMatch = msg.content.match(/^<think>([\\s\\S]*?)<\\/think>\\n?/)'
print('成功' if old in c else '未找到')
if old in c: c = c.replace(old, new)
with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

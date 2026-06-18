with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
old = "color: msg.role === 'user' ? 'rgba(255,255,255,0.7)' : '#555'"
new = "color: msg.role === 'user' ? 'rgba(255,255,255,0.7)' : t.timestampText"
print('成功' if old in c else '未找到')
if old in c: c = c.replace(old, new)
with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

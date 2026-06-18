with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

old = "          {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit})}'"
new = "          {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}"

if old in c:
    c = c.replace(old, new)
    print("成功")
else:
    print("未找到，打印实际内容：")
    idx = c.find("toLocaleTimeString")
    print(repr(c[idx-10:idx+120]))

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

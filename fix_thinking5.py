with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
old = "                          {msg.content}\n                        </ReactMarkdown>"
new = "                          {msg.content.replace(/^<think>[\\s\\S]*?<\\/think>\\n?/, '')}\n                        </ReactMarkdown>"
print('成功' if old in c else '未找到')
if old in c: c = c.replace(old, new)
with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

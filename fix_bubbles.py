with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

# 找到单气泡 div 的开头，替换成多气泡渲染
old = """                      <div
                        className={"chat-bubble max-w-[70%] rounded-2xl px py-3 text-sm leading-relaxed" + (animatedIds.has(i) ? " bubble-animate" : "")}
                        style={msg.role === 'user'
                          ? { background: t.userBubble, color: t.userText,border: `1px solid ${t.userBubbleBorder}`, backdropFilter: 'blur(8px)' }
                          : { background: t.assistantBubble, color: t.assistantText, border: `1px solid ${t.assistantBubbleBorder}`, backdropFilter: 'blur(10px)' }
                        }
                      >
                        {msg.role === 'user' ? msg.content : (
                          <ReactMarkdown"""

print('找到气泡div：' + str(old in c))
if old not in c:
    idx = c.find('chat-bubble max-w')
    print(repr(c[idx-30:idx+300]))

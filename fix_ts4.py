with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

old = """                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end pr-4' : 'justify-start pl-4'} ${animatedIds.has(i) ? 'bubble-animate' : ''}`}
                  >
                    <div
                      className="chat-bubble max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed\""""

new = """                  <div
                    key={i}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end pr-4' : 'items-start pl-4'}`}
                  >
                    {animatedIds.has(i) && <style>{`.bubble-${i}{animation:bubbleIn 0.25s ease}`}</style>}
                    {msg.timestamp && (
                      <span style={{ fontSize: '0.62rem', opacity: 0.55, color: t.settingsSubText, marginBottom: '2px', paddingLeft: '4px', paddingRight: '4px' }}>
                        {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    <div
                      className={`chat-bubble max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed${animatedIds.has(i) ? ' bubble-animate' : ''}\""""

if old in c:
    c = c.replace(old, new)
    print('成功')
else:
    print('未找到')

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

# 在 messages.map 里，找到 assistant 消息的内容渲染，在气泡 div 之前加 think 块解析
# 找到外层 flex 容器的开头，插入解析逻辑

old = """                  <div
                    key={i}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end pr-4' : 'items-start pl-4'}`}
                  >
                    {animatedIds.has(i) && <style>{`.bubble-${i}{animation:bubbleIn 0.25s ease}`}</style>}"""

new = """                  <div
                    key={i}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end pr-4' : 'items-start pl-4'}`}
                  >
                    {animatedIds.has(i) && <style>{`.bubble-${i}{animation:bubbleIn 0.25s ease}`}</style>}
                    {msg.role === 'assistant' && (() => {
                      const thinkMatch = msg.content.match(/^<think>([\s\S]*?)<\/think>\n?/)
                      if (!thinkMatch) return null
                      const thinkContent = thinkMatch[1]
                      return (
                        <details className="mb-1 max-w-[70%]" style={{ fontSize: '0.72rem' }}>
                          <summary style={{ cursor: 'pointer', color: t.settingsSubText, listStyle: 'none', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 6px', userSelect: 'none' }}>
                            <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>💭</span>
                            <span style={{ opacity: 0.7 }}>心声</span>
                          </summary>
                          <div style={{ marginTop: '4px', padding: '8px 10px', borderRadius: '10px', background: t.settingsBg, border: `1px solid ${t.settingsInputBorder}`, color: t.settingsSubText, fontStyle: 'italic', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                            {thinkContent}
                          </div>
                        </details>
                      )
                    })()}"""

if old in c:
    c = c.replace(old, new)
    print('think块渲染：成功')
else:
    print('think块渲染：未找到')
    idx = c.find('flex flex-col')
    print(repr(c[idx-20:idx+200]))

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

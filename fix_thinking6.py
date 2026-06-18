with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

old2 = "                    开发者模式：{devMode ? '开启 ✓' : '关闭'}\n                  </button>\n                  {messages.length > 0 && ("
new2 = ("                    开发者模式：{devMode ? '开启 ✓' : '关闭'}\n"
        "                  </button>\n"
        "                  <button\n"
        "                    onClick={() => {\n"
        "                      const next = !thinkingEnabled\n"
        "                      setThinkingEnabled(next)\n"
        "                      localStorage.setItem('thinking-enabled', next ? 'true' : 'false')\n"
        "                      setShowMenu(false)\n"
        "                    }}\n"
        "                    className=\"w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70\"\n"
        "                    style={{ color: t.settingsText, borderBottom: `1px solid ${t.headerBorder}` }}\n"
        "                  >\n"
        "                    心声模式：{thinkingEnabled ? '开启 ✓' : '关闭'}\n"
        "                  </button>\n"
        "                  {thinkingEnabled && (\n"
        "                    <button\n"
        "                      onClick={() => {\n"
        "                        const next = thinkingMode === 'short' ? 'long' : 'short'\n"
        "                        setThinkingMode(next)\n"
        "                        localStorage.setItem('thinking-mode', next)\n"
        "                        setShowMenu(false)\n"
        "                      }}\n"
        "                      className=\"w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70\"\n"
        "                      style={{ color: t.settingsText, borderBottom: `1px solid ${t.headerBorder}` }}\n"
        "                    >\n"
        "                      心声深度：{thinkingMode === 'short' ? '简短' : '详细'}\n"
        "                    </button>\n"
        "                  )}\n"
        "                  {messages.length > 0 && (")

print('成功' if old2 in c else '未找到')
if old2 in c: c = c.replace(old2, new2)
with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

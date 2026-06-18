with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

results = []

# 第一步：移除气泡前的时间戳 span 块（20空格缩进）
old1 = (
    "                    {msg.timestamp && (\n"
    "                      <span style={{ fontSize: '0.62rem', opacity: 0.55, color: t.settingsSubText, marginBottom: '2px', paddingLeft: '4px', paddingRight: '4px' }}>\n"
    "                        {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}\n"
    "                      </span>\n"
    "                    )}\n"
)
new1 = ""
results.append('移除旧span：成功' if old1 in c else '移除旧span：未找到')
if old1 in c: c = c.replace(old1, new1)

# 第二步：在气泡 </div> 后、外层 </div> 前插入时间戳 span
old2 = (
    "                      )}\n"
    "                    </div>\n"
    "                  </div>\n"
    "                ))}"
)
new2 = (
    "                      )}\n"
    "                    </div>\n"
    "                    {msg.timestamp && (\n"
    "                      <span style={{ fontSize: '0.62rem', opacity: 0.75, color: t.settingsSubText, marginTop: '2px', paddingLeft: '4px', paddingRight: '4px' }}>\n"
    "                        {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}\n"
    "                      </span>\n"
    "                    )}\n"
    "                  </div>\n"
    "                ))}"
)
results.append('插入新span：成功' if old2 in c else '插入新span：未找到')
if old2 in c: c = c.replace(old2, new2)

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

for r in results: print(r)

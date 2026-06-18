with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

results = []

old1 = "        const msgText = toSummarize\n          .map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)\n          .join('\\n')"
new1 = "        const personaName = allPersonas.find(p => p.id === currentConversation?.personaId)?.name ?? '我'\n        const msgText = toSummarize\n          .map(m => `${m.role === 'user' ? '慧妍' : personaName}：${m.content}`)\n          .join('\\n')"
results.append('第1处：成功' if old1 in content else '第1处：未找到')
if old1 in content: content = content.replace(old1, new1)

old2 = '以下是之前对话的摘要：'
new2 = '以下是我之前的记忆：'
results.append('第2处：成功' if old2 in content else '第2处：未找到')
if old2 in content: content = content.replace(old2, new2)

old2b = '请把上述摘要和新内容重新总结成一段简洁的新摘要，保留关键信息、决定和情绪基调，去掉口语化重复：'
new2b = '请以我的第一人称，把上述记忆和新内容重新整合成一段简洁的内心记忆，保留慧妍的情绪状态、关键细节和重要决定，去掉口语化重复：'
results.append('第2b处：成功' if old2b in content else '第2b处：未找到')
if old2b in content: content = content.replace(old2b, new2b)

old2c = '请把以下对话内容压缩成一段简洁摘要，保留关键信息、决定和情绪基调，去掉口语化重复：'
new2c = '请以我的第一人称，把以下和慧妍的对话整理成一段简洁的内心记忆，保留她的情绪状态、关键细节和重要决定，去掉口语化重复：'
results.append('第2c处：成功' if old2c in content else '第2c处：未找到')
if old2c in content: content = content.replace(old2c, new2c)

old3 = '你是一个对话摘要助手，只输出摘要内容，不加任何额外说明或标题。'
new3 = '你是一个对话记忆整理助手。请以角色第一人称写一段简洁的内心记忆，记录和慧妍的对话要点、她的情绪状态和关键细节。只输出记忆内容，不加标题或说明。'
results.append('第3处：成功' if old3 in content else '第3处：未找到')
if old3 in content: content = content.replace(old3, new3)

old4 = "      const messagesForAPI = summary\n        ? [\n            { role: 'user' as const, content: `以下是我们之前对话的摘要:\\n${summary}` },\n            { role: 'assistant' as const, content: '好的，我已了解之前对话的内容。' },\n            ...recentMessages,\n          ]\n        : recentMessages"
new4 = "      const messagesForAPI = recentMessages\n      const systemPromptWithMemory = summary\n        ? `${fullSystemPrompt}\\n\\n【我的记忆】\\n${summary}`\n        : fullSystemPrompt"
results.append('第4处：成功' if old4 in content else '第4处：未找到')
if old4 in content: content = content.replace(old4, new4)

old5 = 'systemPrompt: fullSystemPrompt || undefined,'
new5 = 'systemPrompt: systemPromptWithMemory || undefined,'
results.append('第5处：成功' if old5 in content else '第5处：未找到')
if old5 in content: content = content.replace(old5, new5)

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

for r in results: print(r)

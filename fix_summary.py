with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 第一处：msgText mapping 改成角色名
old1 = """        const msgText = toSummarize
          .map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
          .join('\\n')"""

new1 = """        const personaName = allPersonas.find(p => p.id === currentConversation?.personaId)?.name ?? '我'
        const msgText = toSummarize
          .map(m => `${m.role === 'user' ? '慧妍' : personaName}：${m.content}`)
          .join('\\n')"""

# 第二处：summaryUserContent 改成第一人称记忆
old2 = """          const summaryUserContent = summary
            ? `以下是之前对话的摘要：\\n${summary}\\n\\n以下是新增对话内容，请把上述摘要和新内容重新总结成一段简洁的要，保留关键信息、决定和情绪基调，去掉口语化重复：\\n${msgText}`
            : `请把以下对话内容压缩成一段简洁摘要，保留关键信息、决定和情绪基调，去掉口语化重复：\\n${msgText}`"""

new2 = """          const summaryUserContent = summary
            ? `以下是我之前的记忆：\\n${summary}\\n\\n以下是新增的对话内容，请以我（${personaName}）的第一人称，把上述记忆和新内容重新整合成一段简洁的内心记忆，保留慧妍的情绪状态、关键细节和重要决定，去掉口语化重复：\\n${msgText}`
            : `请以我（${personaName}）的第一人称，把以下和慧妍的对话整理成一段简洁的内心记忆，保留她的情绪状态、关键细节和重要决定，去掉口语化重复：\\n${msgText}`"""

# 第三处：summary systemPrompt
old3 = "                systemPrompt: '你是一个对话摘要助手，只输出摘要内容，不加任何额外说明或标题。',"
new3 = '                systemPrompt: \'你是一个对话记忆整理助手。请以角色第一人称（"我"）写一段简洁的内心记忆，记录和慧妍的对话要点、她的情绪状态和关键细节。只输出记忆内容，不加标题或说明。\','

# 第四处：summary 注入方式
old4 = """      const messagesForAPI = summary
        ? [
            { role: 'user' as const, content: `以下是我们之前对话的摘要：\\n${summary}` },
            { role: 'assistant' as const, content: '好的，我已了解之前对话的内容。' },
            ...recentMessages,
          ]
        : recentMessages"""

new4 = """      const messagesForAPI = recentMessages
      const systemPromptWithMemory = summary
        ? `${fullSystemPrompt}\\n\\n【我的记忆】\\n${summary}`
        : fullSystemPrompt"""

# 第五处：API 调用里换变量名
old5 = "            systemPrompt: fullSystemPrompt || undefined,"
new5 = "            systemPrompt: systemPromptWithMemory || undefined,"

replacements = [(old1, new1), (old2, new2), (old3, new3), (old4, new4), (old5, new5)]

for i, (old, new) in enumerate(replacements, 1):
    if old in content:
        content = content.replace(old, new)
        print(f'第{i}处替换成功')
    else:
        print(f'第{i}处未找到匹配，跳过')

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('完成')

with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 用精确的字符串片段定位，避免多行匹配问题
marker = "const messagesForAPI = summary"
if marker not in content:
    print("未找到 marker")
else:
    old4 = (
        "    const messagesForAPI = summary\n"
        "      ? [\n"
        "          { role: 'user' as const, content: `以下是我们之前对话的摘要：\\n${summary}` },\n"
        "          { role: 'assistant' as const, content: '好的，我已了解之前对话的内容。' },\n"
        "          ...recentMessages,\n"
        "        ]\n"
        "      : recentMessages"
    )
    new4 = (
        "    const messagesForAPI = recentMessages\n"
        "    const systemPromptWithMemory = summary\n"
        "      ? `${fullSystemPrompt}\\n\\n【我的记忆】\\n${summary}`\n"
        "      : fullSystemPrompt"
    )
    if old4 in content:
        content = content.replace(old4, new4)
        print("第4处：成功")
    else:
        print("第4处：未找到，打印实际内容：")
        idx = content.find(marker)
        print(repr(content[idx-4:idx+350]))

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old = (
    "  type Conversation,\n"
    "  createConversation,\n"
    "  getTitleFromMessages,\n"
    "  loadConversations,\n"
    "  saveConversations,\n"
    "  loadConversationsFromDB,\n"
    "  saveConversationToDB,\n"
)
new = (
    "  type Conversation,\n"
    "  createConversation,\n"
    "  getTitleFromMessages,\n"
    "  loadConversationsFromDB,\n"
    "  saveConversationToDB,\n"
)

if old in content:
    content = content.replace(old, new)
    print("成功")
else:
    print("未找到")

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

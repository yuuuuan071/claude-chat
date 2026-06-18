with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
idx = c.find("chat-bubble max-w")
print(repr(c[idx-30:idx+200]))

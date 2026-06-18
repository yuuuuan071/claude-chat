with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

old = '                  className={`chat-bubble max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed${animatedIds.has(i) ? \' bubble-animate\' : \'\'}"'
new = '                  className={"chat-bubble max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed" + (animatedIds.has(i) ? " bubble-animate" : "")}'

if old in c:
    c = c.replace(old, new)
    print("成功")
else:
    print("未找到")
    idx = c.find("chat-bubble max-w")
    print(repr(c[idx-30:idx+120]))

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

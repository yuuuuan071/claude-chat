with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old = "onClick={() => { setViewingPersona(persona); closeSidebarOnMobile() }}"
new = "onClick={() => { setViewingPersona(persona); setViewingSpace(false); closeSidebarOnMobile() }}"

if old in content:
    content = content.replace(old, new)
    print("成功")
else:
    print("未找到")

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

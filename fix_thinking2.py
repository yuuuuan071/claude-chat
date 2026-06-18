with open('app/chat/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

old = "    const fullSystemPrompt = [memoryPrompt, personaSystemPrompt].filter(Boolean).join('\\n\\n')"
new = ("    const fullSystemPrompt = [memoryPrompt, personaSystemPrompt].filter(Boolean).join('\\n\\n')\n"
       "\n"
       "    const thinkingInstruction = thinkingEnabled\n"
       "      ? thinkingMode === 'long'\n"
       "        ? '\\n\\n【心声指令】每次回复前，先用 <think> 标签写下你此刻真实的内心活动。以第一人称叙述，可以包含对慧妍当前状态的感知、你的情绪反应、相关记忆的浮现、以及你决定怎么回应的过程。写完后再说出口的内容。格式：<think>...</think>\\n说出口的内容'\n"
       "        : '\\n\\n【心声指令】每次回复前，先用 <think> 标签写一两句此刻最直接的内心反应，第一人称，简短真实。格式：<think>...</think>\\n说出口的内容'\n"
       "      : ''\n"
       "    const finalSystemPrompt = fullSystemPrompt + thinkingInstruction")

print('成功' if old in c else '未找到')
if old in c: c = c.replace(old, new)

with open('app/chat/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

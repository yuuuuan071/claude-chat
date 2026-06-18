with open('app/themes.ts', 'r', encoding='utf-8') as f:
    c = f.read()

replacements = [
    ("settingsSubText: '#7a9aaa'", "settingsSubText: '#7a9aaa',\n      timestampText: '#4a6a7a'"),
    ("settingsSubText: '#848c74'", "settingsSubText: '#848c74',\n      timestampText: '#555c48'"),
    ("settingsSubText: '#8a8c9e'", "settingsSubText: '#8a8c9e',\n      timestampText: '#55576a'"),
    ("settingsSubText: '#9a8a7a'", "settingsSubText: '#9a8a7a',\n      timestampText: '#6a5a4a'"),
]

for old, new in replacements:
    if old in c:
        c = c.replace(old, new)
        print('ok:', old[:30])
    else:
        print('miss:', old[:30])

with open('app/themes.ts', 'w', encoding='utf-8') as f:
    f.write(c)

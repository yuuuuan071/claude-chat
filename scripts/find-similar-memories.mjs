// 近似重复检测脚本：在同一 persona_id 内，用字符级 bigram 的 Dice 系数
// 找出内容相似（但不完全相同）的 persona_memories，只输出报告，不删除任何数据。
//
// 用法：
//   node scripts/find-similar-memories.mjs                  # 默认阈值 0.55
//   node scripts/find-similar-memories.mjs --threshold=0.7  # 自定义阈值

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnvLocal() {
  const path = join(__dirname, '..', '.env.local')
  const text = readFileSync(path, 'utf-8')
  const env = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function parseThreshold() {
  const arg = process.argv.find(a => a.startsWith('--threshold='))
  if (!arg) return 0.55
  const value = parseFloat(arg.split('=')[1])
  if (Number.isNaN(value) || value <= 0 || value > 1) {
    console.error(`非法的 --threshold 值: ${arg}，应为 (0, 1] 之间的数字`)
    process.exit(1)
  }
  return value
}

// 字符级 bigram 集合（相邻双字）；单字内容没有 bigram 时退化为字符本身，避免 0/0
function bigrams(text) {
  const chars = Array.from(text)
  const set = new Set()
  for (let i = 0; i < chars.length - 1; i++) set.add(chars[i] + chars[i + 1])
  if (set.size === 0 && chars.length > 0) set.add(chars[0])
  return set
}

function dice(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1
  let intersection = 0
  for (const g of setA) if (setB.has(g)) intersection++
  return (2 * intersection) / (setA.size + setB.size)
}

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]
      x = this.parent[x]
    }
    return x
  }
  union(a, b) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[ra] = rb
  }
}

async function main() {
  const threshold = parseThreshold()
  const env = loadEnvLocal()
  const supabaseUrl = env.SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，检查 .env.local')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: memories, error } = await supabase
    .from('persona_memories')
    .select('id, persona_id, content, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('拉取 persona_memories 失败:', error.message)
    process.exit(1)
  }

  const rows = memories ?? []
  console.log(`扫描 ${rows.length} 条 persona_memories（is_active = true），阈值 ${threshold}`)
  console.log('')

  const bigramSets = rows.map(r => bigrams(r.content))
  const uf = new UnionFind(rows.length)
  const edges = []

  // 只在同一 persona_id 内两两比较
  const byPersona = new Map()
  rows.forEach((r, idx) => {
    if (!byPersona.has(r.persona_id)) byPersona.set(r.persona_id, [])
    byPersona.get(r.persona_id).push(idx)
  })

  for (const idxs of byPersona.values()) {
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const i = idxs[a]
        const j = idxs[b]
        const sim = dice(bigramSets[i], bigramSets[j])
        if (sim >= threshold) {
          edges.push({ i, j, sim })
          uf.union(i, j)
        }
      }
    }
  }

  const clusterMap = new Map()
  rows.forEach((_, idx) => {
    const root = uf.find(idx)
    if (!clusterMap.has(root)) clusterMap.set(root, [])
    clusterMap.get(root).push(idx)
  })
  const clusters = Array.from(clusterMap.values()).filter(c => c.length > 1)

  // 每条记忆在组内的最高相似度（来自实际达到阈值的边）
  const bestSim = new Map()
  for (const e of edges) {
    bestSim.set(e.i, Math.max(bestSim.get(e.i) ?? 0, e.sim))
    bestSim.set(e.j, Math.max(bestSim.get(e.j) ?? 0, e.sim))
  }

  const clusterMaxSim = clusters.map(members => {
    let max = 0
    for (const idx of members) max = Math.max(max, bestSim.get(idx) ?? 0)
    return max
  })

  const order = clusters.map((_, i) => i).sort((a, b) => clusterMaxSim[b] - clusterMaxSim[a])

  let totalInvolved = 0
  if (clusters.length === 0) {
    console.log('没有发现疑似相似的记忆。')
  }
  order.forEach((ci, rank) => {
    const members = clusters[ci]
    totalInvolved += members.length
    const sortedMembers = [...members].sort((a, b) => new Date(rows[a].created_at) - new Date(rows[b].created_at))

    console.log(`--- 疑似重复组 ${rank + 1}/${clusters.length}（persona_id: ${rows[members[0]].persona_id}，组内最高相似度: ${clusterMaxSim[ci].toFixed(3)}）---`)
    for (const idx of sortedMembers) {
      const r = rows[idx]
      console.log(`  id=${r.id}  created_at=${r.created_at}  相似度=${(bestSim.get(idx) ?? 0).toFixed(3)}`)
      console.log(`    ${r.content}`)
    }
    console.log('')
  })

  console.log('==== 总结 ====')
  console.log(`共 ${clusters.length} 组疑似，涉及 ${totalInvolved} 条记忆`)
}

main()

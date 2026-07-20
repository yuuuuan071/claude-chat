// 存量语义去重脚本：按 persona_id 分组，组内两两计算 embedding 余弦相似度，
// 相似度 >= 阈值的记忆聚合成重复组，每组保留 created_at 最早的一条，其余标记待删。
//
// 用法：
//   node scripts/dedupe-semantic.mjs                    # dry-run，阈值默认 0.90
//   node scripts/dedupe-semantic.mjs --threshold=0.85    # dry-run，自定义阈值
//   node scripts/dedupe-semantic.mjs --apply             # 真正执行硬删除

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes('--apply')
const thresholdArg = process.argv.find(a => a.startsWith('--threshold='))
const THRESHOLD = thresholdArg ? parseFloat(thresholdArg.split('=')[1]) : 0.90

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

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function parseEmbedding(raw) {
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function main() {
  const env = loadEnvLocal()
  const supabaseUrl = env.SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，检查 .env.local')
    process.exit(1)
  }
  if (Number.isNaN(THRESHOLD) || THRESHOLD <= 0 || THRESHOLD > 1) {
    console.error(`--threshold 参数不合法: ${thresholdArg}`)
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // 分页拉取全部 is_active=true 且 embedding 非空的记忆
  const rows = []
  const PAGE_SIZE = 500
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('persona_memories')
      .select('id, persona_id, content, embedding, created_at')
      .eq('is_active', true)
      .not('embedding', 'is', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      console.error('拉取 persona_memories 失败:', error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  for (const r of rows) r.embedding = parseEmbedding(r.embedding)

  console.log(`扫描 ${rows.length} 条记忆（is_active=true 且 embedding 非空），相似度阈值=${THRESHOLD}，模式=${APPLY ? 'apply（将真正删除）' : 'dry-run'}`)

  // 按 persona_id 分组，组内两两比较，用并查集把相似度 >= 阈值的记忆聚成重复组
  const byPersona = new Map()
  for (const r of rows) {
    if (!byPersona.has(r.persona_id)) byPersona.set(r.persona_id, [])
    byPersona.get(r.persona_id).push(r)
  }

  const allGroups = []

  for (const [personaId, items] of byPersona) {
    const parent = new Map(items.map(it => [it.id, it.id]))
    const find = x => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)))
        x = parent.get(x)
      }
      return x
    }
    const union = (a, b) => {
      const ra = find(a), rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (cosine(items[i].embedding, items[j].embedding) >= THRESHOLD) {
          union(items[i].id, items[j].id)
        }
      }
    }

    const clusters = new Map()
    for (const it of items) {
      const root = find(it.id)
      if (!clusters.has(root)) clusters.set(root, [])
      clusters.get(root).push(it)
    }

    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue
      // 保留规则：content 最长优先；同长度取 created_at 最早
      cluster.sort((a, b) => {
        const lenDiff = b.content.length - a.content.length
        if (lenDiff !== 0) return lenDiff
        return new Date(a.created_at) - new Date(b.created_at)
      })
      const [keep, ...dups] = cluster
      allGroups.push({ personaId, keep, dups })
    }
  }

  console.log('')
  if (allGroups.length === 0) {
    console.log('未发现语义重复记忆。')
  } else {
    allGroups.forEach((g, i) => {
      console.log(`--- 重复组 ${i + 1}/${allGroups.length} (persona_id: ${g.personaId}) ---`)
      console.log(`  保留: id=${g.keep.id}  created_at=${g.keep.created_at}`)
      console.log(`        内容: ${g.keep.content}`)
      for (const d of g.dups) {
        const sim = cosine(g.keep.embedding, d.embedding)
        console.log(`  ${APPLY ? '删除' : '待删'}: id=${d.id}  created_at=${d.created_at}  相似度=${sim.toFixed(4)}`)
        console.log(`        内容: ${d.content}`)
      }
      console.log('')
    })
  }

  const totalToDelete = allGroups.reduce((sum, g) => sum + g.dups.length, 0)

  console.log('==== 总结 ====')
  console.log(`扫描 ${rows.length} 条，发现 ${allGroups.length} 组重复，${APPLY ? '已' : '将'}删除 ${totalToDelete} 条`)

  if (!APPLY) {
    console.log('')
    console.log('这是 dry-run，未执行任何删除。确认无误后加 --apply 参数重新运行以真正删除（硬删除，与 /api/persona-memory/delete 行为一致）。')
    return
  }

  if (totalToDelete === 0) return

  const idsToDelete = allGroups.flatMap(g => g.dups.map(d => d.id))
  let deletedCount = 0
  for (const batch of chunk(idsToDelete, 200)) {
    const { error, count } = await supabase
      .from('persona_memories')
      .delete({ count: 'exact' })
      .in('id', batch)

    if (error) {
      console.error('删除失败:', error.message)
      process.exit(1)
    }
    deletedCount += count ?? 0
  }

  console.log(`已删除 ${deletedCount} 条重复记忆。`)
}

main()

// 一次性回填脚本：给 persona_memories 里 embedding is null 的记录生成向量并写回。
// 每批最多 20 条合并请求 embeddings 端点。
//
// 用法：
//   node scripts/backfill-embeddings.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BATCH_SIZE = 20
const EMBEDDING_MODEL = 'openai/text-embedding-3-small'

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

async function getEmbeddings(texts, apiKey) {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`embeddings request failed: ${res.status} ${errText}`)
  }

  const data = await res.json()
  return data.data.map(d => d.embedding)
}

async function main() {
  const env = loadEnvLocal()
  const supabaseUrl = env.SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  const apiKey = env.OPENROUTER_MEMORY_API_KEY || env.ANTHROPIC_API_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，检查 .env.local')
    process.exit(1)
  }
  if (!apiKey) {
    console.error('缺少 OPENROUTER_MEMORY_API_KEY / ANTHROPIC_API_KEY，检查 .env.local')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // 分页拉取所有 embedding is null 的记录
  const rows = []
  const PAGE_SIZE = 500
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('persona_memories')
      .select('id, content')
      .is('embedding', null)
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

  console.log(`共 ${rows.length} 条待回填记忆（embedding is null）`)

  const failed = []
  let done = 0

  for (const batch of chunk(rows, BATCH_SIZE)) {
    try {
      const embeddings = await getEmbeddings(batch.map(r => r.content), apiKey)

      for (let i = 0; i < batch.length; i++) {
        const row = batch[i]
        const embedding = embeddings[i]
        const { error: updateError } = await supabase
          .from('persona_memories')
          .update({ embedding })
          .eq('id', row.id)

        if (updateError) {
          console.error(`  写入失败 id=${row.id}:`, updateError.message)
          failed.push({ id: row.id, error: updateError.message })
        } else {
          done++
        }
      }
      console.log(`进度: ${done}/${rows.length}`)
    } catch (e) {
      console.error(`批次请求失败 (ids: ${batch.map(r => r.id).join(', ')}):`, e.message)
      for (const row of batch) failed.push({ id: row.id, error: e.message })
    }
  }

  console.log('')
  console.log('==== 总结 ====')
  console.log(`成功回填 ${done}/${rows.length} 条`)
  if (failed.length > 0) {
    console.log(`失败 ${failed.length} 条:`)
    for (const f of failed) console.log(`  id=${f.id}: ${f.error}`)
  } else {
    console.log('无失败')
  }
}

main()

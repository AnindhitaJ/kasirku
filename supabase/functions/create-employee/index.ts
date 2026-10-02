// Edge Function: Owner membuat, mengubah, dan menghapus akun karyawan.
// Deploy: supabase functions deploy manage-employee
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const reply = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: { user } } = await caller.auth.getUser()
  if (!user) return reply('Sesi tidak valid, silakan masuk ulang', 401)

  const b = await req.json()
  const { data: mine } = await admin.from('kk_stores').select('id').eq('owner_id', user.id)
  const own = new Set((mine ?? []).map((s) => s.id))
  const badStores = (ids?: string[]) => !ids?.length || ids.some((i) => !own.has(i))

  // Karyawan harus anggota toko milik Owner yang memanggil
  const isMine = async (uid: string) => {
    const { data } = await admin.from('kk_members').select('id').eq('user_id', uid).in('store_id', [...own]).limit(1)
    return !!data?.length
  }
  const assign = async (uid: string, name: string, pw: string, ids: string[]) => {
    await admin.from('kk_members').delete().eq('user_id', uid).in('store_id', [...own])
    for (const sid of ids) {
      const { data: m, error } = await admin.from('kk_members').insert({ store_id: sid, user_id: uid, name }).select('id').single()
      if (error) throw error
      await admin.from('kk_member_secrets').upsert({ member_id: m.id, password_plain: pw })
    }
  }

  try {
    if (b.action === 'create') {
      if (badStores(b.store_ids)) return reply('Toko tidak valid', 403)
      const slug = String(b.name).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')
      if (!slug) return reply('Nama tidak valid', 400)
      const { data, error } = await admin.auth.admin.createUser({ email: `${slug}@kasirku.app`, password: b.password, email_confirm: true })
      if (error) return reply(error.message.includes('already') ? 'Nama sudah dipakai, coba nama lain' : error.message, 400)
      await assign(data.user.id, b.name, b.password, b.store_ids)
      return reply({ ok: true })
    }
    if (!(await isMine(b.user_id))) return reply('Bukan karyawan Anda', 403)
    if (b.action === 'update') {
      if (badStores(b.store_ids)) return reply('Toko tidak valid', 403)
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { password: b.password })
      if (error) return reply(error.message, 400)
      await assign(b.user_id, b.name, b.password, b.store_ids)
      return reply({ ok: true })
    }
    if (b.action === 'delete') {
      const { error } = await admin.auth.admin.deleteUser(b.user_id)
      if (error) return reply(error.message, 400)
      return reply({ ok: true })
    }
    return reply('Aksi tidak dikenal', 400)
  } catch (e) {
    return reply(String((e as Error).message ?? e), 500)
  }
})
